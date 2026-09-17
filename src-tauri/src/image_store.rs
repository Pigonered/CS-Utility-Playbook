use chrono::{Datelike, Local};
use std::{
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

const SUPPORTED_EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];
const MAX_ANNOTATION_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug)]
pub struct CopiedImage {
    pub stored_path: String,
    pub absolute_path: PathBuf,
}

#[derive(Debug)]
pub struct ImageStore {
    app_data_directory: PathBuf,
}

impl ImageStore {
    pub fn new(app_data_directory: PathBuf) -> Self {
        Self { app_data_directory }
    }

    pub fn copy_source(&self, source: &Path) -> Result<CopiedImage, String> {
        if !source.is_file() {
            return Err(format!("图片文件不存在：{}", source.display()));
        }

        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .filter(|value| SUPPORTED_EXTENSIONS.contains(&value.as_str()))
            .ok_or_else(|| "只支持 PNG、JPG、JPEG 和 WEBP 图片".to_string())?;

        let now = Local::now();
        let year = now.year().to_string();
        let month = format!("{:02}", now.month());
        let file_name = format!("{}.{}", Uuid::new_v4(), extension);
        let stored_path = format!("images/{year}/{month}/{file_name}");
        let absolute_path = self.app_data_directory.join(&stored_path);

        if let Some(parent) = absolute_path.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("无法创建图片目录：{error}"))?;
        }

        if let Err(error) = fs::copy(source, &absolute_path) {
            let _ = fs::remove_file(&absolute_path);
            return Err(format!("无法复制图片 {}：{error}", source.display()));
        }

        Ok(CopiedImage {
            stored_path,
            absolute_path,
        })
    }

    pub fn save_annotation_png(&self, bytes: &[u8]) -> Result<CopiedImage, String> {
        if bytes.is_empty() || bytes.len() > MAX_ANNOTATION_BYTES {
            return Err("标注图片数据为空或超过 32 MB".to_string());
        }
        image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
            .map_err(|error| format!("标注图片不是有效的 PNG：{error}"))?;

        let now = Local::now();
        let year = now.year().to_string();
        let month = format!("{:02}", now.month());
        let file_name = format!("{}-annotated.png", Uuid::new_v4());
        let stored_path = format!("images/{year}/{month}/{file_name}");
        let absolute_path = self.app_data_directory.join(&stored_path);

        if let Some(parent) = absolute_path.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("无法创建图片目录：{error}"))?;
        }
        if let Err(error) = fs::write(&absolute_path, bytes) {
            let _ = fs::remove_file(&absolute_path);
            return Err(format!("无法保存标注图片：{error}"));
        }

        Ok(CopiedImage {
            stored_path,
            absolute_path,
        })
    }

    pub fn absolute_path(&self, stored_path: &str) -> Result<PathBuf, String> {
        let relative = Path::new(stored_path);
        if relative.is_absolute()
            || relative.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err("数据库中的图片路径不安全".to_string());
        }
        Ok(self.app_data_directory.join(relative))
    }

    pub fn remove(&self, stored_path: &str) -> Result<(), String> {
        let path = self.absolute_path(stored_path)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("无法删除图片 {}：{error}", path.display())),
        }
    }

    pub fn remove_best_effort(&self, stored_path: &str) {
        if let Err(error) = self.remove(stored_path) {
            eprintln!("{error}");
        }
    }
}
