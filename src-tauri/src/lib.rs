// The desktop shell: one floating window, a tray menu, and remembered position and size.
// Everything about baseball lives in the web view; this side only manages the window.

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_window_state::StateFlags;

/// Command-line arguments, so `basesmall --game=<pk> [--mode=replay]` opens a game directly.
#[tauri::command]
fn launch_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Size is per view (chooser, picker, score bar) and handled by the web view.
                .with_state_flags(StateFlags::POSITION)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![launch_args])
        .setup(|app| {
            let toggle = MenuItem::with_id(app, "toggle", "Show / hide", true, None::<&str>)?;
            let click_through =
                CheckMenuItem::with_id(app, "click_through", "Click-through", true, false, None::<&str>)?;
            let on_top = CheckMenuItem::with_id(app, "on_top", "Always on top", true, true, None::<&str>)?;
            let bg_solid = MenuItem::with_id(app, "bg:solid", "Solid", true, None::<&str>)?;
            let bg_semi = MenuItem::with_id(app, "bg:semi", "Translucent", true, None::<&str>)?;
            let bg_clear = MenuItem::with_id(app, "bg:clear", "Clear", true, None::<&str>)?;
            let background = Submenu::with_items(app, "Background", true, &[&bg_solid, &bg_semi, &bg_clear])?;
            let quit = MenuItem::with_id(app, "quit", "Quit Basesmall", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&toggle, &click_through, &on_top, &background, &separator, &quit])?;

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
