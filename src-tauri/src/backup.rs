use crate::database::Database;
use chrono::{DateTime, Local};
use rusqlite::{backup::Progress, Connection, MAIN_DB};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::{Duration, SystemTime},
};
use tauri::State;
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

type BackupResultValue<T> = Result<T, String>;

const BACKUP_FORMAT_VERSION: u32 = 1;
const AUTOMATIC_BACKUP_LIMIT: usize = 7;
const AUTOMATIC_BACKUP_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_ARCHIVE_ENTRIES: usize = 50_000;
const MAX_UNCOMPRESSED_SIZE: u64 = 20 * 1024 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct BackupService {
    app_data_directory: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupMetadata {
    pub format_version: u32,
    pub app_version: String,
    pub created_at: String,
    pub backup_kind: String,
    pub note_count: i64,
    pub image_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupOperationResult {
    pub path: String,
    pub created_at: String,
    pub note_count: i64,
    pub image_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub automatic_backup_count: usize,
    pub latest_automatic_backup_at: Option<String>,
    pub automatic_backup_limit: usize,
}

struct WorkingDirectory {
    path: PathBuf,
}

impl WorkingDirectory {
    fn new(parent: &Path, prefix: &str) -> BackupResultValue<Self> {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建备份目录：{error}"))?;
        let path = parent.join(format!(".{prefix}-{}", Uuid::new_v4()));
        fs::create_dir(&path).map_err(|error| format!("无法创建临时备份目录：{error}"))?;
        Ok(Self { path })
    }
}

impl Drop for WorkingDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

impl BackupService {
    pub fn new(app_data_directory: PathBuf) -> Self {
        Self { app_data_directory }
    }

    pub fn migrate_to_directory(&self, destination: &Path) -> BackupResultValue<()> {
        fs::create_dir_all(destination)
            .map_err(|error| format!("无法创建新的数据目录：{error}"))?;
        let source = fs::canonicalize(&self.app_data_directory)
            .map_err(|error| format!("无法读取当前数据目录：{error}"))?;
        let destination = fs::canonicalize(destination)
            .map_err(|error| format!("无法读取新的数据目录：{error}"))?;

        if source == destination {
            return Ok(());
        }
        if destination.starts_with(&source) || source.starts_with(&destination) {
            return Err("新的数据目录不能与当前数据目录互相嵌套".to_string());
        }
        if destination.join("notebook.db").exists() || destination.join("images").exists() {
            return Err(
                "所选目录已包含笔记本数据，请选择不含 notebook.db 和 images 的目录".to_string(),
            );
        }

        let staging = destination.join(format!(".cs-notes-migration-{}", Uuid::new_v4()));
        fs::create_dir(&staging).map_err(|error| format!("无法创建迁移临时目录：{error}"))?;
        let result = (|| -> BackupResultValue<()> {
            let staged_database = staging.join("notebook.db");
            create_database_snapshot(&self.database_path(), &staged_database)?;
            let staged_images = staging.join("images");
            copy_directory(&self.images_directory(), &staged_images)?;
            validate_database_and_images(&staged_database, &staging)?;

            let installed_images = destination.join("images");
            fs::rename(&staged_images, &installed_images)
                .map_err(|error| format!("无法安装迁移后的图片目录：{error}"))?;
            if let Err(error) = fs::rename(&staged_database, destination.join("notebook.db")) {
                let _ = fs::remove_dir_all(&installed_images);
                return Err(format!("无法安装迁移后的数据库：{error}"));
            }
            Ok(())
        })();
        let _ = fs::remove_dir_all(&staging);
        result
    }

    fn database_path(&self) -> PathBuf {
        self.app_data_directory.join("notebook.db")
    }

    fn images_directory(&self) -> PathBuf {
        self.app_data_directory.join("images")
    }

    fn automatic_directory(&self) -> PathBuf {
        self.app_data_directory.join("backups").join("automatic")
    }

    fn working_parent(&self) -> PathBuf {
        self.app_data_directory.join("backups").join("working")
    }

    pub fn export_backup(&self, destination: &Path) -> BackupResultValue<BackupOperationResult> {
        if destination.as_os_str().is_empty() {
            return Err("请选择备份文件的保存位置".to_string());
        }
        if destination.starts_with(self.images_directory()) {
            return Err("备份文件不能保存到应用图片目录中".to_string());
        }
        if destination.exists() && !destination.is_file() {
            return Err("备份保存位置不是可覆盖的文件".to_string());
        }
        self.create_archive(destination, "manual")
    }

    pub fn create_automatic_if_due(&self) -> BackupResultValue<Option<BackupOperationResult>> {
        if !self.database_path().is_file() {
            return Ok(None);
        }
        let files = self.automatic_files()?;
        if let Some((_, modified)) = files.first() {
            if SystemTime::now()
                .duration_since(*modified)
                .unwrap_or_default()
                < AUTOMATIC_BACKUP_INTERVAL
            {
                return Ok(None);
            }
        }

        let destination = self.automatic_directory().join(format!(
            "CSNotebook-Auto-{}.zip",
            Local::now().format("%Y%m%d-%H%M%S")
        ));
        let result = self.create_archive(&destination, "automatic")?;
        self.prune_automatic_backups()?;
        Ok(Some(result))
    }

    pub fn status(&self) -> BackupResultValue<BackupStatus> {
        let files = self.automatic_files()?;
        Ok(BackupStatus {
            automatic_backup_count: files.len(),
            latest_automatic_backup_at: files
                .first()
                .map(|(_, modified)| DateTime::<Local>::from(*modified).to_rfc3339()),
            automatic_backup_limit: AUTOMATIC_BACKUP_LIMIT,
        })
    }

    pub fn restore_backup(&self, source: &Path) -> BackupResultValue<BackupOperationResult> {
        if !source.is_file() {
            return Err(format!("备份文件不存在：{}", source.display()));
        }

        let working = WorkingDirectory::new(&self.working_parent(), "restore")?;
        let extracted = working.path.join("extracted");
        fs::create_dir(&extracted).map_err(|error| format!("无法创建恢复目录：{error}"))?;
        let metadata = extract_and_validate_archive(source, &extracted)?;
        let restored_database = extracted.join("notebook.db");
        validate_database_and_images(&restored_database, &extracted)?;

        let automatic_directory = self.automatic_directory();
        fs::create_dir_all(&automatic_directory)
            .map_err(|error| format!("无法创建自动备份目录：{error}"))?;
        let safety_path = automatic_directory.join(format!(
            "CSNotebook-BeforeRestore-{}.zip",
            Local::now().format("%Y%m%d-%H%M%S")
        ));
        self.create_archive(&safety_path, "before_restore")?;
        self.prune_automatic_backups()?;

        let current_snapshot = working.path.join("current-notebook.db");
        create_database_snapshot(&self.database_path(), &current_snapshot)?;

        let current_images = self.images_directory();
        let previous_images = working.path.join("previous-images");
        let restored_images = extracted.join("images");
        if restored_images.exists() && !restored_images.is_dir() {
            return Err("备份包中的 images 不是有效图片目录".to_string());
        }
        if !restored_images.exists() {
            fs::create_dir(&restored_images)
                .map_err(|error| format!("无法创建空图片目录：{error}"))?;
        }

        let had_previous_images = current_images.exists();
        if had_previous_images {
            fs::rename(&current_images, &previous_images)
                .map_err(|error| format!("无法暂存当前图片目录：{error}"))?;
        }
        if let Err(error) = fs::rename(&restored_images, &current_images) {
            if had_previous_images {
                let _ = fs::rename(&previous_images, &current_images);
            }
            return Err(format!("无法安装备份图片：{error}"));
        }

        let restore_result = restore_database_snapshot(&restored_database, &self.database_path())
            .and_then(|_| Database::new(self.database_path()).initialize());
        if let Err(error) = restore_result {
            let database_rollback =
                restore_database_snapshot(&current_snapshot, &self.database_path());
            let _ = fs::remove_dir_all(&current_images);
            let images_rollback = if had_previous_images {
                fs::rename(&previous_images, &current_images)
                    .map_err(|rollback_error| rollback_error.to_string())
            } else {
                Ok(())
            };
            if database_rollback.is_err() || images_rollback.is_err() {
                return Err(format!(
                    "{error}；恢复回滚未完全成功，请使用恢复前自动备份：{}",
                    safety_path.display()
                ));
            }
            return Err(error);
        }

        Ok(BackupOperationResult {
            path: source.to_string_lossy().into_owned(),
            created_at: metadata.created_at,
            note_count: metadata.note_count,
            image_count: metadata.image_count,
        })
    }

    fn create_archive(
        &self,
        destination: &Path,
        backup_kind: &str,
    ) -> BackupResultValue<BackupOperationResult> {
        let parent = destination
            .parent()
            .ok_or_else(|| "备份文件路径无效".to_string())?;
        fs::create_dir_all(parent).map_err(|error| format!("无法创建备份保存目录：{error}"))?;

        let working = WorkingDirectory::new(&self.working_parent(), "export")?;
        let database_snapshot = working.path.join("notebook.db");
        create_database_snapshot(&self.database_path(), &database_snapshot)?;
        let metadata = read_metadata(&database_snapshot, backup_kind)?;
        let metadata_json = serde_json::to_vec_pretty(&metadata)
            .map_err(|error| format!("无法生成备份元数据：{error}"))?;

        let partial_path = parent.join(format!(
            ".{}.{}.partial",
            destination
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("CSNotebookBackup.zip"),
            Uuid::new_v4()
        ));
        let archive_result = write_archive(
            &partial_path,
            &database_snapshot,
            &self.images_directory(),
            &metadata_json,
        );
        if let Err(error) = archive_result {
            let _ = fs::remove_file(&partial_path);
            return Err(error);
        }

        let previous_destination = destination
            .exists()
            .then(|| parent.join(format!(".previous-backup-{}", Uuid::new_v4())));
        if let Some(previous) = &previous_destination {
            fs::rename(destination, previous)
                .map_err(|error| format!("无法暂存已有备份文件：{error}"))?;
        }
        if let Err(error) = fs::rename(&partial_path, destination) {
            if let Some(previous) = &previous_destination {
                let _ = fs::rename(previous, destination);
            }
            return Err(format!("无法完成备份文件写入：{error}"));
        }
        if let Some(previous) = previous_destination {
            let _ = fs::remove_file(previous);
        }

        Ok(BackupOperationResult {
            path: destination.to_string_lossy().into_owned(),
            created_at: metadata.created_at,
            note_count: metadata.note_count,
            image_count: metadata.image_count,
        })
    }

    fn automatic_files(&self) -> BackupResultValue<Vec<(PathBuf, SystemTime)>> {
        let directory = self.automatic_directory();
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let mut files = fs::read_dir(directory)
            .map_err(|error| format!("无法读取自动备份目录：{error}"))?
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let path = entry.path();
                if path.extension().and_then(|value| value.to_str()) != Some("zip") {
                    return None;
                }
                let modified = entry.metadata().ok()?.modified().ok()?;
                Some((path, modified))
            })
            .collect::<Vec<_>>();
        files.sort_by(|left, right| right.1.cmp(&left.1));
        Ok(files)
    }

    fn prune_automatic_backups(&self) -> BackupResultValue<()> {
        for (path, _) in self
            .automatic_files()?
            .into_iter()
            .skip(AUTOMATIC_BACKUP_LIMIT)
        {
            fs::remove_file(&path)
                .map_err(|error| format!("无法清理旧自动备份 {}：{error}", path.display()))?;
        }
        Ok(())
    }
}

fn copy_directory(source: &Path, destination: &Path) -> BackupResultValue<()> {
    fs::create_dir_all(destination).map_err(|error| format!("无法创建图片迁移目录：{error}"))?;
    if !source.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(source).map_err(|error| format!("无法读取图片目录：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法读取图片目录项：{error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("无法读取图片目录项类型：{error}"))?;
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_directory(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), target).map_err(|error| format!("无法迁移图片：{error}"))?;
        } else {
            return Err("图片目录中包含不支持的链接或特殊文件".to_string());
        }
    }
    Ok(())
}

fn create_database_snapshot(source: &Path, destination: &Path) -> BackupResultValue<()> {
    if !source.is_file() {
        return Err("本地数据库不存在".to_string());
    }
    if destination.exists() {
        fs::remove_file(destination).map_err(|error| format!("无法替换临时数据库：{error}"))?;
    }
    let connection = Connection::open(source).map_err(database_backup_error)?;
    connection
        .backup(MAIN_DB, destination, None)
        .map_err(database_backup_error)
}

fn restore_database_snapshot(source: &Path, destination: &Path) -> BackupResultValue<()> {
    let mut connection = Connection::open(destination).map_err(database_backup_error)?;
    connection
        .restore(MAIN_DB, source, None::<fn(Progress)>)
        .map_err(database_backup_error)
}

fn read_metadata(database: &Path, backup_kind: &str) -> BackupResultValue<BackupMetadata> {
    let connection = Connection::open(database).map_err(database_backup_error)?;
    let note_count = connection
        .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
        .map_err(database_backup_error)?;
    let image_count = connection
        .query_row("SELECT COUNT(*) FROM note_images", [], |row| row.get(0))
        .map_err(database_backup_error)?;
    Ok(BackupMetadata {
        format_version: BACKUP_FORMAT_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        created_at: Local::now().to_rfc3339(),
        backup_kind: backup_kind.to_string(),
        note_count,
        image_count,
    })
}

fn write_archive(
    destination: &Path,
    database: &Path,
    images_directory: &Path,
    metadata: &[u8],
) -> BackupResultValue<()> {
    let file = File::create(destination).map_err(|error| format!("无法创建备份文件：{error}"))?;
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    archive
        .start_file("notebook.db", options)
        .map_err(zip_error)?;
    let mut database_file =
        File::open(database).map_err(|error| format!("无法读取数据库快照：{error}"))?;
    std::io::copy(&mut database_file, &mut archive)
        .map_err(|error| format!("无法写入数据库快照：{error}"))?;

    archive
        .start_file("metadata.json", options)
        .map_err(zip_error)?;
    archive
        .write_all(metadata)
        .map_err(|error| format!("无法写入备份元数据：{error}"))?;

    if images_directory.is_dir() {
        add_images_to_archive(&mut archive, images_directory, options)?;
    } else {
        archive
            .add_directory("images/", options)
            .map_err(zip_error)?;
    }
    let output = archive.finish().map_err(zip_error)?;
    output
        .sync_all()
        .map_err(|error| format!("无法同步备份文件：{error}"))?;
    Ok(())
}

fn add_images_to_archive(
    archive: &mut ZipWriter<File>,
    root: &Path,
    options: SimpleFileOptions,
) -> BackupResultValue<()> {
    archive
        .add_directory("images/", options)
        .map_err(zip_error)?;
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let mut entries = fs::read_dir(&directory)
            .map_err(|error| format!("无法读取图片目录 {}：{error}", directory.display()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法遍历图片目录：{error}"))?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            if entry
                .file_type()
                .map_err(|error| format!("无法读取图片文件类型：{error}"))?
                .is_symlink()
            {
                return Err(format!("图片目录不允许包含符号链接：{}", path.display()));
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|error| format!("无法生成图片备份路径：{error}"))?;
            let archive_name = format!("images/{}", relative.to_string_lossy().replace('\\', "/"));
            if path.is_dir() {
                archive
                    .add_directory(format!("{archive_name}/"), options)
                    .map_err(zip_error)?;
                pending.push(path);
            } else if path.is_file() {
                archive
                    .start_file(archive_name, options)
                    .map_err(zip_error)?;
                let mut input = File::open(&path)
                    .map_err(|error| format!("无法读取图片 {}：{error}", path.display()))?;
                std::io::copy(&mut input, archive)
                    .map_err(|error| format!("无法写入图片备份：{error}"))?;
            }
        }
    }
    Ok(())
}

fn extract_and_validate_archive(
    source: &Path,
    destination: &Path,
) -> BackupResultValue<BackupMetadata> {
    let file = File::open(source).map_err(|error| format!("无法打开备份文件：{error}"))?;
    let mut archive = ZipArchive::new(file).map_err(zip_error)?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("备份包文件数量过多".to_string());
    }

    let mut total_size = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(zip_error)?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("备份包不允许包含符号链接".to_string());
        }
        total_size = total_size
            .checked_add(entry.size())
            .ok_or_else(|| "备份包大小无效".to_string())?;
        if total_size > MAX_UNCOMPRESSED_SIZE {
            return Err("备份包解压后超过 20 GB".to_string());
        }

        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "备份包包含不安全路径".to_string())?;
        if !allowed_archive_path(&relative) {
            return Err(format!("备份包包含未知文件：{}", relative.display()));
        }
        let output = destination.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&output).map_err(|error| format!("无法创建恢复目录：{error}"))?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("无法创建恢复子目录：{error}"))?;
        }
        let mut output_file =
            File::create(&output).map_err(|error| format!("无法创建恢复文件：{error}"))?;
        std::io::copy(&mut entry, &mut output_file)
            .map_err(|error| format!("无法解压备份文件：{error}"))?;
    }

    if !destination.join("notebook.db").is_file() || !destination.join("metadata.json").is_file() {
        return Err("备份包缺少 notebook.db 或 metadata.json".to_string());
    }
    let mut metadata_json = String::new();
    File::open(destination.join("metadata.json"))
        .and_then(|mut file| file.read_to_string(&mut metadata_json))
        .map_err(|error| format!("无法读取备份元数据：{error}"))?;
    let metadata: BackupMetadata =
        serde_json::from_str(&metadata_json).map_err(|error| format!("备份元数据无效：{error}"))?;
    if metadata.format_version != BACKUP_FORMAT_VERSION {
        return Err(format!("不支持的备份格式版本：{}", metadata.format_version));
    }
    Ok(metadata)
}

fn allowed_archive_path(path: &Path) -> bool {
    if path == Path::new("notebook.db") || path == Path::new("metadata.json") {
        return true;
    }
    matches!(path.components().next(), Some(Component::Normal(value)) if value == "images")
}

fn validate_database_and_images(database: &Path, extracted_root: &Path) -> BackupResultValue<()> {
    let connection = Connection::open(database).map_err(database_backup_error)?;
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(database_backup_error)?;
    if integrity != "ok" {
        return Err(format!("备份数据库完整性检查失败：{integrity}"));
    }
    let table_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
             WHERE type = 'table' AND name IN ('notes', 'note_images', 'tags', 'note_tags')",
            [],
            |row| row.get(0),
        )
        .map_err(database_backup_error)?;
    if table_count != 4 {
        return Err("备份数据库结构不完整".to_string());
    }

    let mut statement = connection
        .prepare("SELECT image_path, annotated_path FROM note_images")
        .map_err(database_backup_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(database_backup_error)?;
    for row in rows {
        let (original, annotated) = row.map_err(database_backup_error)?;
        for stored_path in [Some(original), annotated].into_iter().flatten() {
            let relative = Path::new(&stored_path);
            if !is_safe_image_path(relative) || !extracted_root.join(relative).is_file() {
                return Err(format!("备份包缺少图片文件：{stored_path}"));
            }
        }
    }
    Ok(())
}

fn is_safe_image_path(path: &Path) -> bool {
    !path.is_absolute()
        && matches!(path.components().next(), Some(Component::Normal(value)) if value == "images")
        && !path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
}

fn database_backup_error(error: rusqlite::Error) -> String {
    format!("数据库备份操作失败：{error}")
}

fn zip_error(error: zip::result::ZipError) -> String {
    format!("ZIP 备份操作失败：{error}")
}

#[tauri::command]
pub async fn export_backup(
    destination: String,
    service: State<'_, BackupService>,
) -> BackupResultValue<BackupOperationResult> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.export_backup(Path::new(&destination)))
        .await
        .map_err(|error| format!("备份任务异常结束：{error}"))?
}

#[tauri::command]
pub async fn restore_backup(
    source: String,
    service: State<'_, BackupService>,
) -> BackupResultValue<BackupOperationResult> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.restore_backup(Path::new(&source)))
        .await
        .map_err(|error| format!("恢复任务异常结束：{error}"))?
}

#[tauri::command]
pub fn get_backup_status(service: State<'_, BackupService>) -> BackupResultValue<BackupStatus> {
    service.status()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{NoteImageInput, NoteInput};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_directory() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "cs-lineup-backup-test-{}-{unique}",
            std::process::id()
        ))
    }

    fn sample_input() -> NoteInput {
        NoteInput {
            title: "备份测试".to_string(),
            map_name: "Mirage".to_string(),
            side: "T".to_string(),
            grenade_type: "Smoke".to_string(),
            start_position: "A1".to_string(),
            target_position: "CT".to_string(),
            throw_type: "Jump Throw".to_string(),
            description: "用于验证完整恢复".to_string(),
            tags: vec!["必学".to_string()],
        }
    }

    #[test]
    fn export_and_full_restore_include_database_and_images() {
        let directory = test_directory();
        fs::create_dir_all(&directory).expect("test directory should be created");
        let database = Database::new(directory.join("notebook.db"));
        database.initialize().expect("database should initialize");
        let source = directory.join("source.png");
        image::DynamicImage::new_rgba8(6, 6)
            .save(&source)
            .expect("source image should save");
        let note = database
            .save_note_with_images(
                None,
                sample_input(),
                vec![NoteImageInput {
                    existing_id: None,
                    source_path: Some(source.to_string_lossy().into_owned()),
                    image_type: "站位".to_string(),
                }],
            )
            .expect("note should save");
        let stored_image = note.images[0].image_path.clone();

        let service = BackupService::new(directory.clone());
        let archive_path = directory.join("manual-backup.zip");
        let exported = service
            .export_backup(&archive_path)
            .expect("backup should export");
        assert_eq!(exported.note_count, 1);
        assert_eq!(exported.image_count, 1);

        database.delete_note(note.id).expect("note should delete");
        assert!(!Path::new(&stored_image).exists());
        let restored = service
            .restore_backup(&archive_path)
            .expect("backup should restore");
        assert_eq!(restored.note_count, 1);
        let restored_notes = database.get_notes().expect("restored notes should load");
        assert_eq!(restored_notes.len(), 1);
        assert!(Path::new(&restored_notes[0].images[0].image_path).is_file());

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn restore_rejects_archive_path_traversal() {
        let directory = test_directory();
        fs::create_dir_all(&directory).expect("test directory should be created");
        let database = Database::new(directory.join("notebook.db"));
        database.initialize().expect("database should initialize");
        let archive_path = directory.join("unsafe.zip");
        let file = File::create(&archive_path).expect("unsafe archive should be created");
        let mut archive = ZipWriter::new(file);
        archive
            .start_file("../outside.txt", SimpleFileOptions::default())
            .expect("unsafe entry should be added");
        archive
            .write_all(b"must not escape")
            .expect("unsafe entry data should be written");
        archive.finish().expect("unsafe archive should finish");

        let service = BackupService::new(directory.clone());
        let error = service
            .restore_backup(&archive_path)
            .expect_err("unsafe archive should be rejected");
        assert!(error.contains("不安全路径"));

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn data_directory_migration_copies_notes_and_images() {
        let root = test_directory();
        let source_directory = root.join("source-data");
        let destination_directory = root.join("destination-data");
        fs::create_dir_all(&source_directory).expect("source directory should be created");
        let database = Database::new(source_directory.join("notebook.db"));
        database.initialize().expect("database should initialize");
        let source_image = root.join("migration-source.png");
        image::DynamicImage::new_rgba8(4, 4)
            .save(&source_image)
            .expect("source image should save");
        database
            .save_note_with_images(
                None,
                sample_input(),
                vec![NoteImageInput {
                    existing_id: None,
                    source_path: Some(source_image.to_string_lossy().into_owned()),
                    image_type: "站位".to_string(),
                }],
            )
            .expect("note should save");

        BackupService::new(source_directory.clone())
            .migrate_to_directory(&destination_directory)
            .expect("data should migrate");

        let migrated_database = Database::new(destination_directory.join("notebook.db"));
        migrated_database
            .initialize()
            .expect("migrated database should initialize");
        let notes = migrated_database
            .get_notes()
            .expect("migrated notes should load");
        assert_eq!(notes.len(), 1);
        assert!(Path::new(&notes[0].images[0].image_path).is_file());
        assert!(source_directory.join("notebook.db").is_file());

        fs::remove_dir_all(root).expect("test directory should be removed");
    }
}
