//! Opt-in screen vision.
//!
//! The webview sets a policy; capture only ever happens through
//! `vision_capture_allowed`, which re-applies that policy here in Rust (so a
//! compromised or buggy UI can't capture arbitrary windows), downsizes the
//! frame and returns JPEG base64 for the model. Mirrors src/core/vision/policy.ts.

use std::sync::Mutex;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::State;
use xcap::image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage};

use crate::error::{Error, Result};

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScreenPolicy {
    pub enabled: bool,
    pub mode: String, // "allowlist" | "blocklist"
    pub apps: Vec<String>,
    pub titles: Vec<String>,
    pub scope: String, // "focused" | "all-allowed"
    #[serde(default = "default_width")]
    pub max_width: u32,
}

fn default_width() -> u32 {
    1280
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct VisionPolicy {
    pub screen: ScreenPolicy,
}

#[derive(Default)]
pub struct VisionState(pub Mutex<ScreenPolicy>);

#[derive(Serialize)]
pub struct WindowInfo {
    id: u32,
    app: String,
    title: String,
    focused: bool,
    minimized: bool,
}

#[derive(Serialize)]
pub struct Frame {
    label: String,
    mime: &'static str,
    data: String,
}

const ALWAYS_BLOCKED: &[&str] = &[
    "1password", "bitwarden", "keepass", "keepassxc", "lastpass", "dashlane", "enpass", "proton pass",
    "keychain access", "seahorse", "kwalletmanager", "windows security", "credential manager", "cypals",
];

const SENSITIVE_WORDS: &[&str] = &[
    "bank", "banking", "password", "sign in", "sign-in", "signin", "log in", "log-in", "login",
    "2fa", "authenticator", "incognito", "private browsing", "inprivate",
];

fn contains_word(hay: &str, word: &str) -> bool {
    hay.match_indices(word).any(|(i, _)| {
        let before = hay[..i].chars().next_back();
        let after = hay[i + word.len()..].chars().next();
        !before.is_some_and(char::is_alphanumeric) && !after.is_some_and(char::is_alphanumeric)
    })
}

/// Returns Ok(()) if the window may be captured under the policy, Err(reason) otherwise.
pub fn decide(app: &str, title: &str, minimized: bool, p: &ScreenPolicy) -> std::result::Result<(), &'static str> {
    if !p.enabled {
        return Err("Screen sharing is off");
    }
    if minimized {
        return Err("Window is minimized");
    }
    let app_l = app.to_lowercase();
    let title_l = title.to_lowercase();
    if ALWAYS_BLOCKED.iter().any(|b| app_l.contains(b) || title_l.contains(b)) {
        return Err("Protected app");
    }
    if SENSITIVE_WORDS.iter().any(|w| contains_word(&title_l, w)) {
        return Err("Sensitive page");
    }
    let listed = p.apps.iter().map(|a| a.trim().to_lowercase()).any(|a| !a.is_empty() && app_l.contains(&a))
        || p.titles.iter().map(|t| t.trim().to_lowercase()).any(|t| !t.is_empty() && title_l.contains(&t));
    match (p.mode.as_str(), listed) {
        ("blocklist", true) => Err("On the block-list"),
        ("blocklist", false) => Ok(()),
        (_, true) => Ok(()),
        (_, false) => Err("Not on the allow-list"),
    }
}

#[tauri::command]
pub fn vision_set_policy(state: State<'_, VisionState>, policy: VisionPolicy) -> Result<()> {
    *state.0.lock().map_err(|_| Error::msg("policy lock poisoned"))? = policy.screen;
    Ok(())
}

#[tauri::command]
pub async fn vision_list_windows() -> Result<Vec<WindowInfo>> {
    tauri::async_runtime::spawn_blocking(|| {
        let wins = xcap::Window::all().map_err(|e| Error::msg(format!("Can't list windows: {e}")))?;
        Ok(wins
            .into_iter()
            .filter_map(|w| {
                let title = w.title().unwrap_or_default();
                let app = w.app_name().unwrap_or_default();
                if title.is_empty() && app.is_empty() {
                    return None;
                }
                Some(WindowInfo {
                    id: w.id().ok()?,
                    app,
                    title,
                    focused: w.is_focused().unwrap_or(false),
                    minimized: w.is_minimized().unwrap_or(false),
                })
            })
            .collect())
    })
    .await
    .map_err(|e| Error::msg(e.to_string()))?
}

#[tauri::command]
pub async fn vision_capture_allowed(state: State<'_, VisionState>) -> Result<Vec<Frame>> {
    let policy = state.0.lock().map_err(|_| Error::msg("policy lock poisoned"))?.clone();
    if !policy.enabled {
        return Ok(vec![]);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let wins = xcap::Window::all().map_err(|e| Error::msg(format!("Can't list windows: {e}")))?;
        let mut allowed: Vec<_> = wins
            .into_iter()
            .filter(|w| {
                let app = w.app_name().unwrap_or_default();
                let title = w.title().unwrap_or_default();
                decide(&app, &title, w.is_minimized().unwrap_or(true), &policy).is_ok()
            })
            .collect();
        if policy.scope != "all-allowed" {
            allowed.retain(|w| w.is_focused().unwrap_or(false));
            allowed.truncate(1);
        } else {
            allowed.truncate(4);
        }
        let mut frames = Vec::new();
        for w in allowed {
            let Ok(img) = w.capture_image() else { continue };
            let mut dynimg = DynamicImage::ImageRgba8(img);
            if dynimg.width() > policy.max_width {
                let h = (dynimg.height() as f32 * policy.max_width as f32 / dynimg.width() as f32).round() as u32;
                dynimg = dynimg.resize_exact(policy.max_width, h.max(1), FilterType::Triangle);
            }
            let mut buf = Vec::new();
            JpegEncoder::new_with_quality(&mut buf, 80)
                .encode_image(&dynimg.to_rgb8())
                .map_err(|e| Error::msg(e.to_string()))?;
            let app = w.app_name().unwrap_or_default();
            let title = w.title().unwrap_or_default();
            frames.push(Frame {
                label: if title.is_empty() { app } else { format!("{app} — {title}") },
                mime: "image/jpeg",
                data: base64::engine::general_purpose::STANDARD.encode(buf),
            });
        }
        Ok(frames)
    })
    .await
    .map_err(|e| Error::msg(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pol(mode: &str, apps: &[&str]) -> ScreenPolicy {
        ScreenPolicy {
            enabled: true,
            mode: mode.into(),
            apps: apps.iter().map(|s| s.to_string()).collect(),
            titles: vec![],
            scope: "focused".into(),
            max_width: 1280,
        }
    }

    #[test]
    fn off_by_default() {
        assert!(decide("krita", "x", false, &ScreenPolicy::default()).is_err());
    }

    #[test]
    fn allowlist_and_blocklist() {
        assert!(decide("Krita", "art.kra", false, &pol("allowlist", &["krita"])).is_ok());
        assert!(decide("firefox", "news", false, &pol("allowlist", &["krita"])).is_err());
        assert!(decide("firefox", "news", false, &pol("blocklist", &["discord"])).is_ok());
        assert!(decide("discord", "chat", false, &pol("blocklist", &["discord"])).is_err());
    }

    #[test]
    fn protected_and_sensitive_always_blocked() {
        assert_eq!(decide("KeePassXC", "db", false, &pol("blocklist", &[])), Err("Protected app"));
        assert_eq!(decide("cypals", "CyPals", false, &pol("blocklist", &[])), Err("Protected app"));
        assert_eq!(decide("firefox", "Online Banking — Firefox", false, &pol("blocklist", &[])), Err("Sensitive page"));
        assert_eq!(decide("firefox", "Sign in to GitHub", false, &pol("blocklist", &[])), Err("Sensitive page"));
        // whole-word: "loginov" or "banks" in unrelated words shouldn't trip
        assert!(decide("code", "bankruptcy-notes.md", false, &pol("blocklist", &[])).is_ok());
    }

    #[test]
    fn minimized_never_captured() {
        assert!(decide("krita", "x", true, &pol("allowlist", &["krita"])).is_err());
    }
}
