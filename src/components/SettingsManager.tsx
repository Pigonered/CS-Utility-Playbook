import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { backupApi, type BackupOperationResult, type BackupStatus } from "../services/backup";
import { settingsApi, type AppSettings } from "../services/settings";
import { CloseIcon, DatabaseIcon, GithubIcon, InfoIcon, SettingsIcon } from "./icons";

interface SettingsManagerProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onClose: () => void;
  onRestored: (result: BackupOperationResult) => Promise<void>;
}

type BusyAction = "directory" | "shortcut" | "background" | "export" | "restore" | null;
type SettingsView = "settings" | "about";

function formatDate(value: string | null): string {
  if (!value) return "尚未创建";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function shortcutFromEvent(event: ReactKeyboardEvent<HTMLButtonElement>): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;
  let key = "";
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (/^F(?:[1-9]|1[0-2])$/.test(event.code)) key = event.code;
  else {
    const aliases: Record<string, string> = {
      Space: "Space",
      Enter: "Enter",
      ArrowUp: "ArrowUp",
      ArrowDown: "ArrowDown",
      ArrowLeft: "ArrowLeft",
      ArrowRight: "ArrowRight",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown",
      Insert: "Insert",
      Delete: "Delete",
    };
    key = aliases[event.code] ?? "";
  }
  if (!key) return null;
  const modifiers = [
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Super" : "",
  ].filter(Boolean);
  if (modifiers.length === 0 && !key.startsWith("F")) return null;
  return [...modifiers, key].join("+");
}

function ShortcutKeys({ shortcut }: { shortcut: string | null }) {
  if (!shortcut) return <span className="shortcut-unbound">未绑定</span>;
  return <>{shortcut.split("+").map((key, index) => (
    <span className="shortcut-key-group" key={`${key}-${index}`}>
      {index > 0 && <i>+</i>}<span className="shortcut-key">{key}</span>
    </span>
  ))}</>;
}

export function SettingsManager({ settings, onSettingsChange, onClose, onRestored }: SettingsManagerProps) {
  const [activeView, setActiveView] = useState<SettingsView>("settings");
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restorePath, setRestorePath] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [isBinding, setIsBinding] = useState(false);
  const shortcutButtonRef = useRef<HTMLButtonElement>(null);

  const refreshStatus = async () => {
    try {
      setStatus(await backupApi.getStatus());
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "无法读取自动备份状态");
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    if (isBinding) shortcutButtonRef.current?.focus();
  }, [isBinding]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !isBinding) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, isBinding, onClose]);

  const changeDirectory = async () => {
    setError(null);
    setMessage(null);
    const selected = await settingsApi.chooseDataDirectory();
    if (!selected || selected === settings.dataDirectory) return;
    const confirmedChange = window.confirm(
      "当前笔记和图片将复制到新目录，原目录会保留一份安全副本。完成后应用会自动重启，是否继续？",
    );
    if (!confirmedChange) return;
    setBusy("directory");
    try {
      await settingsApi.changeDataDirectory(selected);
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "修改保存位置失败");
      setBusy(null);
    }
  };

  const beginShortcutBinding = async () => {
    if (busy) return;
    setError(null);
    setMessage(null);
    setBusy("shortcut");
    try {
      const next = await settingsApi.setScreenshotShortcut(null);
      onSettingsChange(next);
      setIsBinding(true);
    } catch (shortcutError) {
      setError(shortcutError instanceof Error ? shortcutError.message : "无法开始快捷键绑定");
    } finally {
      setBusy(null);
    }
  };

  const bindShortcut = async (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setIsBinding(false);
      setMessage("截图快捷键已解除绑定");
      return;
    }
    const shortcut = shortcutFromEvent(event);
    if (!shortcut) {
      setError("请按下带 Ctrl、Alt、Shift 的组合键，或单独按 F1–F12");
      return;
    }
    setBusy("shortcut");
    setError(null);
    try {
      const next = await settingsApi.setScreenshotShortcut(shortcut);
      onSettingsChange(next);
      setIsBinding(false);
      setMessage(`截图快捷键已设置为 ${shortcut}`);
    } catch (shortcutError) {
      setError(shortcutError instanceof Error ? shortcutError.message : "截图快捷键绑定失败");
    } finally {
      setBusy(null);
    }
  };

  const toggleCloseToTray = async () => {
    if (busy) return;
    setBusy("background");
    setError(null);
    setMessage(null);
    try {
      const next = await settingsApi.setCloseToTray(!settings.closeToTray);
      onSettingsChange(next);
      setMessage(next.closeToTray ? "关闭主窗口时将在后台继续运行" : "关闭主窗口时将直接退出应用");
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : "无法修改后台运行设置");
    } finally {
      setBusy(null);
    }
  };

  const exportBackup = async () => {
    setError(null);
    setMessage(null);
    const selected = await backupApi.chooseExportPath();
    if (!selected) return;
    const destination = selected.toLocaleLowerCase().endsWith(".zip") ? selected : `${selected}.zip`;
    setBusy("export");
    try {
      const result = await backupApi.exportBackup(destination);
      setMessage(`备份已导出：${fileName(result.path)}（${result.noteCount} 条笔记，${result.imageCount} 张图片）`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "导出备份失败");
    } finally {
      setBusy(null);
    }
  };

  const chooseRestore = async () => {
    setError(null);
    setMessage(null);
    const selected = await backupApi.chooseImportPath();
    if (!selected || Array.isArray(selected)) return;
    setRestorePath(selected);
    setConfirmed(false);
  };

  const restoreBackup = async () => {
    if (!restorePath || !confirmed) return;
    setBusy("restore");
    setError(null);
    setMessage(null);
    try {
      const result = await backupApi.restoreBackup(restorePath);
      await onRestored(result);
      setRestorePath(null);
      setConfirmed(false);
      setMessage(`恢复完成：${result.noteCount} 条笔记，${result.imageCount} 张图片`);
      await refreshStatus();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "恢复备份失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy && !isBinding) onClose();
    }}>
      <section className="settings-manager" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-header">
          <div className="settings-title-icon"><SettingsIcon /></div>
          <div>
            <span className="eyebrow">应用设置</span>
            <h2 id="settings-title">设置</h2>
            <p>管理数据位置、截图快捷键与备份</p>
          </div>
          <button type="button" className="editor-close" onClick={onClose} disabled={Boolean(busy) || isBinding} aria-label="关闭设置"><CloseIcon /></button>
        </header>

        <div className="settings-body">
          <nav className="settings-navigation" aria-label="设置页面">
            <button
              type="button"
              className={activeView === "settings" ? "active" : ""}
              onClick={() => setActiveView("settings")}
              aria-current={activeView === "settings" ? "page" : undefined}
            >
              <SettingsIcon /><span>设置</span>
            </button>
            <button
              type="button"
              className={activeView === "about" ? "active" : ""}
              onClick={() => setActiveView("about")}
              aria-current={activeView === "about" ? "page" : undefined}
            >
              <InfoIcon /><span>关于</span>
            </button>
          </nav>

          {activeView === "settings" ? <div className="settings-content">
          <section className="settings-section">
            <div className="settings-section-heading"><SettingsIcon /><div><strong>常规设置</strong><small>后台运行、存储与快捷键</small></div></div>
            <div className="settings-card">
              <div className="setting-row background-setting-row">
                <div><strong>关闭时放到后台</strong><p>关闭主窗口后继续运行，截图快捷键仍然可用</p></div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.closeToTray}
                  className={settings.closeToTray ? "settings-switch active" : "settings-switch"}
                  onClick={() => void toggleCloseToTray()}
                  disabled={Boolean(busy)}
                >
                  <span className="settings-switch-track"><i /></span>
                  <strong>{settings.closeToTray ? "已开启" : "已关闭"}</strong>
                </button>
              </div>
              <small className="setting-help">默认开启。隐藏后可左键点击系统托盘图标重新打开，或从托盘菜单彻底退出。</small>
            </div>
            <div className="settings-card">
              <div className="setting-row storage-setting-row">
                <div><strong>图片及笔记保存位置</strong><p title={settings.dataDirectory}>{settings.dataDirectory || "正在读取…"}</p></div>
                <button type="button" className="secondary-button" onClick={() => void changeDirectory()} disabled={Boolean(busy)}>更改位置</button>
              </div>
              <small className="setting-help">更改时会复制数据库和图片并自动重启；为避免覆盖，请选择未包含笔记本数据的目录。</small>
            </div>
            <div className="settings-card">
              <div className="setting-row shortcut-setting-row">
                <div><strong>全局截图快捷键</strong><p>在任意窗口中启动区域截图</p></div>
                <button
                  ref={shortcutButtonRef}
                  type="button"
                  className={isBinding ? "shortcut-binding active" : "shortcut-binding"}
                  onClick={() => void beginShortcutBinding()}
                  onKeyDown={(event) => void bindShortcut(event)}
                  disabled={Boolean(busy)}
                >
                  {isBinding ? <span>请按下新快捷键</span> : <ShortcutKeys shortcut={settings.screenshotShortcut} />}
                </button>
              </div>
              <small className="setting-help">左键点击按键框开始绑定；绑定状态下按 Esc 解除快捷键。</small>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-heading"><DatabaseIcon /><div><strong>数据安全</strong><small>自动备份、导出与恢复</small></div></div>
            <section className="backup-card automatic-backup-card">
              <div className="backup-card-heading"><div><span>自动备份</span><small>自动执行</small></div><strong className="status-badge">已启用</strong></div>
              <p>应用启动时每天检查一次，只保留最近 {status?.automaticBackupLimit ?? 7} 份。</p>
              <dl>
                <div><dt>最近备份</dt><dd>{status ? formatDate(status.latestAutomaticBackupAt) : "正在读取…"}</dd></div>
                <div><dt>现有数量</dt><dd>{status ? `${status.automaticBackupCount} 份` : "—"}</dd></div>
              </dl>
            </section>
            <div className="settings-backup-grid">
              <section className="backup-card">
                <div className="backup-card-heading"><div><span>导出笔记库</span><small>导出备份</small></div></div>
                <p>生成包含数据库、原图、标注图和版本信息的压缩备份。</p>
                <button type="button" className="secondary-button backup-action-button" onClick={() => void exportBackup()} disabled={Boolean(busy)}>
                  {busy === "export" && <span className="button-spinner dark" />}{busy === "export" ? "正在导出…" : "选择位置并导出"}
                </button>
              </section>
              <section className="backup-card restore-card">
                <div className="backup-card-heading"><div><span>恢复备份</span><small>完整恢复</small></div><strong className="warning-badge">完整覆盖</strong></div>
                <p>恢复前会自动保存当前数据，备份内容将完整覆盖当前笔记库。</p>
                <button type="button" className="secondary-button backup-action-button" onClick={() => void chooseRestore()} disabled={Boolean(busy)}>选择备份文件</button>
                {restorePath && (
                  <div className="restore-confirmation">
                    <strong>{fileName(restorePath)}</strong>
                    <ul><li>当前数据库和图片将替换为备份内容。</li><li>系统会先创建一份恢复前备份。</li></ul>
                    <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={Boolean(busy)} />我了解这是完整覆盖恢复</label>
                    <button type="button" className="danger-button" onClick={() => void restoreBackup()} disabled={!confirmed || Boolean(busy)}>{busy === "restore" ? "正在验证并恢复…" : "确认完整恢复"}</button>
                  </div>
                )}
              </section>
            </div>
          </section>

          {error && <div className="backup-message error" role="alert">{error}</div>}
          {message && <div className="backup-message success" role="status">{message}</div>}
          </div> : <div className="settings-content about-content">
            <section className="about-hero">
              <div className="about-mark"><InfoIcon /></div>
              <div>
                <span className="eyebrow">CS UTILITY PLAYBOOK</span>
                <h3>关于 CS道具战术本</h3>
                <p>当前版本 <strong>0.1.0 Beta</strong></p>
              </div>
            </section>

            <div className="about-grid">
              <section className="about-card">
                <span className="about-label">开发者</span>
                <strong>Pigonered</strong>
              </section>
              <section className="about-card">
                <span className="about-label">项目主页</span>
                <a href="https://github.com/Pigonered/CS-Utility-Playbook" target="_blank" rel="noreferrer">
                  <GithubIcon />
                  <span>GitHub: <code>Pigonered/CS-Utility-Playbook</code></span>
                </a>
              </section>
            </div>

            <section className="about-section">
              <h4>反馈与建议</h4>
              <p>如果遇到 Bug、功能异常或有改进建议，可以通过 GitHub Issues 反馈。</p>
            </section>

            <section className="about-section">
              <h4>数据说明</h4>
              <p>所有笔记、图片和设置默认保存在本地设备中。请定期备份重要数据。</p>
            </section>

            <section className="about-section about-disclaimer">
              <h4>免责声明</h4>
              <p>本软件为独立开发的第三方工具，与 Valve Corporation 或 Counter-Strike 2 官方无隶属、授权或合作关系。</p>
              <p>Counter-Strike、Counter-Strike 2 及相关商标归其各自权利人所有。</p>
            </section>

            <code className="about-tech">Built with Tauri, React, TypeScript and Rust.</code>

            <blockquote className="about-beta-note">当前版本处于测试阶段，功能和数据结构可能在后续版本中发生变化。</blockquote>
          </div>}
        </div>

        <footer className="settings-footer">
          <span>{busy === "directory" ? "正在迁移数据，请勿关闭应用…" : activeView === "settings" ? "设置会自动保存" : "0.1.0 Beta"}</span>
          <button type="button" className="secondary-button" onClick={onClose} disabled={Boolean(busy) || isBinding}>完成</button>
        </footer>
      </section>
    </div>
  );
}
