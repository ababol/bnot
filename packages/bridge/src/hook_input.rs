use serde::Deserialize;

#[derive(Deserialize)]
pub struct ClaudeHookInput {
    #[serde(rename = "session_id")]
    pub session_id: Option<String>,
    #[serde(rename = "hookEventName")]
    pub hook_event_name: Option<String>,
    #[serde(rename = "tool_name")]
    pub tool_name: Option<String>,
    #[serde(rename = "tool_input")]
    pub tool_input: Option<ToolInput>,
    #[serde(rename = "tool_response")]
    pub tool_response: Option<ToolResponse>,
    pub cwd: Option<String>,
    #[serde(rename = "session_type")]
    pub session_type: Option<String>,
}

#[derive(Deserialize)]
pub struct ToolInput {
    pub command: Option<String>,
    #[serde(rename = "file_path")]
    pub file_path: Option<String>,
    pub content: Option<String>,
    pub diff: Option<String>,
    #[serde(rename = "old_string")]
    pub old_string: Option<String>,
    #[serde(rename = "new_string")]
    pub new_string: Option<String>,
    pub question: Option<String>,
    pub options: Option<Vec<String>>,
    pub questions: Option<Vec<QuestionItem>>,
}

#[derive(Deserialize)]
pub struct QuestionItem {
    pub question: Option<String>,
    pub options: Option<Vec<OptionItem>>,
}

#[derive(Deserialize)]
pub struct OptionItem {
    pub label: Option<String>,
}

#[derive(Deserialize)]
pub struct ToolResponse {
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
    pub success: Option<bool>,
}
