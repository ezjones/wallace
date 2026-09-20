//! Tauri backend — thin wrapper around the existing `aac-patch-tree` engine.
//! All safety properties (backups, never-patch-twice, byte-for-byte restore)
//! stay in the engine; here we only find installs, report state, and stream logs.

use regex::Regex;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Manager};

fn pkg_root(app: &AppHandle) -> PathBuf {
    // Bundled (AppImage): resources live in the resource dir.
    if let Ok(dir) = app.path().resource_dir() {
        if dir.join("aac-patch-tree").exists() {
            return dir;
        }
    }
    // Dev (`tauri dev`): gui-v2/src-tauri -> repo root is ../..
    let exe = std::env::current_exe().unwrap_or(PathBuf::from("."));
    for cand in [
        PathBuf::from("../../aac-patch-tree"),
        PathBuf::from("../..").join("aac-patch-tree"),
        exe.parent().unwrap_or(Path::new(".")).join("aac-patch-tree"),
    ] {
        if cand.exists() {
            return cand.parent().unwrap().to_path_buf();
        }
    }
    PathBuf::from("../..")
}

fn engine(app: &AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("AAC_PATCH_TREE") {
        return PathBuf::from(p);
    }
    pkg_root(app).join("aac-patch-tree")
}

fn is_root(p: &Path) -> bool {
    p.join("bin").join("resolve").is_file() && p.join("libs").is_dir()
}

#[tauri::command]
fn find_roots() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut cands = vec![
        "/opt/resolve".to_string(),
        "/opt/DaVinciResolve".to_string(),
        "/usr/lib/resolve".to_string(),
        format!("{home}/.local/opt/DaVinciResolve"),
        format!("{home}/.local/opt/resolve"),
    ];
    // running Resolve via /proc
    if let Ok(procs) = fs::read_dir("/proc") {
        for e in procs.flatten() {
            let exe = format!("/proc/{}/exe", e.file_name().to_string_lossy());
            if let Ok(link) = fs::read_link(&exe) {
                let s = link.to_string_lossy().replace(" (deleted)", "");
                if s.ends_with("/bin/resolve") {
                    cands.push(s.trim_end_matches("/bin/resolve").to_string());
                }
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = vec![];
    for c in cands {
        let rp = fs::canonicalize(&c).unwrap_or(PathBuf::from(&c));
        if seen.insert(rp.clone()) && is_root(&rp) {
            out.push(rp.to_string_lossy().to_string());
        }
    }
    out
}

fn resolve_version(root: &str) -> String {
    use std::io::Read;
    let p = Path::new(root).join("bin").join("resolve");
    let mut f = match fs::File::open(&p) {
        Ok(f) => f,
        Err(_) => return "unknown".to_string(),
    };
    // same pattern as gui/aacfix_gui.py VERSION_RE
    let re = Regex::new(r"\b(\d{2}\.\d{1,2}\.\d{1,2}\.\d{4})\b").unwrap();
    // Stream 8MB chunks (32B overlap for boundary-spanning hits), stop at the
    // first match, cap at 256MB. The old code read the whole 653MB file.
    const CHUNK: usize = 8 * 1024 * 1024;
    const OVERLAP: usize = 32;
    const CAP: u64 = 256 * 1024 * 1024;
    let mut prev_tail = Vec::new();
    let mut buf = vec![0u8; CHUNK];
    let mut read_total: u64 = 0;
    loop {
        if read_total >= CAP {
            break;
        }
        let n = match f.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        read_total += n as u64;
        let mut window = std::mem::replace(&mut prev_tail, Vec::new());
        window.extend_from_slice(&buf[..n]);
        let s = String::from_utf8_lossy(&window);
        if let Some(c) = re.captures(&s) {
            return c[1].to_string();
        }
        let keep = window.len().min(OVERLAP);
        prev_tail = window[window.len() - keep..].to_vec();
        if n < CHUNK {
            break;
        }
    }
    "unknown".to_string()
}

fn running_pids(root: &str) -> Vec<u32> {
    let target = fs::canonicalize(Path::new(root).join("bin").join("resolve"))
        .unwrap_or(PathBuf::from(root));
    let mut out = vec![];
    let Ok(procs) = fs::read_dir("/proc") else { return out };
    for e in procs.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !name.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let link = format!("/proc/{name}/exe");
        let Ok(l) = fs::read_link(&link) else { continue };
        let s = l.to_string_lossy().replace(" (deleted)", "");
        let canon = fs::canonicalize(&s).unwrap_or(PathBuf::from(&s));
        if canon == target {
            if let Ok(pid) = name.parse() {
                out.push(pid);
            }
        }
    }
    out
}

fn engine_status(app: &AppHandle, root: &str) -> String {
    // Run through bash: resources may lose the exec bit when bundled.
    let out = Command::new("bash")
        .arg(engine(app))
        .args(["status", root])
        .output();
    let txt = match out {
        Ok(o) => format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)),
        Err(e) => format!("could not run engine: {e}"),
    };
    // strip ANSI like gui/aacfix_gui.py
    let re = Regex::new(r"\x1b\[[0-9;]*m").unwrap();
    let clean = re.replace_all(&txt, "").to_string();
    Regex::new(r"(?m)AAC support:\s*(.+)")
        .unwrap()
        .captures(&clean)
        .map(|c| c[1].trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

#[derive(Serialize)]
struct InspectFast {
    root: String,
    version: String,
    aac_support: String,
    aac_detail: String,
    backup: bool,
    writable: bool,
    running: Vec<u32>,
}

#[derive(Serialize, Clone)]
struct Compat {
    compatible: bool,
    compat_detail: String,
}

/// Fast local checks (version, status, backup, running) — returns instantly so
/// the UI paints before the slow signature scan below.
#[tauri::command]
fn inspect_fast(app: AppHandle, root: String) -> InspectFast {
    let status = engine_status(&app, &root);
    let patched = status.to_uppercase().contains("PATCHED") || status.contains("enabled");
    let backup = Path::new(&root).join("bin").join("resolve.aac-orig").exists();
    let writable = Command::new("test")
        .args(["-w", &format!("{root}/bin/resolve")])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    InspectFast {
        version: resolve_version(&root),
        aac_support: if patched { "PATCHED".into() } else { "ORIGINAL".into() },
        aac_detail: status,
        backup,
        writable,
        running: running_pids(&root),
        root,
    }
}

/// Slow part: python signature scan over the 653MB binary (10-30s).
#[tauri::command]
fn inspect_compat(app: AppHandle, root: String) -> Compat {
    let (compatible, compat_detail) = check_sites(&app, &root);
    Compat { compatible, compat_detail }
}

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// Cache keyed by binary identity (dev+ino+size+mtime): pressing Detect twice
/// must not re-scan 653MB. The scan itself runs niced + idle I/O priority so
/// the desktop (and our spinner) stays smooth while it works.
fn compat_cache() -> &'static Mutex<HashMap<String, (String, Compat)>> {
    static CACHE: OnceLock<Mutex<HashMap<String, (String, Compat)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn bin_fingerprint(path: &Path) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    let m = fs::metadata(path).ok()?;
    Some(format!("{}:{}:{}:{}", m.dev(), m.ino(), m.len(), m.mtime()))
}

fn check_sites(app: &AppHandle, root: &str) -> (bool, String) {
    let key = Path::new(root).join("bin").join("resolve");
    if let Some(fp) = bin_fingerprint(&key) {
        if let Some((old_fp, cached)) = compat_cache().lock().unwrap().get(&root.to_string()) {
            if old_fp == &fp {
                return (cached.compatible, cached.compat_detail.clone());
            }
        }
    }
    let bin = Path::new(root).join("bin").join("resolve");
    let pkg = pkg_root(app);
    let pylibs = pkg.join("vendor").join("pylibs");
    let script = format!(
        "import sys; sys.path.insert(0, '{}'); from aacpatch.locate import locate_all; _, r = locate_all('{}'); \
         bad=[x['sig'].name for x in r if x['state'] not in ('ORIGINAL','PATCHED','LOCATED')]; \
         print(f\"{{len(r)-len(bad)}}/{{len(r)}}|{{','.join(bad)}}\")",
        pkg.to_string_lossy().replace('\'', "'\\''"),
        bin.to_string_lossy().replace('\'', "'\\''"),
    );
    // NOTE: the AppImage runtime exports PYTHONHOME pointing at its own
    // usr/ (for its bundled libpython). That breaks the SYSTEM python3 we
    // exec here (stdlib mismatch -> "No module named 'encodings'"), so drop it
    // and let system python use its own stdlib + our vendored pylibs.
    // Run niced with idle I/O priority: the scan reads 653MB, and without
    // this the whole desktop (including our own spinner) stutters.
    // Fall back to plain python3 where nice/ionice are unavailable.
    let mut cmd = Command::new("ionice");
    cmd.args(["-c", "3", "nice", "-n", "10", "python3"]);
    let out = match cmd
        .env_remove("PYTHONHOME")
        .env("PYTHONPATH", format!("{}:{}", pylibs.to_string_lossy(), std::env::var("PYTHONPATH").unwrap_or_default()))
        .args(["-c", &script])
        .output()
    {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Command::new("python3")
            .env_remove("PYTHONHOME")
            .env("PYTHONPATH", format!("{}:{}", pylibs.to_string_lossy(), std::env::var("PYTHONPATH").unwrap_or_default()))
            .args(["-c", &script])
            .output(),
        other => other,
    };
    let result = match out {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            let (frac, bad) = s.split_once('|').unwrap_or((s.as_str(), ""));
            if bad.is_empty() {
                (true, format!("{frac} sites located"))
            } else {
                (false, format!("{frac} sites; unrecognised: {bad}"))
            }
        }
        Ok(o) => (false, format!("could not analyse binary ({})", String::from_utf8_lossy(&o.stderr).trim())),
        Err(e) => (false, format!("python3 unavailable ({e})")),
    };
    if result.0 {
        if let Some(fp) = bin_fingerprint(&key) {
            compat_cache().lock().unwrap().insert(
                root.to_string(),
                (fp, Compat { compatible: result.0, compat_detail: result.1.clone() }),
            );
        }
    }
    result
}

#[tauri::command]
fn engine_run(app: AppHandle, action: String, root: String) -> Result<String, String> {
    let args: Vec<&str> = match action.as_str() {
        "apply" => vec!["apply", "--originals", "keep", &root],
        "revert" => vec!["revert", &root],
        _ => return Err("unknown action".into()),
    };
    // NOTE: for /opt/resolve the process needs write access — run the desktop
    // file / AppImage via pkexec, or launch `gui-v2` itself elevated. The engine
    // deliberately does not escalate on its own (same policy as `aac-fix`).
    // Run through bash: resources may lose the exec bit when bundled.
    let out = Command::new("bash")
        .arg(engine(&app))
        .args(&args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("failed to run engine: {e}"))?;
    let mut txt = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    if !out.status.success() {
        txt.push_str(&format!("\n[exit {}]", out.status.code().unwrap_or(-1)));
        return Err(txt);
    }
    Ok(txt)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![find_roots, inspect_fast, inspect_compat, engine_run])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}

fn main() { run(); }
