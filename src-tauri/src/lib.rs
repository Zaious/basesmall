// The desktop shell: one floating window, a tray menu, and remembered position and size.
// Everything about baseball lives in the web view; this side only manages the window.

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use std::path::PathBuf;
use tauri_plugin_window_state::StateFlags;

/// Command-line arguments, so `basesmall --game=<pk> [--mode=replay]` opens a game directly.
#[tauri::command]
fn launch_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

/// Where settings and user styles live: the app config dir, or `BASESMALL_CONFIG_DIR` when set
/// (checking runs use a scratch folder so they never touch the user's own settings).
fn config_dir(app: &tauri::AppHandle) -> Option<(PathBuf, bool)> {
    if let Some(dir) = std::env::var_os("BASESMALL_CONFIG_DIR").filter(|d| !d.is_empty()) {
        return Some((PathBuf::from(dir), true));
    }
    app.path().app_config_dir().ok().map(|d| (d, false))
}

/// The config folder in use, and whether it was overridden by `BASESMALL_CONFIG_DIR`.
#[tauri::command]
fn config_info(app: tauri::AppHandle) -> (String, bool) {
    config_dir(&app).map(|(d, o)| (d.display().to_string(), o)).unwrap_or_default()
}

const SETTINGS_MAX_BYTES: u64 = 256 * 1024;

/// The saved settings file, or nothing before the first save. The web view validates it.
#[tauri::command]
fn read_settings(app: tauri::AppHandle) -> Option<String> {
    let (dir, _) = config_dir(&app)?;
    let path = dir.join("settings.json");
    if std::fs::metadata(&path).ok()?.len() > SETTINGS_MAX_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

/// Save settings atomically: write a temporary file, then rename it over the old one. A file the
/// user broke by hand (not valid JSON) is kept as settings.broken.json instead of being lost.
#[tauri::command]
fn write_settings(app: tauri::AppHandle, text: String) -> Result<(), String> {
    if text.len() as u64 > SETTINGS_MAX_BYTES || serde_json::from_str::<serde_json::Value>(&text).is_err() {
        return Err("settings must be JSON under 256 KB".into());
    }
    let (dir, _) = config_dir(&app).ok_or("no config folder")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("settings.json");
    if let Ok(old) = std::fs::read_to_string(&path) {
        // A byte-order mark (some Windows editors add one) is fine; the web view skips it too.
        if serde_json::from_str::<serde_json::Value>(old.trim_start_matches('\u{feff}')).is_err() {
            let _ = std::fs::write(dir.join("settings.broken.json"), old);
        }
    }
    let tmp = dir.join("settings.json.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Style files from `<config dir>/styles/` as (file name, text). Styles are data only; the
/// web view validates each one and skips any that fail. The folder is created so users can find it.
#[tauri::command]
fn user_styles(app: tauri::AppHandle) -> Vec<(String, String)> {
    const MAX_FILES: usize = 50;
    const MAX_BYTES: u64 = 64 * 1024;
    let Some((dir, _)) = config_dir(&app) else { return Vec::new() };
    let dir = dir.join("styles");
    let _ = std::fs::create_dir_all(&dir);
    let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new() };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() || meta.len() > MAX_BYTES {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()).map(str::to_owned) else { continue };
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        out.push((name, text));
        if out.len() >= MAX_FILES {
            break;
        }
    }
    out.sort();
    out
}

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Size is per view (chooser, picker, score bar) and handled by the web view.
                .with_state_flags(StateFlags::POSITION)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        // Closing the main window quits, notification windows included; otherwise the app would
        // keep running with only a ticker or a card left on screen.
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![launch_args, user_styles, config_info, read_settings, write_settings])
        .setup(|app| {
            let toggle = MenuItem::with_id(app, "toggle", "Show / hide", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let click_through =
                CheckMenuItem::with_id(app, "click_through", "Click-through", true, false, None::<&str>)?;
            let on_top = CheckMenuItem::with_id(app, "on_top", "Always on top", true, true, None::<&str>)?;
            let bg_solid = MenuItem::with_id(app, "bg:solid", "Solid", true, None::<&str>)?;
            let bg_semi = MenuItem::with_id(app, "bg:semi", "Translucent", true, None::<&str>)?;
            let bg_clear = MenuItem::with_id(app, "bg:clear", "Clear", true, None::<&str>)?;
            let background = Submenu::with_items(app, "Background", true, &[&bg_solid, &bg_semi, &bg_clear])?;
            let quit = MenuItem::with_id(app, "quit", "Quit Basesmall", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&toggle, &settings, &click_through, &on_top, &background, &separator, &quit])?;

            let ct = click_through.clone();
            let ot = on_top.clone();
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("bundled icon"))
                .tooltip("Basesmall")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(move |app, event| {
                    let Some(window) = app.get_webview_window("main") else { return };
                    match event.id().as_ref() {
                        "toggle" => {
                            if window.is_visible().unwrap_or(true) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                            }
                        }
                        // Clicks pass through to whatever is underneath; only the tray can turn it off.
                        "click_through" => {
                            let _ = window.set_ignore_cursor_events(ct.is_checked().unwrap_or(false));
                        }
                        "on_top" => {
                            let _ = window.set_always_on_top(ot.is_checked().unwrap_or(true));
                        }
                        "settings" => {
                            let _ = window.show();
                            let _ = window.emit("open-settings", ());
                        }
                        id if id.starts_with("bg:") => {
                            let _ = window.emit("bg-mode", &id[3..]);
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    let _ = window.show();
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Basesmall");
}
