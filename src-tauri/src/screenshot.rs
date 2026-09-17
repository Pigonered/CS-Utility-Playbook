use image::GenericImageView;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{BufWriter, ErrorKind, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::Instant,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use uuid::Uuid;

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::HWND,
    Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT,
        DIB_RGB_COLORS, SRCCOPY,
    },
    UI::WindowsAndMessaging::{
        GetForegroundWindow, GetSystemMetrics, IsIconic, IsWindow, SetForegroundWindow,
        ShowWindowAsync, SM_CXSCREEN, SM_CYSCREEN, SW_RESTORE,
    },
};

const OVERLAY_LABEL: &str = "screenshot-overlay";
const CANCEL_SHORTCUTS: [&str; 4] = ["Escape", "Shift+Escape", "Alt+Escape", "Shift+Alt+Escape"];

fn register_cancel_shortcuts(app: &AppHandle) {
    for shortcut in CANCEL_SHORTCUTS {
        let _ = app.global_shortcut().register(shortcut);
    }
}

fn unregister_cancel_shortcuts(app: &AppHandle) {
    for shortcut in CANCEL_SHORTCUTS {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSession {
    image_path: String,
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSelection {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, Serialize)]
struct ScreenshotCompleted {
    path: String,
}

#[derive(Debug, Default)]
struct CaptureState {
    next_id: u64,
    active_id: Option<u64>,
    session: Option<CaptureSession>,
    previous_foreground_window: Option<isize>,
}

#[derive(Debug)]
pub struct ScreenshotManager {
    capture_directory: PathBuf,
    state: Mutex<CaptureState>,
}

impl ScreenshotManager {
    pub fn new(app_data_directory: PathBuf) -> Result<Self, String> {
        let capture_directory = app_data_directory.join("temp").join("captures");
        fs::create_dir_all(&capture_directory)
            .map_err(|error| format!("无法创建截图临时目录：{error}"))?;

        // 上次异常退出留下的临时截图不会进入笔记，可在启动时安全清理。
        if let Ok(entries) = fs::read_dir(&capture_directory) {
            for entry in entries.flatten() {
                if entry.path().is_file() {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }

        Ok(Self {
            capture_directory,
            state: Mutex::new(CaptureState::default()),
        })
    }

    fn begin(&self, previous_foreground_window: Option<isize>) -> Result<u64, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "截图状态不可用".to_string())?;
        if state.active_id.is_some() {
            return Err("截图已在进行中".to_string());
        }
        state.next_id = state.next_id.wrapping_add(1);
        let capture_id = state.next_id;
        state.active_id = Some(capture_id);
        state.session = None;
        state.previous_foreground_window = previous_foreground_window;
        Ok(capture_id)
    }

    fn set_session(&self, capture_id: u64, session: CaptureSession) -> Result<bool, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "截图状态不可用".to_string())?;
        if state.active_id != Some(capture_id) {
            return Ok(false);
        }
        state.session = Some(session);
        Ok(true)
    }

    fn session(&self) -> Result<CaptureSession, String> {
        self.state
            .lock()
            .map_err(|_| "截图状态不可用".to_string())?
            .session
            .clone()
            .ok_or_else(|| "没有可用的截图画面".to_string())
    }

    fn finish(&self) -> Result<(Option<CaptureSession>, Option<isize>), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "截图状态不可用".to_string())?;
        state.active_id = None;
        Ok((
            state.session.take(),
            state.previous_foreground_window.take(),
        ))
    }

    fn reset_after_error(
        &self,
        capture_id: u64,
    ) -> Result<(bool, Option<CaptureSession>, Option<isize>), String> {
        let Ok(mut state) = self.state.lock() else {
            return Err("截图状态不可用".to_string());
        };
        if state.active_id != Some(capture_id) {
            return Ok((false, None, None));
        }
        state.active_id = None;
        Ok((
            true,
            state.session.take(),
            state.previous_foreground_window.take(),
        ))
    }

    fn raw_path(&self) -> PathBuf {
        self.capture_directory
            .join(format!("raw-{}.bmp", Uuid::new_v4()))
    }

    fn result_path(&self) -> PathBuf {
        self.capture_directory
            .join(format!("capture-{}.png", Uuid::new_v4()))
    }

    fn is_managed_temp_path(&self, path: &Path) -> bool {
        path.is_absolute()
            && path.starts_with(&self.capture_directory)
            && !path
                .components()
                .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    }
}

pub fn begin_capture(app: AppHandle) {
    let manager = app.state::<ScreenshotManager>();
    let Ok(capture_id) = manager.begin(current_foreground_window()) else {
        return;
    };

    std::thread::spawn(move || {
        // The global-shortcut plugin holds its shortcut-map lock while invoking
        // handlers. Register on this worker only after the triggering handler has
        // returned, otherwise pressing the capture shortcut deadlocks the app.
        register_cancel_shortcuts(&app);
        let started_at = Instant::now();
        if let Err(error) = capture_primary_monitor(&app, capture_id) {
            fail_capture(&app, capture_id, error);
        } else {
            eprintln!("截图画面已就绪：{} ms", started_at.elapsed().as_millis());
        }
    });
}

fn capture_primary_monitor(app: &AppHandle, capture_id: u64) -> Result<(), String> {
    let manager = app.state::<ScreenshotManager>();
    let image_path = manager.raw_path();
    let (width, height) = capture_primary_to_bmp(&image_path)?;

    let session = CaptureSession {
        image_path: image_path.to_string_lossy().into_owned(),
        width,
        height,
    };
    if !manager.set_session(capture_id, session.clone())? {
        remove_file_if_present(&image_path);
        return Ok(());
    }
    app.emit_to(OVERLAY_LABEL, "capture-ready", session)
        .map_err(|error| format!("无法准备截图界面：{error}"))?;
    Ok(())
}

pub fn prepare_overlay(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(OVERLAY_LABEL).is_some() {
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
        WebviewUrl::App("index.html?capture=1".into()),
    )
    .title("选择截图区域")
    .decorations(false)
    .fullscreen(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|error| format!("无法创建截图窗口：{error}"))?;
    Ok(())
}

fn fail_capture(app: &AppHandle, capture_id: u64, message: String) {
    let manager = app.state::<ScreenshotManager>();
    let Ok((was_active, session, previous_foreground_window)) =
        manager.reset_after_error(capture_id)
    else {
        return;
    };
    if !was_active {
        return;
    }
    if let Some(session) = session {
        remove_file_if_present(Path::new(&session.image_path));
    }
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = window.hide();
    }
    restore_foreground_window(previous_foreground_window);
    unregister_cancel_shortcuts(app);
    let _ = app.emit_to("main", "screenshot-error", message);
}

#[tauri::command]
pub fn get_capture_session(
    manager: State<'_, ScreenshotManager>,
) -> Result<CaptureSession, String> {
    manager.session()
}

#[tauri::command]
pub fn show_capture_overlay(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or_else(|| "截图窗口尚未准备好".to_string())?;
    window
        .show()
        .map_err(|error| format!("无法显示截图窗口：{error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("无法聚焦截图窗口：{error}"))?;
    Ok(())
}

#[tauri::command]
pub fn complete_capture(
    selection: CaptureSelection,
    app: AppHandle,
    manager: State<'_, ScreenshotManager>,
) -> Result<String, String> {
    let session = manager.session()?;
    let source =
        image::open(&session.image_path).map_err(|error| format!("无法读取截图：{error}"))?;
    let (source_width, source_height) = source.dimensions();
    let (x, y, width, height) = selection_to_pixels(selection, source_width, source_height)?;
    let cropped = source.crop_imm(x, y, width, height);
    let result_path = manager.result_path();
    cropped
        .save(&result_path)
        .map_err(|error| format!("无法保存框选截图：{error}"))?;

    remove_file_if_present(Path::new(&session.image_path));
    let (_, previous_foreground_window) = manager.finish()?;

    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = window.hide();
    }
    unregister_cancel_shortcuts(&app);
    let open_note_after_capture = app
        .try_state::<crate::settings::SettingsManager>()
        .and_then(|settings| settings.open_note_after_capture().ok())
        .unwrap_or(true);
    if open_note_after_capture {
        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.show();
            let _ = main_window.unminimize();
            let _ = main_window.set_focus();
        }
    } else {
        restore_foreground_window(previous_foreground_window);
    }

    let path = result_path.to_string_lossy().into_owned();
    app.emit_to(
        "main",
        "screenshot-completed",
        ScreenshotCompleted { path: path.clone() },
    )
    .map_err(|error| format!("无法打开截图笔记：{error}"))?;
    Ok(path)
}

#[tauri::command]
pub fn cancel_capture(app: AppHandle, manager: State<'_, ScreenshotManager>) -> Result<(), String> {
    cancel_capture_inner(&app, &manager)
}

pub fn cancel_active_capture(app: &AppHandle) {
    let manager = app.state::<ScreenshotManager>();
    let _ = cancel_capture_inner(app, &manager);
}

fn cancel_capture_inner(app: &AppHandle, manager: &ScreenshotManager) -> Result<(), String> {
    let (session, previous_foreground_window) = manager.finish()?;
    if let Some(session) = session {
        remove_file_if_present(Path::new(&session.image_path));
    }
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = window.hide();
    }
    restore_foreground_window(previous_foreground_window);
    unregister_cancel_shortcuts(app);
    Ok(())
}

#[cfg(windows)]
fn current_foreground_window() -> Option<isize> {
    let window = unsafe { GetForegroundWindow() };
    (!window.is_null()).then_some(window as isize)
}

#[cfg(not(windows))]
fn current_foreground_window() -> Option<isize> {
    None
}

#[cfg(windows)]
fn restore_foreground_window(window: Option<isize>) {
    let Some(window) = window else {
        return;
    };
    let window = window as HWND;
    if unsafe { IsWindow(window) } != 0 {
        // Hiding the active overlay makes Windows prefer another window from this
        // process (usually the notebook). Explicitly return focus to the app that
        // was active when the global screenshot shortcut was pressed.
        unsafe {
            if IsIconic(window) != 0 {
                ShowWindowAsync(window, SW_RESTORE);
            }
            SetForegroundWindow(window);
        }
    }
}

#[cfg(not(windows))]
fn restore_foreground_window(_window: Option<isize>) {}

#[cfg(windows)]
fn capture_primary_to_bmp(path: &Path) -> Result<(u32, u32), String> {
    let width = unsafe { GetSystemMetrics(SM_CXSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYSCREEN) };
    if width <= 0 || height <= 0 {
        return Err("无法读取主显示器尺寸".to_string());
    }

    let screen_dc = unsafe { GetDC(std::ptr::null_mut()) };
    if screen_dc.is_null() {
        return Err("无法连接主显示器画面".to_string());
    }

    let memory_dc = unsafe { CreateCompatibleDC(screen_dc) };
    if memory_dc.is_null() {
        unsafe { ReleaseDC(std::ptr::null_mut(), screen_dc) };
        return Err("无法创建截图缓冲区".to_string());
    }

    let bitmap = unsafe { CreateCompatibleBitmap(screen_dc, width, height) };
    if bitmap.is_null() {
        unsafe {
            DeleteDC(memory_dc);
            ReleaseDC(std::ptr::null_mut(), screen_dc);
        }
        return Err("无法创建屏幕位图".to_string());
    }

    let old_object = unsafe { SelectObject(memory_dc, bitmap) };
    let result = (|| -> Result<(u32, u32), String> {
        if old_object.is_null() {
            return Err("无法选择屏幕位图".to_string());
        }

        let copied = unsafe {
            BitBlt(
                memory_dc,
                0,
                0,
                width,
                height,
                screen_dc,
                0,
                0,
                SRCCOPY | CAPTUREBLT,
            )
        };
        unsafe { SelectObject(memory_dc, old_object) };

        if copied == 0 {
            return Err("无法复制主显示器画面".to_string());
        }

        let width_u32 = width as u32;
        let height_u32 = height as u32;
        let image_size = width_u32
            .checked_mul(height_u32)
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or_else(|| "显示器尺寸过大".to_string())?;
        let mut pixels = vec![0_u8; image_size as usize];
        let mut bitmap_info: BITMAPINFO = unsafe { std::mem::zeroed() };
        bitmap_info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: image_size,
            ..unsafe { std::mem::zeroed() }
        };

        let copied_lines = unsafe {
            GetDIBits(
                screen_dc,
                bitmap,
                0,
                height_u32,
                pixels.as_mut_ptr().cast(),
                &mut bitmap_info,
                DIB_RGB_COLORS,
            )
        };
        if copied_lines != height {
            return Err("无法读取屏幕位图像素".to_string());
        }

        for alpha in pixels.iter_mut().skip(3).step_by(4) {
            *alpha = 255;
        }
        write_bmp(path, width_u32, height_u32, &pixels)?;
        Ok((width_u32, height_u32))
    })();

    unsafe {
        DeleteObject(bitmap);
        DeleteDC(memory_dc);
        ReleaseDC(std::ptr::null_mut(), screen_dc);
    }
    result
}

#[cfg(not(windows))]
fn capture_primary_to_bmp(_path: &Path) -> Result<(u32, u32), String> {
    Err("当前平台暂不支持快速截图".to_string())
}

fn write_bmp(path: &Path, width: u32, height: u32, pixels: &[u8]) -> Result<(), String> {
    let pixel_offset = 54_u32;
    let file_size = pixel_offset
        .checked_add(pixels.len() as u32)
        .ok_or_else(|| "截图文件过大".to_string())?;
    let file = fs::File::create(path).map_err(|error| format!("无法创建临时截图：{error}"))?;
    let mut writer = BufWriter::new(file);

    writer.write_all(b"BM").map_err(bmp_write_error)?;
    writer
        .write_all(&file_size.to_le_bytes())
        .map_err(bmp_write_error)?;
    writer.write_all(&[0_u8; 4]).map_err(bmp_write_error)?;
    writer
        .write_all(&pixel_offset.to_le_bytes())
        .map_err(bmp_write_error)?;
    writer
        .write_all(&40_u32.to_le_bytes())
        .map_err(bmp_write_error)?;
    writer
        .write_all(&(width as i32).to_le_bytes())
        .map_err(bmp_write_error)?;
    writer
        .write_all(&(height as i32).to_le_bytes())
        .map_err(bmp_write_error)?;
    writer
        .write_all(&1_u16.to_le_bytes())
        .map_err(bmp_write_error)?;
    writer
        .write_all(&32_u16.to_le_bytes())
        .map_err(bmp_write_error)?;
    writer
        .write_all(&0_u32.to_le_bytes())
        .map_err(bmp_write_error)?;
    writer
        .write_all(&(pixels.len() as u32).to_le_bytes())
        .map_err(bmp_write_error)?;
    writer.write_all(&[0_u8; 16]).map_err(bmp_write_error)?;
    writer.write_all(pixels).map_err(bmp_write_error)?;
    writer.flush().map_err(bmp_write_error)
}

fn bmp_write_error(error: std::io::Error) -> String {
    format!("无法写入临时截图：{error}")
}

#[tauri::command]
pub fn discard_temp_images(
    paths: Vec<String>,
    manager: State<'_, ScreenshotManager>,
) -> Result<(), String> {
    for raw_path in paths {
        let path = PathBuf::from(raw_path);
        if !manager.is_managed_temp_path(&path) {
            return Err("拒绝删除截图临时目录之外的文件".to_string());
        }
        remove_file_if_present(&path);
    }
    Ok(())
}

fn selection_to_pixels(
    selection: CaptureSelection,
    image_width: u32,
    image_height: u32,
) -> Result<(u32, u32, u32, u32), String> {
    let values = [selection.x, selection.y, selection.width, selection.height];
    if values.iter().any(|value| !value.is_finite()) {
        return Err("截图区域无效".to_string());
    }

    let left = selection.x.clamp(0.0, 1.0);
    let top = selection.y.clamp(0.0, 1.0);
    let right = (selection.x + selection.width).clamp(0.0, 1.0);
    let bottom = (selection.y + selection.height).clamp(0.0, 1.0);
    if right <= left || bottom <= top {
        return Err("请拖动选择一个截图区域".to_string());
    }

    let x = (left * image_width as f64).floor() as u32;
    let y = (top * image_height as f64).floor() as u32;
    let right_px = ((right * image_width as f64).ceil() as u32).min(image_width);
    let bottom_px = ((bottom * image_height as f64).ceil() as u32).min(image_height);
    let width = right_px.saturating_sub(x);
    let height = bottom_px.saturating_sub(y);
    if width < 2 || height < 2 {
        return Err("截图区域太小".to_string());
    }
    Ok((x, y, width, height))
}

fn remove_file_if_present(path: &Path) {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => eprintln!("无法清理临时截图 {}：{error}", path.display()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_normalized_selection_to_pixels() {
        let pixels = selection_to_pixels(
            CaptureSelection {
                x: 0.25,
                y: 0.1,
                width: 0.5,
                height: 0.4,
            },
            1920,
            1080,
        )
        .unwrap();
        assert_eq!(pixels, (480, 108, 960, 432));
    }

    #[test]
    fn clamps_selection_to_image_bounds() {
        let pixels = selection_to_pixels(
            CaptureSelection {
                x: -0.2,
                y: 0.8,
                width: 1.4,
                height: 0.5,
            },
            100,
            100,
        )
        .unwrap();
        assert_eq!(pixels, (0, 80, 100, 20));
    }

    #[test]
    fn rejects_empty_selection() {
        assert!(selection_to_pixels(
            CaptureSelection {
                x: 0.5,
                y: 0.5,
                width: 0.0,
                height: 0.2,
            },
            100,
            100,
        )
        .is_err());
    }
}
