//! API key storage.
//!
//! Desktop: the OS keychain (Windows Credential Manager, Secret Service on
//! Linux, macOS Keychain). If no keychain is reachable (e.g. a Linux session
//! without a Secret Service daemon) keys fall back to a file readable only by
//! the user. Android: the app's private data directory, which other apps can't
//! read. Keys are never written into exported .cypal files or settings.

use std::collections::BTreeMap;
use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

use crate::error::Result;

const SERVICE: &str = "app.cypals";

fn fallback_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join("secrets.json"))
}

fn read_fallback<R: Runtime>(app: &AppHandle<R>) -> BTreeMap<String, String> {
    fallback_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_fallback<R: Runtime>(app: &AppHandle<R>, map: &BTreeMap<String, String>) -> Result<()> {
    let p = fallback_path(app)?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(&p, serde_json::to_vec(map)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(desktop)]
fn keychain_get(name: &str) -> Option<String> {
    keyring::Entry::new(SERVICE, name).ok()?.get_password().ok()
}

#[cfg(desktop)]
fn keychain_set(name: &str, value: &str) -> bool {
    match keyring::Entry::new(SERVICE, name) {
        Ok(e) if value.is_empty() => matches!(e.delete_credential(), Ok(()) | Err(keyring::Error::NoEntry)),
        Ok(e) => e.set_password(value).is_ok(),
        Err(_) => false,
    }
}

#[cfg(mobile)]
fn keychain_get(_: &str) -> Option<String> {
    None
}

#[cfg(mobile)]
fn keychain_set(_: &str, _: &str) -> bool {
    false
}

#[tauri::command]
pub fn secret_get<R: Runtime>(app: AppHandle<R>, name: String) -> String {
    let _ = SERVICE;
    keychain_get(&name).or_else(|| read_fallback(&app).get(&name).cloned()).unwrap_or_default()
}

#[tauri::command]
pub fn secret_set<R: Runtime>(app: AppHandle<R>, name: String, value: String) -> Result<()> {
    let mut map = read_fallback(&app);
    if keychain_set(&name, &value) {
        // Stored securely; make sure no stale plain copy lingers.
        if map.remove(&name).is_some() {
            write_fallback(&app, &map)?;
        }
        return Ok(());
    }
    if value.is_empty() {
        map.remove(&name);
    } else {
        map.insert(name, value);
    }
    write_fallback(&app, &map)
}
