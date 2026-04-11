use clap::{Parser, Subcommand};
use serde::Serialize;
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;

mod hook_input;

use hook_input::ClaudeHookInput;

const SOCKET_PATH: &str = ".buddy-notch/buddy.sock";

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

    // Read stdin before fork (consumed by parent)
    let hook = read_hook_input();
    let session_id = hook
        .as_ref()
        .and_then(|h| h.session_id.clone())
        .unwrap_or_else(|| format!("bridge-{}", std::process::id()));

    let cwd = hook
        .as_ref()
        .and_then(|h| h.cwd.clone())
        .unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        });

    let session_mode = hook.as_ref().and_then(|h| {
        h.session_type
            .as_deref()
            .and_then(|t| if t == "plan" { Some("plan") } else { None })
    });

    // Fork to background — parent exits immediately so Claude Code is never blocked.
    // Child handles all socket I/O then exits.
    if !fork_to_background() {
        return;
    }

    match cli.command {
        Commands::PreTool => {
            let diff = hook.as_ref().and_then(|h| {
                let ti = h.tool_input.as_ref()?;
                if let (Some(old), Some(new)) = (&ti.old_string, &ti.new_string) {
                    Some(format!("- {old}\n+ {new}"))
                } else {
                    ti.diff.clone()
                }
            });

            let tool_name = hook
                .as_ref()
                .and_then(|h| h.tool_name.as_deref())
                .unwrap_or("Tool");
            let file_path =
                hook.as_ref()
                    .and_then(|h| h.tool_input.as_ref()?.file_path.as_deref());
            let command = hook
                .as_ref()
                .and_then(|h| h.tool_input.as_ref()?.command.as_deref());
            let (question_owned, options_owned) = hook
                .as_ref()
                .and_then(|h| {
                    let ti = h.tool_input.as_ref()?;
                    if ti.question.is_some() {
                        return Some((ti.question.clone(), ti.options.clone()));
                    }
                    let qi = ti.questions.as_ref()?.first()?;
                    let q = qi.question.clone();
                    let opts = qi
                        .options
                        .as_ref()
                        .map(|os| os.iter().filter_map(|o| o.label.clone()).collect());
                    Some((q, opts))
                })
                .unwrap_or((None, None));

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
                        question: question_owned.as_deref(),
                        options: options_owned.as_deref(),
                    },
                },
                session_mode,
            };

            let _ = send_messages(&[&session_start, &pre_tool]);
        }

        Commands::PostTool => {
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

            let tool_name = hook
                .as_ref()
                .and_then(|h| h.tool_name.as_deref())
                .unwrap_or("Tool");
            let file_path = hook.as_ref().and_then(|h| {
                h.tool_input
                    .as_ref()
                    .and_then(|ti| ti.file_path.as_deref())
                    .or_else(|| h.tool_response.as_ref()?.file_path.as_deref())
            });

            let post_tool = SocketMessage {
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
            };

            let _ = send_messages(&[&session_start, &post_tool]);
        }

        Commands::Notify => {
            let title = hook
                .as_ref()
                .and_then(|h| h.tool_name.as_deref())
                .unwrap_or("Notification");

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
    if ppid > 1 {
        Some(ppid as u32)
    } else {
        None
    }
}

fn now_iso() -> String {
    unsafe {
        let mut t: libc::time_t = 0;
        libc::time(&mut t);
        let mut tm = std::mem::MaybeUninit::<libc::tm>::uninit();
        libc::gmtime_r(&t, tm.as_mut_ptr());
        let tm = tm.assume_init();
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

/// Fork to background so Claude Code is never blocked.
/// Returns true if caller should continue (child or fork failed).
/// Returns false if caller should exit immediately (parent).
fn fork_to_background() -> bool {
    unsafe {
        match libc::fork() {
            -1 => true, // fork failed — fall through to synchronous path
            0 => {
                // Child: redirect fds to /dev/null so we don't interfere
                libc::close(0);
                let devnull = libc::open(b"/dev/null\0".as_ptr() as *const _, libc::O_RDWR);
                if devnull >= 0 {
                    libc::dup2(devnull, 1);
                    libc::dup2(devnull, 2);
                    if devnull > 2 {
                        libc::close(devnull);
                    }
                }
                libc::setsid();
                true
            }
            _ => false, // parent: exit immediately
        }
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

/// Send multiple messages on a single socket connection.
fn send_messages(msgs: &[&SocketMessage]) -> Result<(), Box<dyn std::error::Error>> {
    let mut stream = UnixStream::connect(socket_path())?;
    for msg in msgs {
        let json = serde_json::to_string(msg)?;
        stream.write_all(json.as_bytes())?;
        stream.write_all(b"\n")?;
    }
    stream.flush()?;
    Ok(())
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
