//! Desktop overlay: a borderless, transparent, always-on-top window that
//! covers the current monitor. It ignores the mouse (clicks reach the apps
//! underneath) except while the pointer is over a character, which the
//! webview reports via `overlay_set_click_through(false)`.
//!
//! Wayland note: compositors may ignore always-on-top and positioning for
//! clients; on Wayland sessions the overlay works best under XWayland
//! (GDK_BACKEND=x11), which the README explains.

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

use crate::error::Result;

const LABEL: &str = "overlay";

#[tauri::command]
pub async fn overlay_open<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        w.show()?;
        return Ok(());
    }
    let main = app.get_webview_window("main");
    let monitor = main
        .as_ref()
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    let mut b = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html?overlay=1".into()))
        .title("CyPals overlay")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false);
    if let Some(m) = &monitor {
        let scale = m.scale_factor();
        let pos = m.position().to_logical::<f64>(scale);
        let size = m.size().to_logical::<f64>(scale);
        b = b.position(pos.x, pos.y).inner_size(size.width, size.height);
    } else {
        b = b.maximized(true);
    }
    let w = b.build()?;
    // Must show before enabling click-through: on Linux the native GDK window
    // only exists once the window is realized, and tao unwraps it.
    w.show()?;
    w.set_ignore_cursor_events(true)?;
    Ok(())
}

#[tauri::command]
pub fn overlay_close<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        w.close()?;
    }
    Ok(())
}

#[tauri::command]
pub fn overlay_is_open<R: Runtime>(app: AppHandle<R>) -> bool {
    app.get_webview_window(LABEL).is_some()
}

#[tauri::command]
pub fn overlay_set_click_through<R: Runtime>(app: AppHandle<R>, through: bool) -> Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        // Ignore requests for a hidden (unrealized) window rather than crash.
        if w.is_visible().unwrap_or(false) {
            w.set_ignore_cursor_events(through)?;
        }
    }
    Ok(())
}
