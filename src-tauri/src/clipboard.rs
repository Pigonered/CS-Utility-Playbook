use image::RgbaImage;
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;

const MAX_IMAGE_BYTES: usize = 128 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardImage {
    path: String,
    width: u32,
    height: u32,
}

fn save_rgba(path: &Path, width: u32, height: u32, pixels: &[u8]) -> Result<(), String> {
    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|size| size.checked_mul(4));
    if width == 0 || height == 0 || expected != Some(pixels.len()) {
        return Err("剪贴板图片数据无效".to_string());
    }
    if pixels.len() > MAX_IMAGE_BYTES {
        return Err("剪贴板图片过大，请裁剪后再添加（像素数据最多 128 MB）".to_string());
    }
    let image = RgbaImage::from_raw(width, height, pixels.to_vec())
        .ok_or_else(|| "剪贴板图片数据无效".to_string())?;
    if let Err(error) = image.save(path) {
        let _ = std::fs::remove_file(path);
        return Err(format!("无法保存剪贴板图片：{error}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn import_clipboard_image(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<ClipboardImage, String> {
    if window.label() != "main" {
        return Err("请在笔记编辑界面添加剪贴板图片".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let image = app.clipboard().read_image().map_err(|error| {
            let message = error.to_string();
            if message.contains("not available") || message.contains("ContentNotAvailable") {
                "剪贴板中没有图片，请先在微信、QQ 等截图工具中复制图片".to_string()
            } else {
                format!("无法读取剪贴板图片，请复制图片后重试：{message}")
            }
        })?;
        let path = app
            .state::<crate::screenshot::ScreenshotManager>()
            .clipboard_path();
        save_rgba(&path, image.width(), image.height(), image.rgba())?;
        Ok(ClipboardImage {
            path: path.to_string_lossy().into_owned(),
            width: image.width(),
            height: image.height(),
        })
    })
    .await
    .map_err(|error| format!("剪贴板读取任务失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipboard_png_preserves_dimensions_colors_and_alpha() {
        let path =
            std::env::temp_dir().join(format!("clipboard-test-{}.png", uuid::Uuid::new_v4()));
        let pixels = [255, 0, 0, 255, 0, 128, 255, 80];
        save_rgba(&path, 2, 1, &pixels).unwrap();
        let reopened = image::open(&path).unwrap().to_rgba8();
        assert_eq!(reopened.dimensions(), (2, 1));
        assert_eq!(reopened.as_raw(), &pixels);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn invalid_clipboard_images_do_not_create_files() {
        let path =
            std::env::temp_dir().join(format!("clipboard-test-{}.png", uuid::Uuid::new_v4()));
        assert!(save_rgba(&path, 0, 1, &[]).is_err());
        assert!(save_rgba(&path, 2, 1, &[255; 4]).is_err());
        assert!(save_rgba(&path, u32::MAX, u32::MAX, &[]).is_err());
        assert!(!path.exists());
    }
}
