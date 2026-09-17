use crate::backup::BackupService;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

type SettingsResult<T> = Result<T, String>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct PersistedSettings {
    data_directory: Option<String>,
    screenshot_shortcut: Option<String>,
    close_to_tray: bool,
}

impl Default for PersistedSettings {
    fn default() -> Self {
        Self {
            data_directory: None,
            screenshot_shortcut: Some("Alt+Q".to_string()),
            close_to_tray: true,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    data_directory: String,
    screenshot_shortcut: Option<String>,
    close_to_tray: bool,
}

#[derive(Clone, Debug)]
pub struct SettingsManager {
    config_path: PathBuf,
    default_data_directory: PathBuf,
    settings: Arc<Mutex<PersistedSettings>>,
}

impl SettingsManager {
    pub fn new(config_path: PathBuf, default_data_directory: PathBuf) -> SettingsResult<Self> {
        let settings = if config_path.is_file() {
            let content = fs::read_to_string(&config_path)
                .map_err(|error| format!("无法读取设置文件：{error}"))?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            PersistedSettings::default()
        };
        Ok(Self {
            config_path,
            default_data_directory,
            settings: Arc::new(Mutex::new(settings)),
        })
    }

    pub fn data_directory(&self) -> SettingsResult<PathBuf> {
        let settings = self
            .settings
            .lock()
            .map_err(|_| "设置状态不可用".to_string())?;
        Ok(settings
            .data_directory
            .as_deref()
            .map(PathBuf::from)
            .unwrap_or_else(|| self.default_data_directory.clone()))
    }

    pub fn screenshot_shortcut(&self) -> SettingsResult<Option<String>> {
        self.settings
            .lock()
            .map_err(|_| "设置状态不可用".to_string())
            .map(|settings| settings.screenshot_shortcut.clone())
    }

    pub fn close_to_tray(&self) -> SettingsResult<bool> {
        self.settings
            .lock()
            .map_err(|_| "设置状态不可用".to_string())
            .map(|settings| settings.close_to_tray)
    }

    pub fn snapshot(&self) -> SettingsResult<SettingsSnapshot> {
        Ok(SettingsSnapshot {
            data_directory: self.data_directory()?.to_string_lossy().into_owned(),
            screenshot_shortcut: self.screenshot_shortcut()?,
            close_to_tray: self.close_to_tray()?,
        })
    }

    fn save(&self, settings: &PersistedSettings) -> SettingsResult<()> {
        if let Some(parent) = self.config_path.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("无法创建设置目录：{error}"))?;
        }
        let content = serde_json::to_string_pretty(settings)
            .map_err(|error| format!("无法生成设置数据：{error}"))?;
        fs::write(&self.config_path, content).map_err(|error| format!("无法保存设置：{error}"))
    }

    fn update_shortcut(&self, shortcut: Option<String>) -> SettingsResult<()> {
        let mut guard = self
            .settings
            .lock()
            .map_err(|_| "设置状态不可用".to_string())?;
        let mut next = guard.clone();
        next.screenshot_shortcut = shortcut;
        self.save(&next)?;
        *guard = next;
        Ok(())
    }

    fn update_data_directory(&self, directory: &Path) -> SettingsResult<()> {
        let mut guard = self
            .settings
            .lock()
            .map_err(|_| "设置状态不可用".to_string())?;
        let mut next = guard.clone();
        next.data_directory = Some(directory.to_string_lossy().into_owned());
        self.save(&next)?;
        *guard = next;
        Ok(())
    }

    fn update_close_to_tray(&self, enabled: bool) -> SettingsResult<()> {
        let mut guard = self
            .settings
            .lock()
            .map_err(|_| "设置状态不可用".to_string())?;
        let mut next = guard.clone();
        next.close_to_tray = enabled;
        self.save(&next)?;
        *guard = next;
        Ok(())
    }
}

#[tauri::command]
pub fn get_settings(settings: State<'_, SettingsManager>) -> SettingsResult<SettingsSnapshot> {
    settings.snapshot()
}

#[tauri::command]
pub fn set_screenshot_shortcut(
    shortcut: Option<String>,
    app: AppHandle,
    settings: State<'_, SettingsManager>,
) -> SettingsResult<SettingsSnapshot> {
    let shortcut = shortcut
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let previous = settings.screenshot_shortcut()?;
    if previous == shortcut {
        return settings.snapshot();
    }

    if let Some(value) = &previous {
        let _ = app.global_shortcut().unregister(value.as_str());
    }
    if let Some(value) = &shortcut {
        if let Err(error) = app.global_shortcut().register(value.as_str()) {
            if let Some(previous) = &previous {
                let _ = app.global_shortcut().register(previous.as_str());
            }
            return Err(format!("快捷键不可用或已被占用：{error}"));
        }
    }

    if let Err(error) = settings.update_shortcut(shortcut.clone()) {
        if let Some(value) = &shortcut {
            let _ = app.global_shortcut().unregister(value.as_str());
        }
        if let Some(previous) = &previous {
            let _ = app.global_shortcut().register(previous.as_str());
        }
        return Err(error);
    }
    settings.snapshot()
}

#[tauri::command]
pub fn set_close_to_tray(
    enabled: bool,
    settings: State<'_, SettingsManager>,
) -> SettingsResult<SettingsSnapshot> {
    settings.update_close_to_tray(enabled)?;
    settings.snapshot()
}

#[tauri::command]
pub async fn change_data_directory(
    destination: String,
    app: AppHandle,
    service: State<'_, BackupService>,
    settings: State<'_, SettingsManager>,
) -> SettingsResult<()> {
    let destination = PathBuf::from(destination.trim());
    if destination.as_os_str().is_empty() {
        return Err("请选择新的数据保存位置".to_string());
    }
    let service = service.inner().clone();
    let settings = settings.inner().clone();
    let destination = tauri::async_runtime::spawn_blocking(move || {
        service.migrate_to_directory(&destination)?;
        let destination = fs::canonicalize(&destination)
            .map_err(|error| format!("无法读取新的数据目录：{error}"))?;
        settings.update_data_directory(&destination)?;
        Ok::<_, String>(destination)
    })
    .await
    .map_err(|error| format!("数据迁移任务异常结束：{error}"))??;

    let _ = destination;
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn settings_are_persisted_outside_the_selected_data_directory() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "cs-lineup-settings-test-{}-{unique}",
            std::process::id()
        ));
        let config_path = root.join("config").join("settings.json");
        let default_data = root.join("default-data");
        let custom_data = root.join("custom-data");
        let manager = SettingsManager::new(config_path.clone(), default_data)
            .expect("settings should initialize");
        manager
            .update_data_directory(&custom_data)
            .expect("data directory should save");
        manager.update_shortcut(None).expect("shortcut should save");
        assert!(manager
            .close_to_tray()
            .expect("close behavior should use its enabled default"));
        manager
            .update_close_to_tray(false)
            .expect("close behavior should save");

        let reloaded = SettingsManager::new(config_path, root.join("unused-default"))
            .expect("settings should reload");
        assert_eq!(
            reloaded.data_directory().expect("path should load"),
            custom_data
        );
        assert!(reloaded
            .screenshot_shortcut()
            .expect("shortcut should load")
            .is_none());
        assert!(!reloaded
            .close_to_tray()
            .expect("close behavior should load"));

        fs::remove_dir_all(root).expect("test directory should be removed");
    }
}
