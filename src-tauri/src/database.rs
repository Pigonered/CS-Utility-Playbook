use crate::image_store::{CopiedImage, ImageStore};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::State;

type DbResult<T> = Result<T, String>;

const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS notes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL CHECK (trim(title) <> ''),
    map_name        TEXT NOT NULL CHECK (trim(map_name) <> ''),
    side            TEXT NOT NULL CHECK (trim(side) <> ''),
    grenade_type    TEXT NOT NULL CHECK (trim(grenade_type) <> ''),
    start_position  TEXT,
    target_position TEXT,
    throw_type      TEXT,
    description     TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS note_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id    INTEGER NOT NULL,
    image_path TEXT NOT NULL,
    image_type TEXT NOT NULL DEFAULT '其他',
    display_name TEXT NOT NULL DEFAULT '',
    annotated_path TEXT,
    annotation_data TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_images_note_id
    ON note_images(note_id, sort_order);

CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (trim(name) <> ''),
    favorite_order INTEGER
);

CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS note_tags (
    note_id INTEGER NOT NULL,
    tag_id  INTEGER NOT NULL,
    PRIMARY KEY (note_id, tag_id),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_tags_tag_id ON note_tags(tag_id);
"#;

#[derive(Debug)]
pub struct Database {
    path: PathBuf,
    image_store: ImageStore,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub map_name: String,
    pub side: String,
    pub grenade_type: String,
    pub start_position: String,
    pub target_position: String,
    pub throw_type: String,
    pub description: String,
    pub images: Vec<NoteImage>,
    pub tags: Vec<Tag>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteImage {
    pub id: i64,
    pub note_id: i64,
    pub image_path: String,
    pub image_type: String,
    pub display_name: String,
    pub annotated_path: Option<String>,
    pub annotation_data: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub favorite_order: Option<i64>,
    pub usage_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput {
    pub title: String,
    pub map_name: String,
    pub side: String,
    pub grenade_type: String,
    #[serde(default)]
    pub start_position: String,
    #[serde(default)]
    pub target_position: String,
    #[serde(default)]
    pub throw_type: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteImageInput {
    pub existing_id: Option<i64>,
    pub source_path: Option<String>,
    #[serde(default = "default_image_type")]
    pub image_type: String,
    #[serde(default)]
    pub display_name: String,
}

#[derive(Debug)]
enum PlannedImage {
    Existing {
        id: i64,
        image_type: String,
        display_name: String,
    },
    New {
        copied: CopiedImage,
        image_type: String,
        display_name: String,
    },
}

const IMAGE_TYPES: [&str; 4] = ["站位", "瞄点", "效果", "其他"];

impl Database {
    pub fn new(path: PathBuf) -> Self {
        let app_data_directory = path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        Self {
            path,
            image_store: ImageStore::new(app_data_directory),
        }
    }

    pub fn initialize(&self) -> DbResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
        }

        let connection = self.open()?;
        connection
            .execute_batch(SCHEMA)
            .map_err(|error| format!("无法初始化数据库：{error}"))?;
        ensure_image_type_column(&connection)?;
        ensure_annotation_columns(&connection)?;
        ensure_tag_library_columns(&connection)?;
        Ok(())
    }

    fn open(&self) -> DbResult<Connection> {
        let connection =
            Connection::open(&self.path).map_err(|error| format!("无法打开数据库：{error}"))?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| format!("无法配置数据库超时：{error}"))?;
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|error| format!("无法启用数据库外键：{error}"))?;
        Ok(connection)
    }

    pub fn get_notes(&self) -> DbResult<Vec<Note>> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT id, title, map_name, side, grenade_type,
                        COALESCE(start_position, ''), COALESCE(target_position, ''),
                        COALESCE(throw_type, ''), COALESCE(description, ''),
                        created_at, updated_at
                 FROM notes
                 ORDER BY updated_at DESC, id DESC",
            )
            .map_err(database_error)?;

        let rows = statement
            .query_map([], map_note_row)
            .map_err(database_error)?;
        let mut notes = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(database_error)?;
        drop(statement);

        for note in &mut notes {
            self.load_relations(&connection, note)?;
        }
        Ok(notes)
    }

    pub fn get_note(&self, id: i64) -> DbResult<Option<Note>> {
        let connection = self.open()?;
        let mut note = connection
            .query_row(
                "SELECT id, title, map_name, side, grenade_type,
                        COALESCE(start_position, ''), COALESCE(target_position, ''),
                        COALESCE(throw_type, ''), COALESCE(description, ''),
                        created_at, updated_at
                 FROM notes WHERE id = ?1",
                [id],
                map_note_row,
            )
            .optional()
            .map_err(database_error)?;

        if let Some(note) = &mut note {
            self.load_relations(&connection, note)?;
        }
        Ok(note)
    }

    pub fn create_note(&self, input: NoteInput) -> DbResult<Note> {
        validate_input(&input)?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(database_error)?;

        transaction
            .execute(
                "INSERT INTO notes (
                    title, map_name, side, grenade_type, start_position,
                    target_position, throw_type, description
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    input.title.trim(),
                    input.map_name.trim(),
                    input.side.trim(),
                    input.grenade_type.trim(),
                    optional_text(&input.start_position),
                    optional_text(&input.target_position),
                    optional_text(&input.throw_type),
                    optional_description(&input.description),
                ],
            )
            .map_err(database_error)?;

        let id = transaction.last_insert_rowid();
        replace_note_tags(&transaction, id, &input.tags)?;
        transaction.commit().map_err(database_error)?;

        self.get_note(id)?
            .ok_or_else(|| "创建笔记后无法重新读取数据".to_string())
    }

    pub fn update_note(&self, id: i64, input: NoteInput) -> DbResult<Note> {
        validate_input(&input)?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(database_error)?;

        let changed = transaction
            .execute(
                "UPDATE notes SET
                    title = ?1,
                    map_name = ?2,
                    side = ?3,
                    grenade_type = ?4,
                    start_position = ?5,
                    target_position = ?6,
                    throw_type = ?7,
                    description = ?8,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?9",
                params![
                    input.title.trim(),
                    input.map_name.trim(),
                    input.side.trim(),
                    input.grenade_type.trim(),
                    optional_text(&input.start_position),
                    optional_text(&input.target_position),
                    optional_text(&input.throw_type),
                    optional_description(&input.description),
                    id,
                ],
            )
            .map_err(database_error)?;

        if changed == 0 {
            return Err("要更新的笔记不存在".to_string());
        }

        replace_note_tags(&transaction, id, &input.tags)?;
        transaction.commit().map_err(database_error)?;

        self.get_note(id)?
            .ok_or_else(|| "更新笔记后无法重新读取数据".to_string())
    }

    pub fn save_note_with_images(
        &self,
        id: Option<i64>,
        input: NoteInput,
        image_items: Vec<NoteImageInput>,
    ) -> DbResult<Note> {
        validate_input(&input)?;

        let mut planned_images = Vec::with_capacity(image_items.len());
        for item in image_items {
            let values = (|| -> DbResult<(String, String)> {
                let image_type = normalize_image_type(&item.image_type)?;
                let display_name = item.display_name.trim().to_string();
                if display_name.chars().count() > 80 {
                    return Err("图片名称最多 80 个字符".to_string());
                }
                Ok((image_type, display_name))
            })();
            let (image_type, display_name) = match values {
                Ok(values) => values,
                Err(error) => {
                    cleanup_copied_images(&self.image_store, &planned_images);
                    return Err(error);
                }
            };
            match (item.existing_id, item.source_path) {
                (Some(existing_id), None) => {
                    planned_images.push(PlannedImage::Existing {
                        id: existing_id,
                        image_type,
                        display_name,
                    });
                }
                (None, Some(source_path)) if !source_path.trim().is_empty() => {
                    match self.image_store.copy_source(Path::new(&source_path)) {
                        Ok(copied) => planned_images.push(PlannedImage::New {
                            copied,
                            image_type,
                            display_name,
                        }),
                        Err(error) => {
                            cleanup_copied_images(&self.image_store, &planned_images);
                            return Err(error);
                        }
                    }
                }
                _ => {
                    cleanup_copied_images(&self.image_store, &planned_images);
                    return Err("图片数据格式无效".to_string());
                }
            }
        }

        let mut removed_image_paths = Vec::new();
        let save_result = (|| -> DbResult<i64> {
            let mut connection = self.open()?;
            let transaction = connection.transaction().map_err(database_error)?;

            let note_id = if let Some(note_id) = id {
                let changed = transaction
                    .execute(
                        "UPDATE notes SET
                            title = ?1, map_name = ?2, side = ?3, grenade_type = ?4,
                            start_position = ?5, target_position = ?6, throw_type = ?7,
                            description = ?8,
                            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                         WHERE id = ?9",
                        params![
                            input.title.trim(),
                            input.map_name.trim(),
                            input.side.trim(),
                            input.grenade_type.trim(),
                            optional_text(&input.start_position),
                            optional_text(&input.target_position),
                            optional_text(&input.throw_type),
                            optional_description(&input.description),
                            note_id,
                        ],
                    )
                    .map_err(database_error)?;
                if changed == 0 {
                    return Err("要更新的笔记不存在".to_string());
                }
                note_id
            } else {
                transaction
                    .execute(
                        "INSERT INTO notes (
                            title, map_name, side, grenade_type, start_position,
                            target_position, throw_type, description
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                        params![
                            input.title.trim(),
                            input.map_name.trim(),
                            input.side.trim(),
                            input.grenade_type.trim(),
                            optional_text(&input.start_position),
                            optional_text(&input.target_position),
                            optional_text(&input.throw_type),
                            optional_description(&input.description),
                        ],
                    )
                    .map_err(database_error)?;
                transaction.last_insert_rowid()
            };

            replace_note_tags(&transaction, note_id, &input.tags)?;

            let existing_images = {
                let mut statement = transaction
                    .prepare(
                        "SELECT id, image_path, annotated_path
                         FROM note_images WHERE note_id = ?1",
                    )
                    .map_err(database_error)?;
                let images = statement
                    .query_map([note_id], |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            (row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?),
                        ))
                    })
                    .map_err(database_error)?
                    .collect::<Result<HashMap<_, _>, _>>()
                    .map_err(database_error)?;
                images
            };

            let mut retained_ids = HashSet::new();
            for planned in &planned_images {
                if let PlannedImage::Existing { id, .. } = planned {
                    if !existing_images.contains_key(id) {
                        return Err("图片不属于当前笔记或已被删除".to_string());
                    }
                    if !retained_ids.insert(*id) {
                        return Err("同一张图片不能重复排序".to_string());
                    }
                }
            }

            for (image_id, (stored_path, annotated_path)) in &existing_images {
                if !retained_ids.contains(image_id) {
                    transaction
                        .execute("DELETE FROM note_images WHERE id = ?1", [image_id])
                        .map_err(database_error)?;
                    removed_image_paths.push(stored_path.clone());
                    if let Some(annotated_path) = annotated_path {
                        removed_image_paths.push(annotated_path.clone());
                    }
                }
            }

            for (sort_order, planned) in planned_images.iter().enumerate() {
                match planned {
                    PlannedImage::Existing {
                        id,
                        image_type,
                        display_name,
                    } => {
                        transaction
                            .execute(
                                "UPDATE note_images SET sort_order = ?1, image_type = ?2, display_name = ?3
                                 WHERE id = ?4 AND note_id = ?5",
                                params![sort_order as i64, image_type, display_name, id, note_id],
                            )
                            .map_err(database_error)?;
                    }
                    PlannedImage::New {
                        copied,
                        image_type,
                        display_name,
                    } => {
                        transaction
                            .execute(
                                "INSERT INTO note_images (note_id, image_path, image_type, sort_order, display_name)
                                 VALUES (?1, ?2, ?3, ?4, ?5)",
                                params![note_id, copied.stored_path, image_type, sort_order as i64, display_name],
                            )
                            .map_err(database_error)?;
                    }
                }
            }

            transaction.commit().map_err(database_error)?;
            Ok(note_id)
        })();

        let note_id = match save_result {
            Ok(note_id) => note_id,
            Err(error) => {
                cleanup_copied_images(&self.image_store, &planned_images);
                return Err(error);
            }
        };

        for stored_path in removed_image_paths {
            self.image_store.remove_best_effort(&stored_path);
        }

        self.get_note(note_id)?
            .ok_or_else(|| "保存笔记后无法重新读取数据".to_string())
    }

    pub fn delete_note(&self, id: i64) -> DbResult<()> {
        let mut connection = self.open()?;
        let image_paths = {
            let mut statement = connection
                .prepare(
                    "SELECT image_path, annotated_path
                     FROM note_images WHERE note_id = ?1",
                )
                .map_err(database_error)?;
            let paths = statement
                .query_map([id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
                })
                .map_err(database_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(database_error)?;
            paths
                .into_iter()
                .flat_map(|(original, annotated)| [Some(original), annotated])
                .flatten()
                .collect::<Vec<_>>()
        };
        let transaction = connection.transaction().map_err(database_error)?;
        let changed = transaction
            .execute("DELETE FROM notes WHERE id = ?1", [id])
            .map_err(database_error)?;
        if changed == 0 {
            return Err("要删除的笔记不存在".to_string());
        }
        transaction.commit().map_err(database_error)?;
        for stored_path in image_paths {
            self.image_store.remove_best_effort(&stored_path);
        }
        Ok(())
    }

    pub fn save_image_annotation(
        &self,
        image_id: i64,
        png_data: Option<&str>,
        annotation_data: Option<&str>,
    ) -> DbResult<Note> {
        let annotation_data = annotation_data
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if let Some(value) = annotation_data {
            if value.len() > 2 * 1024 * 1024 {
                return Err("标注数据超过 2 MB".to_string());
            }
            let parsed: serde_json::Value = serde_json::from_str(value)
                .map_err(|error| format!("标注数据格式无效：{error}"))?;
            if !parsed.is_array() {
                return Err("标注数据必须是动作数组".to_string());
            }
        }

        let mut connection = self.open()?;
        let (note_id, old_annotated_path) = connection
            .query_row(
                "SELECT note_id, annotated_path FROM note_images WHERE id = ?1",
                [image_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()
            .map_err(database_error)?
            .ok_or_else(|| "要标注的图片不存在".to_string())?;

        let saved_annotation = match annotation_data {
            Some(_) => {
                let png_data = png_data.ok_or_else(|| "缺少标注图片数据".to_string())?;
                let bytes = decode_png_data_url(png_data)?;
                Some(self.image_store.save_annotation_png(&bytes)?)
            }
            None => None,
        };

        let new_stored_path = saved_annotation
            .as_ref()
            .map(|image| image.stored_path.as_str());
        let save_result = (|| -> DbResult<()> {
            let transaction = connection.transaction().map_err(database_error)?;
            transaction
                .execute(
                    "UPDATE note_images
                     SET annotated_path = ?1, annotation_data = ?2
                     WHERE id = ?3",
                    params![new_stored_path, annotation_data, image_id],
                )
                .map_err(database_error)?;
            transaction
                .execute(
                    "UPDATE notes
                     SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     WHERE id = ?1",
                    [note_id],
                )
                .map_err(database_error)?;
            transaction.commit().map_err(database_error)?;
            Ok(())
        })();

        if let Err(error) = save_result {
            if let Some(saved) = &saved_annotation {
                self.image_store.remove_best_effort(&saved.stored_path);
            }
            return Err(error);
        }
        if let Some(old_path) = old_annotated_path {
            self.image_store.remove_best_effort(&old_path);
        }

        self.get_note(note_id)?
            .ok_or_else(|| "保存标注后无法重新读取笔记".to_string())
    }

    pub fn get_tags(&self) -> DbResult<Vec<Tag>> {
        let connection = self.open()?;
        load_tags(&connection)
    }

    // 旧版常用标签只迁移一次；备份中的标记随数据库一起恢复。
    pub fn initialize_tag_library(&self, common_tags: &[String]) -> DbResult<Vec<Tag>> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let migrated: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM app_metadata WHERE key = 'tag_library_migrated')",
                [],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if !migrated {
            let mut names = HashSet::new();
            let mut order = 0;
            for raw in common_tags {
                let Ok(name) = validate_tag_name(raw) else {
                    continue;
                };
                if !names.insert(name.to_lowercase()) {
                    continue;
                }
                if order >= 20 {
                    break;
                }
                transaction
                    .execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [&name])
                    .map_err(database_error)?;
                transaction
                    .execute(
                        "UPDATE tags SET favorite_order = ?1 WHERE name = ?2 COLLATE NOCASE",
                        params![order, name],
                    )
                    .map_err(database_error)?;
                order += 1;
            }
            transaction
                .execute(
                    "INSERT INTO app_metadata (key, value) VALUES ('tag_library_migrated', '1')",
                    [],
                )
                .map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)?;
        load_tags(&connection)
    }

    pub fn create_tag(&self, name: &str) -> DbResult<Tag> {
        let name = validate_tag_name(name)?;
        let connection = self.open()?;
        connection
            .execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [&name])
            .map_err(database_error)?;
        load_tags(&connection)?
            .into_iter()
            .find(|tag| tag.name.to_lowercase() == name.to_lowercase())
            .ok_or_else(|| "创建标签后无法读取标签".to_string())
    }

    pub fn set_tag_favorite(&self, name: &str, favorite: bool) -> DbResult<Vec<Tag>> {
        let name = validate_tag_name(name)?;
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(database_error)?;
        if favorite {
            let current: Option<Option<i64>> = transaction
                .query_row(
                    "SELECT favorite_order FROM tags WHERE name = ?1 COLLATE NOCASE",
                    [&name],
                    |row| row.get(0),
                )
                .optional()
                .map_err(database_error)?;
            if current.flatten().is_none() {
                let count: i64 = transaction
                    .query_row(
                        "SELECT COUNT(*) FROM tags WHERE favorite_order IS NOT NULL",
                        [],
                        |row| row.get(0),
                    )
                    .map_err(database_error)?;
                if count >= 20 {
                    return Err("常用标签最多设置 20 个".to_string());
                }
                transaction
                    .execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [&name])
                    .map_err(database_error)?;
                transaction.execute("UPDATE tags SET favorite_order = (SELECT COALESCE(MAX(favorite_order), -1) + 1 FROM tags) WHERE name = ?1 COLLATE NOCASE", [&name])
                    .map_err(database_error)?;
            }
        } else {
            transaction
                .execute(
                    "UPDATE tags SET favorite_order = NULL WHERE name = ?1 COLLATE NOCASE",
                    [&name],
                )
                .map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)?;
        load_tags(&connection)
    }

    pub fn delete_unused_tag(&self, id: i64) -> DbResult<Vec<Tag>> {
        let connection = self.open()?;
        let changed = connection.execute(
            "DELETE FROM tags WHERE id = ?1 AND NOT EXISTS(SELECT 1 FROM note_tags WHERE tag_id = ?1)", [id]
        ).map_err(database_error)?;
        if changed == 0 {
            return Err("标签已被笔记使用或不存在，请先从笔记移除该标签".to_string());
        }
        load_tags(&connection)
    }

    fn load_relations(&self, connection: &Connection, note: &mut Note) -> DbResult<()> {
        let mut image_statement = connection
            .prepare(
                "SELECT id, note_id, image_path, image_type, annotated_path,
                        annotation_data, sort_order, created_at, display_name
                 FROM note_images WHERE note_id = ?1
                 ORDER BY sort_order, id",
            )
            .map_err(database_error)?;
        let stored_images = image_statement
            .query_map([note.id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                ))
            })
            .map_err(database_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(database_error)?;
        note.images = stored_images
            .into_iter()
            .map(
                |(
                    id,
                    note_id,
                    stored_path,
                    image_type,
                    annotated_path,
                    annotation_data,
                    sort_order,
                    created_at,
                    display_name,
                )| {
                    Ok(NoteImage {
                        id,
                        note_id,
                        image_path: self
                            .image_store
                            .absolute_path(&stored_path)?
                            .to_string_lossy()
                            .into_owned(),
                        image_type,
                        display_name,
                        annotated_path: annotated_path
                            .map(|path| self.image_store.absolute_path(&path))
                            .transpose()?
                            .map(|path| path.to_string_lossy().into_owned()),
                        annotation_data,
                        sort_order,
                        created_at,
                    })
                },
            )
            .collect::<DbResult<Vec<_>>>()?;

        let mut tag_statement = connection
            .prepare(
                "SELECT tags.id, tags.name, tags.favorite_order,
                        (SELECT COUNT(*) FROM note_tags usage WHERE usage.tag_id = tags.id)
                 FROM tags
                 INNER JOIN note_tags ON note_tags.tag_id = tags.id
                 WHERE note_tags.note_id = ?1
                 ORDER BY tags.name COLLATE NOCASE",
            )
            .map_err(database_error)?;
        note.tags = tag_statement
            .query_map([note.id], map_tag_row)
            .map_err(database_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(database_error)?;
        Ok(())
    }
}

fn map_note_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        title: row.get(1)?,
        map_name: row.get(2)?,
        side: row.get(3)?,
        grenade_type: row.get(4)?,
        start_position: row.get(5)?,
        target_position: row.get(6)?,
        throw_type: row.get(7)?,
        description: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        images: Vec::new(),
        tags: Vec::new(),
    })
}

fn validate_input(input: &NoteInput) -> DbResult<()> {
    for (label, value) in [
        ("标题", input.title.as_str()),
        ("地图", input.map_name.as_str()),
        ("阵营", input.side.as_str()),
        ("道具类型", input.grenade_type.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(format!("{label}不能为空"));
        }
    }
    Ok(())
}

fn optional_text(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}

fn optional_description(value: &str) -> Option<String> {
    (!value.trim().is_empty()).then(|| value.replace("\r\n", "\n").replace('\r', "\n"))
}

fn default_image_type() -> String {
    "其他".to_string()
}

fn normalize_image_type(value: &str) -> DbResult<String> {
    let value = value.trim();
    if IMAGE_TYPES.contains(&value) {
        Ok(value.to_string())
    } else {
        Err("图片类型必须是站位、瞄点、效果或其他".to_string())
    }
}

fn ensure_image_type_column(connection: &Connection) -> DbResult<()> {
    let has_column = {
        let mut statement = connection
            .prepare("PRAGMA table_info(note_images)")
            .map_err(database_error)?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(database_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(database_error)?;
        columns.iter().any(|column| column == "image_type")
    };

    if !has_column {
        connection
            .execute(
                "ALTER TABLE note_images ADD COLUMN image_type TEXT NOT NULL DEFAULT '其他'",
                [],
            )
            .map_err(database_error)?;
    }
    Ok(())
}

fn ensure_annotation_columns(connection: &Connection) -> DbResult<()> {
    let columns = {
        let mut statement = connection
            .prepare("PRAGMA table_info(note_images)")
            .map_err(database_error)?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(database_error)?
            .collect::<Result<HashSet<_>, _>>()
            .map_err(database_error)?;
        columns
    };
    if !columns.contains("annotated_path") {
        connection
            .execute("ALTER TABLE note_images ADD COLUMN annotated_path TEXT", [])
            .map_err(database_error)?;
    }
    if !columns.contains("annotation_data") {
        connection
            .execute(
                "ALTER TABLE note_images ADD COLUMN annotation_data TEXT",
                [],
            )
            .map_err(database_error)?;
    }
    Ok(())
}

fn decode_png_data_url(value: &str) -> DbResult<Vec<u8>> {
    const PREFIX: &str = "data:image/png;base64,";
    let encoded = value
        .strip_prefix(PREFIX)
        .ok_or_else(|| "标注图片必须是 PNG 格式".to_string())?;
    if encoded.len() > 44 * 1024 * 1024 {
        return Err("标注图片数据过大".to_string());
    }
    BASE64_STANDARD
        .decode(encoded)
        .map_err(|error| format!("无法解析标注图片：{error}"))
}

fn cleanup_copied_images(image_store: &ImageStore, planned_images: &[PlannedImage]) {
    for planned in planned_images {
        if let PlannedImage::New { copied, .. } = planned {
            image_store.remove_best_effort(&copied.stored_path);
            debug_assert!(
                !copied.absolute_path.exists(),
                "copied image should be removed after a failed save"
            );
        }
    }
}

fn replace_note_tags(transaction: &Transaction<'_>, note_id: i64, tags: &[String]) -> DbResult<()> {
    transaction
        .execute("DELETE FROM note_tags WHERE note_id = ?1", [note_id])
        .map_err(database_error)?;

    let mut unique_names = HashSet::new();
    for name in tags {
        let name = name.trim();
        if name.is_empty() || !unique_names.insert(name.to_lowercase()) {
            continue;
        }
        transaction
            .execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [name])
            .map_err(database_error)?;
        let tag_id: i64 = transaction
            .query_row(
                "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
                [name],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?1, ?2)",
                params![note_id, tag_id],
            )
            .map_err(database_error)?;
    }
    Ok(())
}

fn map_tag_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: row.get(0)?,
        name: row.get(1)?,
        favorite_order: row.get(2)?,
        usage_count: row.get(3)?,
    })
}

fn load_tags(connection: &Connection) -> DbResult<Vec<Tag>> {
    let mut statement = connection.prepare(
        "SELECT tags.id, tags.name, tags.favorite_order, COUNT(note_tags.note_id)
         FROM tags LEFT JOIN note_tags ON note_tags.tag_id = tags.id
         GROUP BY tags.id ORDER BY favorite_order IS NULL, favorite_order, tags.name COLLATE NOCASE"
    ).map_err(database_error)?;
    let rows = statement
        .query_map([], map_tag_row)
        .map_err(database_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(database_error)
}

fn validate_tag_name(value: &str) -> DbResult<String> {
    let name = value.trim().trim_start_matches('#').trim();
    if name.is_empty() {
        return Err("标签名称不能为空".to_string());
    }
    if name.chars().count() > 24 {
        return Err("每个标签最多 24 个字符".to_string());
    }
    Ok(name.to_string())
}

fn ensure_tag_library_columns(connection: &Connection) -> DbResult<()> {
    for (table, column, declaration) in [
        ("note_images", "display_name", "TEXT NOT NULL DEFAULT ''"),
        ("tags", "favorite_order", "INTEGER"),
    ] {
        let mut statement = connection
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(database_error)?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(database_error)?
            .collect::<Result<HashSet<_>, _>>()
            .map_err(database_error)?;
        if !columns.contains(column) {
            connection
                .execute(
                    &format!("ALTER TABLE {table} ADD COLUMN {column} {declaration}"),
                    [],
                )
                .map_err(database_error)?;
        }
    }
    Ok(())
}

fn database_error(error: rusqlite::Error) -> String {
    format!("数据库操作失败：{error}")
}

#[tauri::command]
pub fn get_notes(database: State<'_, Database>) -> DbResult<Vec<Note>> {
    database.get_notes()
}

#[tauri::command]
pub fn get_note(id: i64, database: State<'_, Database>) -> DbResult<Option<Note>> {
    database.get_note(id)
}

#[tauri::command]
pub fn create_note(input: NoteInput, database: State<'_, Database>) -> DbResult<Note> {
    database.create_note(input)
}

#[tauri::command]
pub fn update_note(id: i64, input: NoteInput, database: State<'_, Database>) -> DbResult<Note> {
    database.update_note(id, input)
}

#[tauri::command]
pub fn save_note_with_images(
    id: Option<i64>,
    input: NoteInput,
    image_items: Vec<NoteImageInput>,
    database: State<'_, Database>,
) -> DbResult<Note> {
    database.save_note_with_images(id, input, image_items)
}

#[tauri::command]
pub fn delete_note(id: i64, database: State<'_, Database>) -> DbResult<()> {
    database.delete_note(id)
}

#[tauri::command]
pub fn save_image_annotation(
    image_id: i64,
    png_data: Option<String>,
    annotation_data: Option<String>,
    database: State<'_, Database>,
) -> DbResult<Note> {
    database.save_image_annotation(image_id, png_data.as_deref(), annotation_data.as_deref())
}

#[tauri::command]
pub fn get_tags(database: State<'_, Database>) -> DbResult<Vec<Tag>> {
    database.get_tags()
}

#[tauri::command]
pub fn create_tag(name: String, database: State<'_, Database>) -> DbResult<Tag> {
    database.create_tag(&name)
}

#[tauri::command]
pub fn initialize_tag_library(
    common_tags: Vec<String>,
    database: State<'_, Database>,
) -> DbResult<Vec<Tag>> {
    database.initialize_tag_library(&common_tags)
}

#[tauri::command]
pub fn set_tag_favorite(
    name: String,
    favorite: bool,
    database: State<'_, Database>,
) -> DbResult<Vec<Tag>> {
    database.set_tag_favorite(&name, favorite)
}

#[tauri::command]
pub fn delete_unused_tag(id: i64, database: State<'_, Database>) -> DbResult<Vec<Tag>> {
    database.delete_unused_tag(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_database() -> (Database, PathBuf) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "cs-lineup-notebook-test-{}-{unique}",
            std::process::id()
        ));
        let database = Database::new(directory.join("notebook.db"));
        database.initialize().expect("database should initialize");
        (database, directory)
    }

    fn sample_input(title: &str) -> NoteInput {
        NoteInput {
            title: title.to_string(),
            map_name: "Mirage".to_string(),
            side: "T".to_string(),
            grenade_type: "Smoke".to_string(),
            start_position: "A1".to_string(),
            target_position: "CT".to_string(),
            throw_type: "Jump Throw".to_string(),
            description: "测试描述".to_string(),
            tags: vec!["默认道具".to_string(), "进攻".to_string()],
        }
    }

    #[test]
    fn descriptions_preserve_layout_across_all_save_paths() {
        let (database, directory) = test_database();
        let descriptions = [
            "\n  第一行\n\n    第二行  \n",
            "\r\n  Windows 换行\r\n\r\n下一行\r\n",
            "\r  单独回车\r\r下一行\r",
            " \t\r\n  ",
        ];

        for description in descriptions {
            let expected = if description.trim().is_empty() {
                String::new()
            } else {
                description.replace("\r\n", "\n").replace('\r', "\n")
            };
            let mut input = sample_input("备注排版测试");
            input.description = description.to_string();
            let created = database
                .create_note(input.clone())
                .expect("note should create");
            assert_eq!(created.description, expected);

            let updated = database
                .update_note(created.id, input.clone())
                .expect("note should update");
            assert_eq!(updated.description, expected);

            let created_with_images = database
                .save_note_with_images(None, input.clone(), Vec::new())
                .expect("editor should create note");
            assert_eq!(created_with_images.description, expected);

            let updated_with_images = database
                .save_note_with_images(Some(created_with_images.id), input, Vec::new())
                .expect("editor should update note");
            assert_eq!(updated_with_images.description, expected);

            let reopened = Database::new(directory.join("notebook.db"))
                .get_note(created_with_images.id)
                .expect("note should reload")
                .expect("note should exist");
            assert_eq!(reopened.description, expected);
        }

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn initialization_is_repeatable() {
        let (database, directory) = test_database();
        database
            .initialize()
            .expect("second initialization should work");
        let connection = database.open().expect("database should open");
        let table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name IN ('notes', 'note_images', 'tags', 'note_tags')",
                [],
                |row| row.get(0),
            )
            .expect("schema query should work");
        assert_eq!(table_count, 4);
        drop(connection);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn legacy_image_table_is_migrated_with_default_type() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "cs-lineup-notebook-migration-test-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("test directory should be created");
        let path = directory.join("notebook.db");
        let connection = Connection::open(&path).expect("legacy database should open");
        connection
            .execute_batch(
                "CREATE TABLE note_images (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    note_id INTEGER NOT NULL,
                    image_path TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT ''
                );
                INSERT INTO note_images (note_id, image_path) VALUES (1, 'images/legacy.png');",
            )
            .expect("legacy image table should be created");
        drop(connection);

        let database = Database::new(path);
        database.initialize().expect("legacy schema should migrate");
        let connection = database.open().expect("migrated database should open");
        let (image_type, annotated_path, annotation_data): (
            String,
            Option<String>,
            Option<String>,
        ) = connection
            .query_row(
                "SELECT image_type, annotated_path, annotation_data
                 FROM note_images WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("migrated image type should load");
        assert_eq!(image_type, "其他");
        assert!(annotated_path.is_none());
        assert!(annotation_data.is_none());
        drop(connection);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn note_crud_and_cascades_work() {
        let (database, directory) = test_database();
        let created = database
            .create_note(sample_input("A1 台阶烟"))
            .expect("note should be created");
        assert_eq!(created.tags.len(), 2);
        assert_eq!(database.get_notes().expect("notes should load").len(), 1);

        let connection = database.open().expect("database should open");
        connection
            .execute(
                "INSERT INTO note_images (note_id, image_path, sort_order) VALUES (?1, ?2, 0)",
                params![created.id, "images/test.png"],
            )
            .expect("image row should be created");
        drop(connection);

        let mut update = sample_input("更新后的标题");
        update.description = "更新后的描述".to_string();
        update.tags = vec!["必学".to_string()];
        let updated = database
            .update_note(created.id, update)
            .expect("note should be updated");
        assert_eq!(updated.title, "更新后的标题");
        assert_eq!(updated.tags[0].name, "必学");
        assert_eq!(updated.images.len(), 1);

        database
            .delete_note(created.id)
            .expect("note should be deleted");
        assert!(database
            .get_note(created.id)
            .expect("query should work")
            .is_none());

        let connection = database.open().expect("database should open");
        let image_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM note_images", [], |row| row.get(0))
            .expect("image count should load");
        let relation_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM note_tags", [], |row| row.get(0))
            .expect("relation count should load");
        let tag_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0))
            .expect("tag count should load");
        assert_eq!(image_count, 0);
        assert_eq!(relation_count, 0);
        assert_eq!(tag_count, 3);
        drop(connection);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn tags_are_unique_without_case_sensitivity() {
        let (database, directory) = test_database();
        let first = database.create_tag("Smoke").expect("tag should be created");
        let second = database.create_tag("smoke").expect("tag should be reused");
        assert_eq!(first.id, second.id);
        assert_eq!(database.get_tags().expect("tags should load").len(), 1);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn tag_library_migration_is_ordered_idempotent_and_preserves_empty_preferences() {
        let (database, directory) = test_database();
        database.create_tag("历史标签").unwrap();
        let tags = database
            .initialize_tag_library(&[
                "实用性：5/5".into(),
                "#Smoke".into(),
                "smoke".into(),
                "进攻".into(),
            ])
            .unwrap();
        let favorites: Vec<_> = tags
            .iter()
            .filter(|tag| tag.favorite_order.is_some())
            .map(|tag| tag.name.as_str())
            .collect();
        assert_eq!(favorites, ["实用性：5/5", "Smoke", "进攻"]);
        assert_eq!(tags.len(), 4);
        database
            .initialize_tag_library(&["不应再次迁移".into()])
            .unwrap();
        assert_eq!(database.get_tags().unwrap().len(), 4);
        for name in favorites {
            database.set_tag_favorite(name, false).unwrap();
        }
        database.initialize().unwrap();
        let reopened = Database::new(directory.join("notebook.db"));
        assert!(reopened
            .initialize_tag_library(&["旧偏好".into()])
            .unwrap()
            .iter()
            .all(|tag| tag.favorite_order.is_none()));
        fs::remove_dir_all(directory).unwrap();

        let (database, directory) = test_database();
        assert!(database.initialize_tag_library(&[]).unwrap().is_empty());
        assert!(database
            .initialize_tag_library(&["默认道具".into()])
            .unwrap()
            .is_empty());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn library_tags_survive_note_changes_and_only_unused_tags_can_be_deleted() {
        let (database, directory) = test_database();
        database.initialize_tag_library(&[]).unwrap();
        let created = database.create_note(sample_input("标签复用")).unwrap();
        let attack = database
            .get_tags()
            .unwrap()
            .into_iter()
            .find(|tag| tag.name == "进攻")
            .unwrap();
        assert_eq!(attack.usage_count, 1);
        assert!(database.delete_unused_tag(attack.id).is_err());
        database.set_tag_favorite("进攻", true).unwrap();
        let mut input = sample_input("标签复用");
        input.tags.clear();
        database.update_note(created.id, input).unwrap();
        let attack = database
            .get_tags()
            .unwrap()
            .into_iter()
            .find(|tag| tag.id == attack.id)
            .unwrap();
        assert_eq!(attack.usage_count, 0);
        assert!(attack.favorite_order.is_some());
        database.delete_note(created.id).unwrap();
        database.initialize().unwrap();
        assert_eq!(database.get_tags().unwrap().len(), 2);
        database.delete_unused_tag(attack.id).unwrap();
        assert_eq!(database.get_tags().unwrap().len(), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn favorite_limit_is_atomic_and_reusing_an_existing_favorite_still_works() {
        let (database, directory) = test_database();
        database.initialize_tag_library(&[]).unwrap();
        for index in 0..20 {
            database
                .set_tag_favorite(&format!("常用{index}"), true)
                .unwrap();
        }
        assert!(database.set_tag_favorite("第21个", true).is_err());
        assert_eq!(database.get_tags().unwrap().len(), 20);
        assert_eq!(database.set_tag_favorite("常用0", true).unwrap().len(), 20);
        database.set_tag_favorite("常用0", false).unwrap();
        let tags = database.set_tag_favorite("新常用", true).unwrap();
        assert_eq!(
            tags.iter()
                .filter(|tag| tag.favorite_order.is_some())
                .count(),
            20
        );
        assert!(database.set_tag_favorite(&"长".repeat(25), true).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn old_tag_and_image_columns_migrate_without_deleting_library_entries() {
        let (database, directory) = test_database();
        database.create_tag("旧版未使用标签").unwrap();
        let connection = database.open().unwrap();
        connection.execute_batch("ALTER TABLE tags DROP COLUMN favorite_order; ALTER TABLE note_images DROP COLUMN display_name;").unwrap();
        drop(connection);
        database.initialize().unwrap();
        database.initialize().unwrap();
        let tags = database
            .initialize_tag_library(&["旧版未使用标签".into()])
            .unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].favorite_order, Some(0));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn invalid_image_name_rolls_back_note_and_cleans_previously_copied_images() {
        let (database, directory) = test_database();
        let source = directory.join("name-source.png");
        image::DynamicImage::new_rgba8(2, 2).save(&source).unwrap();
        let result = database.save_note_with_images(
            None,
            sample_input("不应写入"),
            vec![
                NoteImageInput {
                    existing_id: None,
                    source_path: Some(source.to_string_lossy().into_owned()),
                    image_type: "站位".into(),
                    display_name: "有效名称".into(),
                },
                NoteImageInput {
                    existing_id: None,
                    source_path: Some(source.to_string_lossy().into_owned()),
                    image_type: "效果".into(),
                    display_name: "长".repeat(81),
                },
            ],
        );
        assert!(result.unwrap_err().contains("80"));
        assert!(database.get_notes().unwrap().is_empty());
        assert!(database.get_tags().unwrap().is_empty());
        let month_directory =
            directory.join(format!("images/{}", chrono::Local::now().format("%Y/%m")));
        assert_eq!(fs::read_dir(month_directory).unwrap().count(), 0);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn initialization_retains_unused_library_tags() {
        let (database, directory) = test_database();
        database
            .create_tag("旧版残留标签")
            .expect("orphan tag should be created");
        assert_eq!(database.get_tags().expect("tags should load").len(), 1);

        database
            .initialize()
            .expect("reinitialization should retain library tags");

        assert_eq!(database.get_tags().expect("tags should load").len(), 1);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn image_files_are_copied_reordered_and_removed() {
        let (database, directory) = test_database();
        let first_source = directory.join("first.png");
        let second_source = directory.join("second.webp");
        fs::write(&first_source, b"png-test-data").expect("first source should be written");
        fs::write(&second_source, b"webp-test-data").expect("second source should be written");

        let created = database
            .save_note_with_images(
                None,
                sample_input("多图笔记"),
                vec![
                    NoteImageInput {
                        display_name: "投掷参照".to_string(),
                        existing_id: None,
                        source_path: Some(first_source.to_string_lossy().into_owned()),
                        image_type: "站位".to_string(),
                    },
                    NoteImageInput {
                        display_name: "投掷参照".to_string(),
                        existing_id: None,
                        source_path: Some(second_source.to_string_lossy().into_owned()),
                        image_type: "瞄点".to_string(),
                    },
                ],
            )
            .expect("note and images should be saved");
        assert_eq!(created.images.len(), 2);
        assert!(created
            .images
            .iter()
            .all(|image| image.display_name == "投掷参照"));
        assert_eq!(created.images[0].image_type, "站位");
        assert_eq!(created.images[1].image_type, "瞄点");
        assert!(Path::new(&created.images[0].image_path).is_file());
        assert!(Path::new(&created.images[1].image_path).is_file());

        let connection = database.open().expect("database should open");
        let stored_path: String = connection
            .query_row(
                "SELECT image_path FROM note_images WHERE id = ?1",
                [created.images[0].id],
                |row| row.get(0),
            )
            .expect("stored path should load");
        assert!(!Path::new(&stored_path).is_absolute());
        assert!(stored_path.starts_with("images/"));
        drop(connection);

        let reordered = database
            .save_note_with_images(
                Some(created.id),
                sample_input("多图笔记"),
                vec![
                    NoteImageInput {
                        display_name: "命中效果".to_string(),
                        existing_id: Some(created.images[1].id),
                        source_path: None,
                        image_type: "效果".to_string(),
                    },
                    NoteImageInput {
                        display_name: "投掷参照".to_string(),
                        existing_id: Some(created.images[0].id),
                        source_path: None,
                        image_type: "站位".to_string(),
                    },
                ],
            )
            .expect("images should be reordered");
        assert_eq!(reordered.images[0].id, created.images[1].id);
        assert_eq!(reordered.images[0].image_type, "效果");
        assert_eq!(reordered.images[0].display_name, "命中效果");
        assert_eq!(reordered.images[0].image_path, created.images[1].image_path);
        assert_eq!(reordered.images[1].display_name, "投掷参照");
        assert_eq!(
            database.get_note(created.id).unwrap().unwrap().images[0].display_name,
            "命中效果"
        );

        let removed_path = reordered.images[0].image_path.clone();
        let retained_path = reordered.images[1].image_path.clone();
        let retained_id = reordered.images[1].id;
        let reduced = database
            .save_note_with_images(
                Some(created.id),
                sample_input("多图笔记"),
                vec![NoteImageInput {
                    display_name: "投掷参照".to_string(),
                    existing_id: Some(retained_id),
                    source_path: None,
                    image_type: "站位".to_string(),
                }],
            )
            .expect("one image should be removed");
        assert_eq!(reduced.images.len(), 1);
        assert!(!Path::new(&removed_path).exists());
        assert!(Path::new(&retained_path).exists());

        database
            .delete_note(created.id)
            .expect("note should be deleted");
        assert!(!Path::new(&retained_path).exists());
        assert!(first_source.exists());
        assert!(second_source.exists());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn image_annotations_preserve_original_and_can_be_cleared() {
        let (database, directory) = test_database();
        let source = directory.join("annotation-source.png");
        image::DynamicImage::new_rgba8(8, 8)
            .save(&source)
            .expect("source png should be written");
        let created = database
            .save_note_with_images(
                None,
                sample_input("标注测试"),
                vec![NoteImageInput {
                    display_name: "窗沿瞄准参照".to_string(),
                    existing_id: None,
                    source_path: Some(source.to_string_lossy().into_owned()),
                    image_type: "瞄点".to_string(),
                }],
            )
            .expect("note image should be created");
        let original_path = created.images[0].image_path.clone();

        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(8, 8)
            .write_to(&mut png, image::ImageFormat::Png)
            .expect("annotation png should encode");
        let data_url = format!(
            "data:image/png;base64,{}",
            BASE64_STANDARD.encode(png.into_inner())
        );
        let annotation_data = r##"[{"tool":"rect","start":{"x":0.1,"y":0.1},"end":{"x":0.9,"y":0.9},"color":"#ff4d4f","width":5}]"##;
        let annotated = database
            .save_image_annotation(created.images[0].id, Some(&data_url), Some(annotation_data))
            .expect("annotation should save");
        let annotated_path = annotated.images[0]
            .annotated_path
            .clone()
            .expect("annotated path should exist");
        assert_eq!(annotated.images[0].display_name, "窗沿瞄准参照");
        assert!(Path::new(&original_path).exists());
        assert!(Path::new(&annotated_path).exists());
        assert_eq!(
            annotated.images[0].annotation_data.as_deref(),
            Some(annotation_data)
        );

        let cleared = database
            .save_image_annotation(created.images[0].id, None, None)
            .expect("annotation should clear");
        assert_eq!(cleared.images[0].display_name, "窗沿瞄准参照");
        assert!(cleared.images[0].annotated_path.is_none());
        assert!(cleared.images[0].annotation_data.is_none());
        assert!(Path::new(&original_path).exists());
        assert!(!Path::new(&annotated_path).exists());

        let annotated_again = database
            .save_image_annotation(created.images[0].id, Some(&data_url), Some(annotation_data))
            .expect("annotation should save again");
        let second_annotated_path = annotated_again.images[0]
            .annotated_path
            .clone()
            .expect("second annotated path should exist");
        database
            .delete_note(created.id)
            .expect("note should be deleted");
        assert!(!Path::new(&original_path).exists());
        assert!(!Path::new(&second_annotated_path).exists());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn required_note_fields_are_validated() {
        let (database, directory) = test_database();
        let mut input = sample_input("   ");
        let error = database
            .create_note(input.clone())
            .expect_err("blank title should be rejected");
        assert_eq!(error, "标题不能为空");

        input.title = "有效标题".to_string();
        input.map_name = String::new();
        let error = database
            .create_note(input)
            .expect_err("blank map should be rejected");
        assert_eq!(error, "地图不能为空");
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn edited_annotation_objects_keep_ids_multiline_text_original_and_image_name() {
        let (database, directory) = test_database();
        let source = directory.join("editable-source.png");
        image::DynamicImage::new_rgba8(128, 64)
            .save(&source)
            .unwrap();
        let created = database
            .save_note_with_images(
                None,
                sample_input("可编辑标注"),
                vec![NoteImageInput {
                    existing_id: None,
                    source_path: Some(source.to_string_lossy().into_owned()),
                    image_type: "瞄点".into(),
                    display_name: "窗沿参照".into(),
                }],
            )
            .unwrap();
        let original = created.images[0].image_path.clone();
        let image_id = created.images[0].id;
        let png = format!(
            "data:image/png;base64,{}",
            BASE64_STANDARD.encode(fs::read(&source).unwrap())
        );
        let before = r##"[{"id":"stable-text","tool":"text","point":{"x":0.1,"y":0.2},"text":"原文字","color":"#ffffff","fontSize":32,"textBaseline":"top"}]"##;
        let after = r##"[{"id":"stable-text","tool":"text","point":{"x":0.3,"y":0.4},"text":"修改第一行\n\n第三行","color":"#31a8ff","fontSize":44,"textBaseline":"top"}]"##;
        let first = database
            .save_image_annotation(image_id, Some(&png), Some(before))
            .unwrap();
        let old_annotation = first.images[0].annotated_path.clone().unwrap();
        database
            .save_image_annotation(image_id, Some(&png), Some(after))
            .unwrap();
        let reopened = Database::new(directory.join("notebook.db"))
            .get_note(created.id)
            .unwrap()
            .unwrap();
        assert_eq!(reopened.images[0].annotation_data.as_deref(), Some(after));
        assert_eq!(reopened.images[0].display_name, "窗沿参照");
        assert_eq!(reopened.images[0].image_path, original);
        assert!(Path::new(&original).is_file());
        assert!(!Path::new(&old_annotation).exists());
        let decoded = image::open(reopened.images[0].annotated_path.as_ref().unwrap()).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (128, 64));
        fs::remove_dir_all(directory).unwrap();
    }
}
