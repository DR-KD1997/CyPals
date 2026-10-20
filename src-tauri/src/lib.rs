//! CyPals native backend.
//!
//! - `storage`: JSON documents and binary assets in the app data directory.
//! - `secrets`: API keys in the OS keychain (file fallback on Android / headless Linux).
//! - `vision`:  opt-in, policy-filtered window capture (desktop only).
//! - `overlay`: transparent always-on-top window for full-body companions (desktop only).

mod error;
mod secrets;
mod storage;

#[cfg(desktop)]
mod overlay;
#[cfg(desktop)]
mod vision;

use serde::Serialize;

#[derive(Serialize)]
struct PlatformInfo {
    os: &'static str,
    desktop: bool,
}

#[tauri::command]
fn platform_info() -> PlatformInfo {
    PlatformInfo { os: std::env::consts::OS, desktop: cfg!(desktop) }
}

/// Files passed on the command line (double-clicked .cypal / card files).
#[tauri::command]
fn startup_files() -> Vec<storage::PickedFile> {
    std::env::args()
        .skip(1)
        .filter(|a| {
            let l = a.to_lowercase();
            l.ends_with(".cypal") || l.ends_with(".png") || l.ends_with(".charx") || l.ends_with(".json")
        })
        .filter_map(|p| {
            let bytes = std::fs::read(&p).ok()?;
            let name = std::path::Path::new(&p).file_name()?.to_string_lossy().into_owned();
            Some(storage::PickedFile { name, bytes })
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // Voice notes, Call mode and webcam vision need the mic/camera. The webviews
        // only ever load CyPals' own bundled UI, and each feature is opt-in inside
        // the app, so media requests are granted here; Android still shows its
        // system permission prompt the first time.
        .on_permission_request(|_webview, kind| match kind {
            tauri::webview::PermissionKind::Microphone | tauri::webview::PermissionKind::Camera => {
                tauri::webview::PermissionResponse::Allow
            }
            _ => tauri::webview::PermissionResponse::Default,
        })
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(desktop)]
    let builder = builder.manage(vision::VisionState::default()).invoke_handler(tauri::generate_handler![
        platform_info,
        startup_files,
        storage::store_read_json,
        storage::store_write_json,
        storage::store_delete,
        storage::store_list,
        storage::asset_read,
        storage::asset_write,
        storage::asset_delete_scope,
        storage::asset_list,
        secrets::secret_get,
        secrets::secret_set,
        vision::vision_set_policy,
        vision::vision_list_windows,
        vision::vision_capture_allowed,
        overlay::overlay_open,
        overlay::overlay_close,
        overlay::overlay_is_open,
        overlay::overlay_set_click_through,
    ]);

    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        platform_info,
        startup_files,
        storage::store_read_json,
        storage::store_write_json,
        storage::store_delete,
        storage::store_list,
        storage::asset_read,
        storage::asset_write,
        storage::asset_delete_scope,
        storage::asset_list,
        secrets::secret_get,
        secrets::secret_set,
    ]);

    builder.run(tauri::generate_context!()).expect("error while running CyPals");
}
