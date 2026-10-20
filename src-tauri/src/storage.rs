//! App-data storage.
//!
//!   <app_data>/store/<key>.json           JSON documents (companions/…, lorebooks/…, settings)
//!   <app_data>/assets/<scope>/<path>      binary assets (models, portraits, Live2D folders)
//!
//! Keys, scopes and paths come from the webview, so every segment is validated
//! to stay inside its root (no `..`, absolute paths or drive letters).

use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::{ipc::Request, ipc::Response, AppHandle, Manager, Runtime};

use crate::error::{Error, Result};

#[derive(Serialize)]
pub struct PickedFile {
    pub name: String,
    pub bytes: Vec<u8>,
}

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    Ok(app.path().app_data_dir()?)
}

/// Joins a relative, slash-separated path under `root`, rejecting traversal.
pub fn safe_join(root: &Path, rel: &str) -> Result<PathBuf> {
    let rel = rel.replace('\\', "/");
    if rel.is_empty() || rel.starts_with('/') || rel.contains(':') {
        return Err(Error::msg(format!("invalid path: {rel}")));
    }
    let mut out = root.to_path_buf();
    for c in Path::new(&rel).components() {
        match c {
            Component::Normal(seg) => out.push(seg),
            Component::CurDir => {}
            _ => return Err(Error::msg(format!("invalid path: {rel}"))),
        }
    }
    Ok(out)
}

fn key_path<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<PathBuf> {
    safe_join(&data_dir(app)?.join("store"), &format!("{key}.json"))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp~");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[tauri::command]
pub fn store_read_json<R: Runtime>(app: AppHandle<R>, key: String) -> Result<Option<String>> {
    let p = key_path(&app, &key)?;
    match std::fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub fn store_write_json<R: Runtime>(app: AppHandle<R>, key: String, json: String) -> Result<()> {
    // Validate before writing so a bad payload never replaces good data.
    serde_json::from_str::<serde_json::Value>(&json)?;
    write_atomic(&key_path(&app, &key)?, json.as_bytes())
}

#[tauri::command]
pub fn store_delete<R: Runtime>(app: AppHandle<R>, key: String) -> Result<()> {
    match std::fs::remove_file(key_path(&app, &key)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

fn walk(dir: &Path, base: &Path, out: &mut Vec<String>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, base, out);
        } else if let Ok(rel) = p.strip_prefix(base) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

#[tauri::command]
pub fn store_list<R: Runtime>(app: AppHandle<R>, prefix: String) -> Result<Vec<String>> {
    let root = data_dir(&app)?.join("store");
    let mut all = Vec::new();
    walk(&root, &root, &mut all);
    Ok(all
        .into_iter()
        .filter_map(|k| k.strip_suffix(".json").map(str::to_owned))
        .filter(|k| k.starts_with(&prefix))
        .collect())
}

fn scope_dir<R: Runtime>(app: &AppHandle<R>, scope: &str) -> Result<PathBuf> {
    safe_join(&data_dir(app)?.join("assets"), scope)
}

/// Returns raw bytes (an ArrayBuffer in JS), avoiding JSON-encoding large models.
#[tauri::command]
pub fn asset_read<R: Runtime>(app: AppHandle<R>, scope: String, path: String) -> Result<Response> {
    let p = safe_join(&scope_dir(&app, &scope)?, &path)?;
    match std::fs::read(&p) {
        Ok(b) => Ok(Response::new(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(Error::msg("not found")),
        Err(e) => Err(e.into()),
    }
}

/// Raw-body command: bytes in the request body, scope/path in headers.
#[tauri::command]
pub fn asset_write<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> Result<()> {
    let header = |name: &str| -> Result<String> {
        let v = request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| Error::msg(format!("missing {name} header")))?;
        Ok(percent_decode(v))
    };
    let scope = header("x-scope")?;
    let path = header("x-path")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(Error::msg("asset_write expects a raw byte body"));
    };
    write_atomic(&safe_join(&scope_dir(&app, &scope)?, &path)?, bytes)
}

#[tauri::command]
pub fn asset_delete_scope<R: Runtime>(app: AppHandle<R>, scope: String) -> Result<()> {
    match std::fs::remove_dir_all(scope_dir(&app, &scope)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn asset_list<R: Runtime>(app: AppHandle<R>, scope: String) -> Result<Vec<String>> {
    let root = scope_dir(&app, &scope)?;
    let mut out = Vec::new();
    walk(&root, &root, &mut out);
    Ok(out)
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal() {
        let root = Path::new("/data");
        assert!(safe_join(root, "../etc/passwd").is_err());
        assert!(safe_join(root, "/abs").is_err());
        assert!(safe_join(root, "C:/x").is_err());
        assert!(safe_join(root, "a/../../b").is_err());
        assert_eq!(safe_join(root, "companion/x/assets/a.png").unwrap(), Path::new("/data/companion/x/assets/a.png"));
        assert_eq!(safe_join(root, "a\\b.png").unwrap(), Path::new("/data/a/b.png"));
    }

    #[test]
    fn decodes_percent() {
        assert_eq!(percent_decode("companion%2Fcp_1"), "companion/cp_1");
        assert_eq!(percent_decode("assets%2F%E3%83%9F%E3%83%A9.png"), "assets/ミラ.png");
        assert_eq!(percent_decode("100%"), "100%");
    }
}
