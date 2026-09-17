import { useEffect, useState } from "react";
import { backupApi, type BackupOperationResult, type BackupStatus } from "../services/backup";
import { DatabaseIcon } from "./icons";

interface BackupManagerProps {
  onClose: () => void;
  onRestored: (result: BackupOperationResult) => Promise<void>;
}

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

export function BackupManager({ onClose, onRestored }: BackupManagerProps) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState<"export" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restorePath, setRestorePath] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const refreshStatus = async () => {
    try {
      setStatus(await backupApi.getStatus());
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "无法读取自动备份状态");
    }
  };

  useEffect(() => {
    void refreshStatus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

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
    <div className="backup-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="backup-manager" role="dialog" aria-modal="true" aria-labelledby="backup-title">
        <header className="backup-header">
          <div className="backup-title-icon"><DatabaseIcon /></div>
          <div>
            <span className="eyebrow">数据安全</span>
            <h2 id="backup-title">数据安全与备份</h2>
            <p>导出完整笔记库，或从已有备份恢复</p>
          </div>
          <button type="button" className="editor-close" onClick={onClose} disabled={Boolean(busy)} aria-label="关闭数据安全面板">×</button>
        </header>

        <div className="backup-content">
          <section className="backup-card automatic-backup-card">
            <div className="backup-card-heading">
              <div><span>自动备份</span><small>自动执行</small></div>
              <strong className="status-badge">已启用</strong>
            </div>
            <p>应用启动时每天检查一次，只保留最近 {status?.automaticBackupLimit ?? 7} 份。</p>
            <dl>
              <div><dt>最近备份</dt><dd>{status ? formatDate(status.latestAutomaticBackupAt) : "正在读取…"}</dd></div>
              <div><dt>现有数量</dt><dd>{status ? `${status.automaticBackupCount} 份` : "—"}</dd></div>
            </dl>
          </section>

          <section className="backup-card">
            <div className="backup-card-heading">
              <div><span>导出笔记库</span><small>导出备份</small></div>
            </div>
            <p>生成一个压缩备份文件，包含数据库、原图、标注图和版本信息。</p>
            <button type="button" className="secondary-button backup-action-button" onClick={() => void exportBackup()} disabled={Boolean(busy)}>
              {busy === "export" && <span className="button-spinner dark" />}
              {busy === "export" ? "正在导出…" : "选择位置并导出"}
            </button>
          </section>

          <section className="backup-card restore-card">
            <div className="backup-card-heading">
              <div><span>恢复备份</span><small>完整恢复</small></div>
              <strong className="warning-badge">完整覆盖</strong>
            </div>
            <p>第一版仅支持完整恢复，不支持合并。恢复前会自动保存当前数据。</p>
            <button type="button" className="secondary-button backup-action-button" onClick={() => void chooseRestore()} disabled={Boolean(busy)}>
              选择备份文件
            </button>

            {restorePath && (
              <div className="restore-confirmation">
                <strong>{fileName(restorePath)}</strong>
                <ul>
                  <li>当前数据库和图片将替换为备份内容。</li>
                  <li>系统会先创建一份“恢复前备份”。</li>
                  <li>备份包会经过路径、结构和完整性检查。</li>
                </ul>
                <label>
                  <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={Boolean(busy)} />
                  我了解这是完整覆盖恢复
                </label>
                <button type="button" className="danger-button" onClick={() => void restoreBackup()} disabled={!confirmed || Boolean(busy)}>
                  {busy === "restore" ? "正在验证并恢复…" : "确认完整恢复"}
                </button>
              </div>
            )}
          </section>

          {error && <div className="backup-message error" role="alert">{error}</div>}
          {message && <div className="backup-message success" role="status">{message}</div>}
        </div>

        <footer className="backup-footer">
          <span>备份不会修改原始图片；恢复成功后列表会自动刷新。</span>
          <button type="button" className="secondary-button" onClick={onClose} disabled={Boolean(busy)}>完成</button>
        </footer>
      </section>
    </div>
  );
}
