mod backup;
mod database;
mod image_store;
mod screenshot;
mod settings;

use database::Database;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show-main", "打开主窗口", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit-app", "退出应用", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("CS道具战术本")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show-main" => show_main_window(app),
            "quit-app" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg(windows)]
fn apply_windows_frame_colors(window: &tauri::WebviewWindow) -> Result<(), String> {
    use std::{ffi::c_void, mem::size_of};
    use windows_sys::Win32::{
        Foundation::HWND,
        Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
        },
    };

    fn set_attribute<T>(hwnd: HWND, attribute: i32, value: &T) -> Result<(), String> {
        let result = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                attribute as u32,
                value as *const T as *const c_void,
                size_of::<T>() as u32,
            )
        };

        if result < 0 {
            Err(format!(
                "DWM 属性 {attribute} 设置失败：HRESULT {result:#x}"
            ))
        } else {
            Ok(())
        }
    }

    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
    let dark_mode = 1_i32;
    // COLORREF uses 0x00BBGGRR. Keep the native frame aligned with the web UI palette.
    let caption_color = 0x001d_1815_u32; // #15181d
    let border_color = 0x003a_302a_u32; // #2a303a
    let text_color = 0x00f7_f1ed_u32; // #edf1f7

    set_attribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark_mode)?;
    set_attribute(hwnd, DWMWA_CAPTION_COLOR, &caption_color)?;
    set_attribute(hwnd, DWMWA_BORDER_COLOR, &border_color)?;
    set_attribute(hwnd, DWMWA_TEXT_COLOR, &text_color)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        screenshot::begin_capture(app.clone());
                    }
                })
                .build(),
        )
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let close_to_tray = window
                        .app_handle()
                        .try_state::<settings::SettingsManager>()
                        .and_then(|settings| settings.close_to_tray().ok())
                        .unwrap_or(true);
                    if close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .setup(|app| {
            let default_data_directory = app.path().app_data_dir()?;
            let settings_path = app.path().app_config_dir()?.join("settings.json");
            let settings_manager =
                settings::SettingsManager::new(settings_path, default_data_directory)
                    .map_err(std::io::Error::other)?;
            let app_data_directory = settings_manager
                .data_directory()
                .map_err(std::io::Error::other)?;
            let screenshot_shortcut = settings_manager
                .screenshot_shortcut()
                .map_err(std::io::Error::other)?;
            app.manage(settings_manager);
            setup_tray(app)?;
            app.asset_protocol_scope()
                .allow_directory(app_data_directory.join("images"), true)?;
            app.asset_protocol_scope()
                .allow_directory(app_data_directory.join("temp"), true)?;
            let database = Database::new(app_data_directory.join("notebook.db"));
            database.initialize().map_err(std::io::Error::other)?;
            app.manage(database);
            let backup_service = backup::BackupService::new(app_data_directory.clone());
            app.manage(backup_service.clone());
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = backup_service.create_automatic_if_due() {
                    eprintln!("无法创建自动备份：{error}");
                }
            });
            let screenshot_manager = screenshot::ScreenshotManager::new(app_data_directory)
                .map_err(std::io::Error::other)?;
            app.manage(screenshot_manager);
            screenshot::prepare_overlay(app.handle()).map_err(std::io::Error::other)?;
            if let Some(main_window) = app.get_webview_window("main") {
                main_window.set_theme(Some(tauri::Theme::Dark))?;
                #[cfg(windows)]
                if let Err(error) = apply_windows_frame_colors(&main_window) {
                    eprintln!("无法应用 Windows 窗口配色：{error}");
                }
                main_window.show()?;
                main_window.set_focus()?;
            }

            if let Some(shortcut) = screenshot_shortcut {
                if let Err(error) = app.global_shortcut().register(shortcut.as_str()) {
                    eprintln!("无法注册全局截图快捷键 {shortcut}：{error}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            database::get_notes,
            database::get_note,
            database::create_note,
            database::update_note,
            database::save_note_with_images,
            database::delete_note,
            database::save_image_annotation,
            database::get_tags,
            database::create_tag,
            backup::export_backup,
            backup::restore_backup,
            backup::get_backup_status,
            screenshot::get_capture_session,
            screenshot::show_capture_overlay,
            screenshot::complete_capture,
            screenshot::cancel_capture,
            screenshot::discard_temp_images,
            settings::get_settings,
            settings::set_screenshot_shortcut,
            settings::set_close_to_tray,
            settings::change_data_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CS道具战术本");
}
