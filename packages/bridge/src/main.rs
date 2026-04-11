use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

mod hook_input;

use hook_input::ClaudeHookInput;

const SOCKET_PATH: &str = ".buddy-notch/buddy.sock";
const DANGEROUS_TOOLS: &[&str] = &["Bash", "Edit", "Write", "NotebookEdit", "MultiEdit"];

/// Check if Claude Code is running in auto-approve mode by inspecting
/// the process tree for --dangerously-skip-permissions.
fn is_auto_approved() -> bool {
    let mut pid = unsafe { libc::getppid() } as u32;
    for _ in 0..5 {
        if pid <= 1 {
            break;
        }
        if let Ok(output) = std::process::Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "ppid=,args="])
            .output()
        {
            let s = String::from_utf8_lossy(&output.stdout);
            if s.contains("dangerously-skip") {
                return true;
            }
            pid = s.trim().split_whitespace().next()
                .and_then(|p| p.parse().ok())
                .unwrap_or(0);
        } else {
            break;
        }
    }
    false
}

#[derive(Deserialize)]
struct ApprovalResponse {
    action: String,
}

fn socket_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    format!("{home}/{SOCKET_PATH}")
}

#[derive(Parser)]
#[command(name = "buddy-bridge", about = "Bridge between Claude Code hooks and BuddyNotch")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    #[command(name = "pre-tool")]
    PreTool,
    #[command(name = "post-tool")]
    PostTool,
    Notify,
    Stop,
}

fn main() {
    let cli = Cli::parse();

    let hook = read_hook_input();
    let session_id = hook
        .as_ref()
        .and_then(|h| h.session_id.clone())
        .unwrap_or_else(|| format!("bridge-{}", std::process::id()));

    let cwd = hook
        .as_ref()
        .and_then(|h| h.cwd.clone())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default().to_string_lossy().to_string());

    let session_mode = hook.as_ref().and_then(|h| {
        h.session_type.as_deref().and_then(|t| {
            if t == "plan" { Some("plan") } else { None }
        })
    });

    match cli.command {
        Commands::PreTool => {
            // Build diff preview
            let diff = hook.as_ref().and_then(|h| {
                let ti = h.tool_input.as_ref()?;
                if let (Some(old), Some(new)) = (&ti.old_string, &ti.new_string) {
                    Some(format!("- {old}\n+ {new}"))
                } else {
                    ti.diff.clone()
                }
            });

            let tool_name = hook.as_ref().and_then(|h| h.tool_name.as_deref()).unwrap_or("Tool");
            let file_path = hook.as_ref().and_then(|h| h.tool_input.as_ref()?.file_path.as_deref());
            let command = hook.as_ref().and_then(|h| h.tool_input.as_ref()?.command.as_deref());
            // Extract question/options: direct fields or from AskUserQuestion's `questions` array
            let (question_owned, options_owned) = hook
                .as_ref()
                .and_then(|h| {
                    let ti = h.tool_input.as_ref()?;
                    // Try direct fields first
                    if ti.question.is_some() {
                        return Some((ti.question.clone(), ti.options.clone()));
                    }
                    // AskUserQuestion uses `questions` array
                    let qi = ti.questions.as_ref()?.first()?;
                    let q = qi.question.clone();
                    let opts = qi.options.as_ref().map(|os| {
                        os.iter().filter_map(|o| o.label.clone()).collect()
                    });
                    Some((q, opts))
                })
                .unwrap_or((None, None));
            let question = question_owned.as_deref();
            let will_block = DANGEROUS_TOOLS.contains(&tool_name) && !is_auto_approved();

            let session_start = SocketMessage {
                r#type: "sessionStart",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::SessionStart {
                    session_start: SessionStartPayload {
                        task_name: None,
                        working_directory: &cwd,
                        terminal_app: detect_terminal(),
                        terminal_pid: get_parent_pid(),
                    },
                },
                session_mode,
            };

            let pre_tool = SocketMessage {
                r#type: "preToolUse",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::PreToolUse {
                    pre_tool_use: PreToolUsePayload {
                        tool_name,
                        file_path,
                        input: command,
                        diff_preview: diff.as_deref(),
                        question,
                        options: options_owned.as_deref(),
                        blocking: will_block,
                    },
                },
                session_mode,
            };

            if will_block {
                // Blocking path: send both messages on one connection, wait for response
                if let Some(resp) = send_and_wait(&session_start, &pre_tool) {
                    if resp.action == "allow" {
                        println!("{{\"decision\":\"allow\"}}");
                    } else {
                        println!("{{\"decision\":\"deny\",\"reason\":\"Denied via BuddyNotch\"}}");
                    }
                }
                // If send_and_wait returns None (timeout/error), exit 0 with no output
                // so Claude Code falls back to its own approval flow
            } else {
                // Fire-and-forget for safe tools and AskUserQuestion
                let _ = send_message(&session_start);
                let _ = send_message(&pre_tool);
            }
        }

        Commands::PostTool => {
            let _ = send_message(&SocketMessage {
                r#type: "sessionStart",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::SessionStart {
                    session_start: SessionStartPayload {
                        task_name: None,
                        working_directory: &cwd,
                        terminal_app: detect_terminal(),
                        terminal_pid: get_parent_pid(),
                    },
                },
                session_mode,
            });

            let tool_name = hook.as_ref().and_then(|h| h.tool_name.as_deref()).unwrap_or("Tool");
            let file_path = hook.as_ref().and_then(|h| {
                h.tool_input
                    .as_ref()
                    .and_then(|ti| ti.file_path.as_deref())
                    .or_else(|| h.tool_response.as_ref()?.file_path.as_deref())
            });

            let _ = send_message(&SocketMessage {
                r#type: "postToolUse",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::PostToolUse {
                    post_tool_use: PostToolUsePayload {
                        tool_name,
                        file_path,
                        was_approved: true,
                    },
                },
                session_mode,
            });
        }

        Commands::Notify => {
            let title = hook.as_ref().and_then(|h| h.tool_name.as_deref()).unwrap_or("Notification");

            let _ = send_message(&SocketMessage {
                r#type: "notification",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::Notification {
                    notification: NotificationPayload {
                        title,
                        body: &cwd,
                        level: "info",
                    },
                },
                session_mode,
            });
        }

        Commands::Stop => {
            let _ = send_message(&SocketMessage {
                r#type: "sessionEnd",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::SessionEnd {
                    session_end: SessionEndPayload {
                        reason: Some("completed"),
                    },
                },
                session_mode,
            });
        }
    }
}

fn read_hook_input() -> Option<ClaudeHookInput> {
    let mut buf = String::new();
    std::io::stdin().read_to_string(&mut buf).ok()?;
    if buf.is_empty() {
        return None;
    }
    serde_json::from_str(&buf).ok()
}

fn detect_terminal() -> Option<&'static str> {
    std::env::var("TERM_PROGRAM").ok().and_then(|v| {
        let v = v.to_lowercase();
        if v.contains("ghostty") {
            Some("Ghostty")
        } else if v.contains("iterm") {
            Some("iTerm2")
        } else if v.contains("warp") {
            Some("Warp")
        } else if v.contains("apple_terminal") {
            Some("Terminal")
        } else {
            None
        }
    })
}

fn get_parent_pid() -> Option<u32> {
    let ppid = unsafe { libc::getppid() };
    if ppid > 1 { Some(ppid as u32) } else { None }
}

fn now_iso() -> String {
    // Use libc to get a proper timestamp
    unsafe {
        let mut t: libc::time_t = 0;
        libc::time(&mut t);
        let mut tm: libc::tm = std::mem::zeroed();
        libc::gmtime_r(&t, &mut tm);
        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
            tm.tm_year + 1900,
            tm.tm_mon + 1,
            tm.tm_mday,
            tm.tm_hour,
            tm.tm_min,
            tm.tm_sec
        )
    }
}

fn send_message(msg: &SocketMessage) -> Result<(), Box<dyn std::error::Error>> {
    let mut stream = UnixStream::connect(socket_path())?;
    let json = serde_json::to_string(msg)?;
    stream.write_all(json.as_bytes())?;
    stream.write_all(b"\n")?;
    stream.flush()?;
    Ok(())
}

/// Send two messages on a single connection and block until a response is received.
/// Returns None on connection failure, timeout, or parse error (graceful fallback).
fn send_and_wait(msg1: &SocketMessage, msg2: &SocketMessage) -> Option<ApprovalResponse> {
    let mut stream = UnixStream::connect(socket_path()).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(120))).ok()?;

    // Write both messages on the same connection
    let json1 = serde_json::to_string(msg1).ok()?;
    let json2 = serde_json::to_string(msg2).ok()?;
    stream.write_all(json1.as_bytes()).ok()?;
    stream.write_all(b"\n").ok()?;
    stream.write_all(json2.as_bytes()).ok()?;
    stream.write_all(b"\n").ok()?;
    stream.flush().ok()?;

    // Block reading until sidecar sends a response line
    let reader = BufReader::new(&stream);
    for line in reader.lines() {
        let line = line.ok()?;
        if line.trim().is_empty() {
            continue;
        }
        return serde_json::from_str(&line).ok();
    }

    None
}

// Wire types — must match sidecar/src/types.ts

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SocketMessage<'a> {
    r#type: &'a str,
    session_id: &'a str,
    timestamp: &'a str,
    payload: Payload<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_mode: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Payload<'a> {
    SessionStart {
        #[serde(rename = "sessionStart")]
        session_start: SessionStartPayload<'a>,
    },
    PreToolUse {
        #[serde(rename = "preToolUse")]
        pre_tool_use: PreToolUsePayload<'a>,
    },
    PostToolUse {
        #[serde(rename = "postToolUse")]
        post_tool_use: PostToolUsePayload<'a>,
    },
    Notification {
        notification: NotificationPayload<'a>,
    },
    SessionEnd {
        #[serde(rename = "sessionEnd")]
        session_end: SessionEndPayload<'a>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionStartPayload<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    task_name: Option<&'a str>,
    working_directory: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    terminal_app: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    terminal_pid: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreToolUsePayload<'a> {
    tool_name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    diff_preview: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    question: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<&'a [String]>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    blocking: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostToolUsePayload<'a> {
    tool_name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<&'a str>,
    was_approved: bool,
}

#[derive(Serialize)]
struct NotificationPayload<'a> {
    title: &'a str,
    body: &'a str,
    level: &'a str,
}

#[derive(Serialize)]
struct SessionEndPayload<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}
