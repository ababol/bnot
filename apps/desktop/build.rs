fn main() {
    // Re-embed web assets whenever the frontend build output changes.
    println!("cargo:rerun-if-changed=../web/dist");
    tauri_build::build()
}
