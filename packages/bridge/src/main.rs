use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

mod hook_input;

use hook_input::ClaudeHookInput;

const SOCKET_PATH: &str = ".bnot/bnot.sock";
const APPROVAL_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Deserialize)]
struct ApprovalResponse {
    action: String, // "allow" | "allowAlways" | "deny" | "answer" | "acceptEdits" | "bypassPermissions"
    #[serde(rename = "answerLabel")]
    answer_label: Option<String>,
    #[serde(rename = "questionText")]
    question_text: Option<String>,
    feedback: Option<String>,
}

fn socket_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    format!("{home}/{SOCKET_PATH}")
}

#[derive(Parser)]
#[command(name = "bnot-bridge", about = "Bridge between Claude Code hooks and Bnot")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    #[command(name = "user-prompt")]
    UserPrompt,
    #[command(name = "pre-tool")]
    PreTool,
    #[command(name = "post-tool")]
    PostTool,
    #[command(name = "perm-request")]
    PermRequest,
    Notify,
    Stop,
    #[command(name = "session-end")]
    SessionEnd,
    #[command(name = "stop-failure")]
    StopFailure,
    #[command(name = "subagent-start")]
    SubagentStart,
    #[command(name = "subagent-stop")]
    SubagentStop,
    #[command(name = "post-tool-failure")]
    PostToolFailure,
    #[command(name = "perm-denied")]
    PermDenied,
    #[command(name = "pre-compact")]
    PreCompact,
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

    let terminal_app = detect_terminal();
    let parent_pid = get_parent_pid();

    // Helper: send sessionStart preamble + a typed message on one connection.
    // Halves socket churn vs two separate send_message calls.
    let send_with_preamble = |typed: &SocketMessage| {
        let ts = now_iso();
        let start = SocketMessage {
            r#type: "sessionStart",
            session_id: &session_id,
            timestamp: &ts,
            payload: Payload::SessionStart {
                session_start: SessionStartPayload {
                    task_name: None,
                    working_directory: &cwd,
                    terminal_app,
                    terminal_pid: parent_pid,
                },
            },
            session_mode,
        };
        let mut stream = match UnixStream::connect(socket_path()) {
            Ok(s) => s,
            Err(_) => return,
        };
        for msg in [&start, typed] {
            if let Ok(json) = serde_json::to_string(msg) {
                let _ = stream.write_all(json.as_bytes());
                let _ = stream.write_all(b"\n");
            }
        }
        let _ = stream.flush();
    };

    match cli.command {
        Commands::UserPrompt => {
            send_with_preamble(&SocketMessage {
                r#type: "userPromptSubmit",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::UserPromptSubmit {
                    user_prompt_submit: UserPromptSubmitPayload {},
                },
                session_mode,
            });
        }

        Commands::PreTool => {
            // Fire-and-forget: track tool usage, never block.
            // Permission approval is handled by the PermRequest subcommand.
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
            let (question_owned, header_owned, options_owned, descriptions_owned) = hook
                .as_ref()
                .and_then(|h| {
                    let ti = h.tool_input.as_ref()?;
                    if ti.question.is_some() {
                        return Some((ti.question.clone(), None::<String>, ti.options.clone(), None::<Vec<String>>));
                    }
                    let qi = ti.questions.as_ref()?.first()?;
                    let q = qi.question.clone();
                    let hdr = qi.header.clone();
                    let opts = qi.options.as_ref().map(|os| {
                        os.iter().filter_map(|o| o.label.clone()).collect()
                    });
                    let descs = qi.options.as_ref().map(|os| {
                        os.iter().map(|o| o.description.clone().unwrap_or_default()).collect()
                    });
                    Some((q, hdr, opts, descs))
                })
                .unwrap_or((None, None, None, None));
            let question = question_owned.as_deref();
            let question_header = header_owned.as_deref();

            send_with_preamble(&SocketMessage {
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
                        question_header,
                        options: options_owned.as_deref(),
                        option_descriptions: descriptions_owned.as_deref(),
                    },
                },
                session_mode,
            });
        }

        Commands::PermRequest => {
            // Blocking path: show approval UI in Bnot, wait for user decision.
            // Responds with PermissionRequest hook output format.
            let tool_name = hook.as_ref().and_then(|h| h.tool_name.as_deref()).unwrap_or("Tool");

            // Skip safe tools (except AskUserQuestion which we answer via the socket)
            const SAFE_TOOLS: &[&str] = &["TaskCreate", "TaskUpdate", "TodoRead", "TodoWrite"];
            if SAFE_TOOLS.contains(&tool_name) {
                return;
            }
            let file_path = hook.as_ref().and_then(|h| h.tool_input.as_ref()?.file_path.as_deref());
            let command = hook.as_ref().and_then(|h| h.tool_input.as_ref()?.command.as_deref());
            let diff = hook.as_ref().and_then(|h| {
                let ti = h.tool_input.as_ref()?;
                // ExitPlanMode: use plan content as preview
                if let Some(plan) = &ti.plan {
                    return Some(plan.clone());
                }
                if let (Some(old), Some(new)) = (&ti.old_string, &ti.new_string) {
                    build_rich_diff(ti.file_path.as_deref(), old, new)
                } else {
                    ti.diff.clone()
                }
            });
            let permission_suggestions = hook.as_ref().and_then(|h| h.permission_suggestions.clone());
            let can_remember = permission_suggestions.is_some();

            let ts = now_iso();
            let session_start = SocketMessage {
                r#type: "sessionStart",
                session_id: &session_id,
                timestamp: &ts,
                payload: Payload::SessionStart {
                    session_start: SessionStartPayload {
                        task_name: None,
                        working_directory: &cwd,
                        terminal_app,
                        terminal_pid: parent_pid,
                    },
                },
                session_mode,
            };

            let perm_request = SocketMessage {
                r#type: "permissionRequest",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::PermissionRequest {
                    permission_request: PermissionRequestPayload {
                        tool_name,
                        file_path,
                        input: command,
                        diff_preview: diff.as_deref(),
                        can_remember,
                    },
                },
                session_mode,
            };

            if let Some(resp) = send_and_wait(&session_start, &perm_request) {
                let output = if resp.action == "deny" {
                    let msg = resp.feedback.clone().unwrap_or_else(|| "Denied via Bnot".to_string());
                    serde_json::json!({
                        "hookSpecificOutput": {
                            "hookEventName": "PermissionRequest",
                            "decision": {
                                "behavior": "deny",
                                "message": msg
                            }
                        }
                    })
                } else if resp.action == "acceptEdits" || resp.action == "bypassPermissions" {
                    let mode = if resp.action == "acceptEdits" { "acceptEdits" } else { "bypassPermissions" };
                    serde_json::json!({
                        "hookSpecificOutput": {
                            "hookEventName": "PermissionRequest",
                            "decision": {
                                "behavior": "allow",
                                "updatedPermissions": [
                                    { "type": "setMode", "mode": mode, "destination": "session" }
                                ]
                            }
                        }
                    })
                } else if resp.action == "allowAlways" {
                    let mut decision = serde_json::json!({ "behavior": "allow" });
                    if let Some(ref suggestions) = permission_suggestions {
                        decision["updatedPermissions"] = suggestions.clone();
                    }
                    serde_json::json!({
                        "hookSpecificOutput": {
                            "hookEventName": "PermissionRequest",
                            "decision": decision
                        }
                    })
                } else if resp.action == "answer" {
                    // AskUserQuestion: return updatedInput with pre-filled answer
                    let mut answers = serde_json::Map::new();
                    if let (Some(q), Some(a)) = (&resp.question_text, &resp.answer_label) {
                        answers.insert(q.clone(), serde_json::Value::String(a.clone()));
                    }
                    serde_json::json!({
                        "hookSpecificOutput": {
                            "hookEventName": "PermissionRequest",
                            "decision": {
                                "behavior": "allow",
                                "updatedInput": { "answers": answers }
                            }
                        }
                    })
                } else {
                    // "allow"
                    serde_json::json!({
                        "hookSpecificOutput": {
                            "hookEventName": "PermissionRequest",
                            "decision": { "behavior": "allow" }
                        }
                    })
                };
                println!("{}", output);
            }
            // If send_and_wait returns None (timeout/error), exit 0 with no output
            // so Claude Code falls back to its own permission prompt
        }

        Commands::PostTool => {
            let tool_name = hook.as_ref().and_then(|h| h.tool_name.as_deref()).unwrap_or("Tool");
            let file_path = hook.as_ref().and_then(|h| {
                h.tool_input
                    .as_ref()
                    .and_then(|ti| ti.file_path.as_deref())
                    .or_else(|| h.tool_response.as_ref()?.file_path.as_deref())
            });

            send_with_preamble(&SocketMessage {
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

            send_with_preamble(&SocketMessage {
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
            send_with_preamble(&SocketMessage {
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

        Commands::SessionEnd => {
            send_with_preamble(&SocketMessage {
                r#type: "sessionEnd",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::SessionEnd {
                    session_end: SessionEndPayload {
                        reason: Some("terminated"),
                    },
                },
                session_mode,
            });
        }

        Commands::StopFailure => {
            send_with_preamble(&SocketMessage {
                r#type: "stopFailure",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::StopFailure { stop_failure: EmptyPayload {} },
                session_mode,
            });
        }

        Commands::SubagentStart => {
            send_with_preamble(&SocketMessage {
                r#type: "subagentStart",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::SubagentStart { subagent_start: EmptyPayload {} },
                session_mode,
            });
        }

        Commands::SubagentStop => {
            send_with_preamble(&SocketMessage {
                r#type: "subagentStop",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::SubagentStop { subagent_stop: EmptyPayload {} },
                session_mode,
            });
        }

        Commands::PostToolFailure => {
            send_with_preamble(&SocketMessage {
                r#type: "postToolUseFailure",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::PostToolUseFailure { post_tool_use_failure: EmptyPayload {} },
                session_mode,
            });
        }

        Commands::PermDenied => {
            send_with_preamble(&SocketMessage {
                r#type: "permissionDenied",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::PermissionDenied { permission_denied: EmptyPayload {} },
                session_mode,
            });
        }

        Commands::PreCompact => {
            send_with_preamble(&SocketMessage {
                r#type: "preCompact",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::PreCompact { pre_compact: EmptyPayload {} },
                session_mode,
            });
        }

    }
}

/// Build a unified diff with real line numbers by reading the file and using `similar`.
/// Falls back to simple `- old\n+ new` if the file can't be read.
fn build_rich_diff(file_path: Option<&str>, old_str: &str, new_str: &str) -> Option<String> {
    let path = file_path?;
    let content = std::fs::read_to_string(path).ok()?;

    // Build the full new file content by replacing old_string with new_string
    let new_content = content.replacen(old_str, new_str, 1);
    if new_content == content {
        // old_string not found in file, fall back
        return None;
    }

    let diff = similar::TextDiff::from_lines(&content, &new_content);
    let unified = diff.unified_diff()
        .context_radius(2)
        .header("a", "b")
        .to_string();

    // Strip the --- a / +++ b header lines, keep only @@ hunks and content
    let result: String = unified
        .lines()
        .filter(|l| !l.starts_with("---") && !l.starts_with("+++"))
        .collect::<Vec<_>>()
        .join("\n");

    if result.is_empty() { None } else { Some(result) }
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

/// Send two messages on a single connection and block until a response is received.
/// Returns None on connection failure, timeout, or parse error (graceful fallback).
fn send_and_wait(msg1: &SocketMessage, msg2: &SocketMessage) -> Option<ApprovalResponse> {
    let mut stream = UnixStream::connect(socket_path()).ok()?;
    stream.set_read_timeout(Some(APPROVAL_TIMEOUT)).ok()?;

    for msg in [msg1, msg2] {
        let json = serde_json::to_string(msg).ok()?;
        stream.write_all(json.as_bytes()).ok()?;
        stream.write_all(b"\n").ok()?;
    }
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
    PermissionRequest {
        #[serde(rename = "permissionRequest")]
        permission_request: PermissionRequestPayload<'a>,
    },
    Notification {
        notification: NotificationPayload<'a>,
    },
    SessionEnd {
        #[serde(rename = "sessionEnd")]
        session_end: SessionEndPayload<'a>,
    },
    UserPromptSubmit {
        #[serde(rename = "userPromptSubmit")]
        user_prompt_submit: UserPromptSubmitPayload,
    },
    StopFailure {
        #[serde(rename = "stopFailure")]
        stop_failure: EmptyPayload,
    },
    SubagentStart {
        #[serde(rename = "subagentStart")]
        subagent_start: EmptyPayload,
    },
    SubagentStop {
        #[serde(rename = "subagentStop")]
        subagent_stop: EmptyPayload,
    },
    PostToolUseFailure {
        #[serde(rename = "postToolUseFailure")]
        post_tool_use_failure: EmptyPayload,
    },
    PermissionDenied {
        #[serde(rename = "permissionDenied")]
        permission_denied: EmptyPayload,
    },
    PreCompact {
        #[serde(rename = "preCompact")]
        pre_compact: EmptyPayload,
    },
}

#[derive(Serialize)]
struct UserPromptSubmitPayload {}

#[derive(Serialize)]
struct EmptyPayload {}

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
    question_header: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<&'a [String]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    option_descriptions: Option<&'a [String]>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PermissionRequestPayload<'a> {
    tool_name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    diff_preview: Option<&'a str>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    can_remember: bool,
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

