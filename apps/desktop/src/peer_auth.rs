use std::io;
use std::os::fd::AsRawFd;
use std::path::PathBuf;

use libproc::libproc::proc_pid;

const SOL_LOCAL: libc::c_int = 0;
const LOCAL_PEERPID: libc::c_int = 0x002;

#[derive(Debug)]
pub enum AuthError {
    UidMismatch { expected: u32, got: u32 },
    PeerPidFailed(io::Error),
    PidPathFailed(String),
    PathNotAllowed { got: String },
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthError::UidMismatch { expected, got } => {
                write!(f, "peer uid {got} != expected {expected}")
            }
            AuthError::PeerPidFailed(e) => write!(f, "LOCAL_PEERPID failed: {e}"),
            AuthError::PidPathFailed(s) => write!(f, "proc_pidpath failed: {s}"),
            AuthError::PathNotAllowed { got } => write!(f, "peer exe not allowed: {got}"),
        }
    }
}

impl std::error::Error for AuthError {}

/// Verify the connecting peer is one of the allowed bnot-bridge binaries.
/// Returns the peer pid on success.
pub fn verify_bridge_peer<F: AsRawFd>(
    stream: &F,
    allowed_paths: &[PathBuf],
) -> Result<i32, AuthError> {
    let fd = stream.as_raw_fd();

    // 1. UID check via getpeereid
    let mut uid: libc::uid_t = 0;
    let mut gid: libc::gid_t = 0;
    let rc = unsafe { libc::getpeereid(fd, &mut uid, &mut gid) };
    if rc != 0 {
        return Err(AuthError::PeerPidFailed(io::Error::last_os_error()));
    }
    let our_uid = unsafe { libc::geteuid() };
    if uid != our_uid {
        return Err(AuthError::UidMismatch {
            expected: our_uid,
            got: uid,
        });
    }

    // 2. Peer PID via LOCAL_PEERPID
    let mut pid: libc::pid_t = 0;
    let mut len: libc::socklen_t = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
    let rc = unsafe {
        libc::getsockopt(
            fd,
            SOL_LOCAL,
            LOCAL_PEERPID,
            &mut pid as *mut _ as *mut libc::c_void,
            &mut len,
        )
    };
    if rc != 0 {
        return Err(AuthError::PeerPidFailed(io::Error::last_os_error()));
    }

    // 3. Resolve peer executable path and compare against allowlist
    let actual = proc_pid::pidpath(pid).map_err(AuthError::PidPathFailed)?;
    let actual_canon = PathBuf::from(&actual)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(&actual));

    let matched = allowed_paths.iter().any(|p| p == &actual_canon);
    if !matched {
        return Err(AuthError::PathNotAllowed {
            got: actual_canon.to_string_lossy().into_owned(),
        });
    }

    Ok(pid)
}

/// Resolve all acceptable bnot-bridge executable paths (canonicalized).
/// Bundled release path is preferred; dev paths under target/ are also accepted
/// when the binary exists, supporting `pnpm dev` workflow.
pub fn allowed_bridge_paths() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();

    // Release: <App>.app/Contents/Resources/bin/bnot-bridge
    if let Ok(exe) = std::env::current_exe() {
        if let Some(contents) = exe.parent().and_then(|p| p.parent()) {
            let bundled = contents.join("Resources/bin/bnot-bridge");
            if let Ok(canon) = bundled.canonicalize() {
                out.push(canon);
            }
        }
    }

    // Dev: target/{debug,release}/bnot-bridge under cwd or up to two levels up.
    if let Ok(cwd) = std::env::current_dir() {
        let dev_candidates = [
            cwd.join("target/debug/bnot-bridge"),
            cwd.join("target/release/bnot-bridge"),
            cwd.join("../../target/debug/bnot-bridge"),
            cwd.join("../../target/release/bnot-bridge"),
            cwd.join("../target/debug/bnot-bridge"),
            cwd.join("../target/release/bnot-bridge"),
        ];
        for c in dev_candidates.iter() {
            if let Ok(canon) = c.canonicalize() {
                if !out.contains(&canon) {
                    out.push(canon);
                }
            }
        }
    }

    out
}
