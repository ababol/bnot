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
    /// New format: {questionText: label | [labels, ...]} for multi-select / multi-question
    answers: Option<serde_json::Value>,
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
        h.permission_mode.as_deref().map(|m| match m {
            "plan" => "plan",
            "auto" => "auto",
            "bypassPermissions" => "dangerous",
            _ => "normal",
        })
    });

    let session_type = hook.as_ref().and_then(|h| h.session_type.as_deref());

    // Subagent hooks create phantom sessions in the UI. The parent session
    // already tracks subagent activity via SubagentStart/SubagentStop events.
    if session_type.is_some_and(|t| t == "agent") {
        return;
    }

    let terminal_app = detect_terminal();
    let parent_pid = get_parent_pid();
    let ghostty_terminal_id = if terminal_app == Some("Ghostty") {
        get_ghostty_terminal_id()
    } else {
        None
    };

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
                    ghostty_terminal_id: ghostty_terminal_id.as_deref(),
                },
            },
            session_mode,
            session_type,
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
                session_type,
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

            // Build question fields: prefer simple `question` field; otherwise use `questions` array.
            // When `questions` has multiple items, send the full array so the UI can show all of them.
            struct QuestionFields {
                question: Option<String>,
                header: Option<String>,
                options: Option<Vec<String>>,
                option_descriptions: Option<Vec<String>>,
                multi_select: Option<bool>,
                all_questions: Option<Vec<QuestionPayload>>,
            }

            let qf = hook
                .as_ref()
                .and_then(|h| {
                    let ti = h.tool_input.as_ref()?;
                    // Check the `questions` array FIRST — Claude Code populates both
                    // `question` (from Q1) and `questions` (full array), so checking
                    // `question` first would short-circuit and lose the other questions.
                    if let Some(questions) = ti.questions.as_ref() {
                        if !questions.is_empty() {
                            let all: Vec<QuestionPayload> = questions
                                .iter()
                                .filter_map(|qi| {
                                    let q_text = qi.question.clone()?;
                                    let opts: Vec<String> = qi
                                        .options
                                        .as_ref()
                                        .map(|os| os.iter().filter_map(|o| o.label.clone()).collect())
                                        .unwrap_or_default();
                                    let descs: Option<Vec<String>> = qi.options.as_ref().map(|os| {
                                        os.iter().map(|o| o.description.clone().unwrap_or_default()).collect()
                                    });
                                    Some(QuestionPayload {
                                        question: q_text,
                                        question_header: qi.header.clone(),
                                        options: opts,
                                        option_descriptions: descs,
                                        multi_select: qi.multi_select,
                                    })
                                })
                                .collect();
                            let first = questions.first()?;
                            let q_text = first.question.clone();
                            let hdr = first.header.clone();
                            let opts = first.options.as_ref().map(|os| {
                                os.iter().filter_map(|o| o.label.clone()).collect()
                            });
                            let descs = first.options.as_ref().map(|os| {
                                os.iter().map(|o| o.description.clone().unwrap_or_default()).collect()
                            });
                            let ms = first.multi_select;
                            let has_multiple = all.len() > 1;
                            return Some(QuestionFields {
                                question: q_text,
                                header: hdr,
                                options: opts,
                                option_descriptions: descs,
                                multi_select: ms,
                                all_questions: if has_multiple { Some(all) } else { None },
                            });
                        }
                    }
                    // Fallback: simple single-question format
                    if let Some(q) = &ti.question {
                        return Some(QuestionFields {
                            question: Some(q.clone()),
                            header: None,
                            options: ti.options.clone(),
                            option_descriptions: None,
                            multi_select: None,
                            all_questions: None,
                        });
                    }
                    None
                })
                .unwrap_or(QuestionFields {
                    question: None,
                    header: None,
                    options: None,
                    option_descriptions: None,
                    multi_select: None,
                    all_questions: None,
                });

            let question = qf.question.as_deref();
            let question_header = qf.header.as_deref();

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
                        options: qf.options.as_deref(),
                        option_descriptions: qf.option_descriptions.as_deref(),
                        multi_select: qf.multi_select,
                        questions: qf.all_questions,
                    },
                },
                session_mode,
                session_type,
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
                        ghostty_terminal_id: ghostty_terminal_id.as_deref(),
                    },
                },
                session_mode,
                session_type,
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
                session_type,
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
                    // AskUserQuestion: return updatedInput with pre-filled answers.
                    // Prefer the new `answers` dict (multi-question / multi-select);
                    // fall back to the legacy single question_text → answer_label pair.
                    let answers_value = if let Some(a) = resp.answers {
                        a
                    } else {
                        let mut m = serde_json::Map::new();
                        if let (Some(q), Some(a)) = (&resp.question_text, &resp.answer_label) {
                            m.insert(q.clone(), serde_json::Value::String(a.clone()));
                        }
                        serde_json::Value::Object(m)
                    };
                    serde_json::json!({
                        "hookSpecificOutput": {
                            "hookEventName": "PermissionRequest",
                            "decision": {
                                "behavior": "allow",
                                "updatedInput": { "answers": answers_value }
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
                session_type,
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
                session_type,
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
                session_type,
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
                session_type,
            });
        }

        Commands::StopFailure => {
            send_with_preamble(&SocketMessage {
                r#type: "stopFailure",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::StopFailure { stop_failure: EmptyPayload {} },
                session_mode,
                session_type,
            });
        }

        Commands::SubagentStart => {
            send_with_preamble(&SocketMessage {
                r#type: "subagentStart",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::SubagentStart { subagent_start: EmptyPayload {} },
                session_mode,
                session_type,
            });
        }

        Commands::SubagentStop => {
            send_with_preamble(&SocketMessage {
                r#type: "subagentStop",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::SubagentStop { subagent_stop: EmptyPayload {} },
                session_mode,
                session_type,
            });
        }

        Commands::PostToolFailure => {
            send_with_preamble(&SocketMessage {
                r#type: "postToolUseFailure",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::PostToolUseFailure { post_tool_use_failure: EmptyPayload {} },
                session_mode,
                session_type,
            });
        }

        Commands::PermDenied => {
            send_with_preamble(&SocketMessage {
                r#type: "permissionDenied",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::PermissionDenied { permission_denied: EmptyPayload {} },
                session_mode,
                session_type,
            });
        }

        Commands::PreCompact => {
            send_with_preamble(&SocketMessage {
                r#type: "preCompact",
                session_id: &session_id,
                timestamp: &now_iso(),
                payload: Payload::PreCompact { pre_compact: EmptyPayload {} },
                session_mode,
                session_type,
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

fn get_ghostty_terminal_id() -> Option<String> {
    let output = std::process::Command::new("/usr/bin/osascript")
        .args(["-e", r#"tell application "Ghostty"
  return id of focused terminal of selected tab of front window as text
end tell"#])
        .output()
        .ok()?;
    if !output.status.success() { return None; }
    let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if id.is_empty() { None } else { Some(id) }
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
    #[serde(skip_serializing_if = "Option::is_none")]
    session_type: Option<&'a str>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    ghostty_terminal_id: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QuestionPayload {
    question: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    question_header: Option<String>,
    options: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    option_descriptions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    multi_select: Option<bool>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    multi_select: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    questions: Option<Vec<QuestionPayload>>,
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

