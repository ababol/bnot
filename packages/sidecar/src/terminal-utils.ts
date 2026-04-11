export function escapeForAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function escapeShell(s: string): string {
  return s.replace(/'/g, "'\\''");
}
