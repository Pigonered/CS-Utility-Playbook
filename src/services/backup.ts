import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export interface BackupOperationResult {
  path: string;
  createdAt: string;
  noteCount: number;
  imageCount: number;
}

export interface BackupStatus {
  automaticBackupCount: number;
  latestAutomaticBackupAt: string | null;
  automaticBackupLimit: number;
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "备份操作发生未知错误";
}

async function invokeBackup<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

function backupFileName(): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
  return `CSNotebookBackup-${timestamp}.zip`;
}

export const backupApi = {
  getStatus: () => invokeBackup<BackupStatus>("get_backup_status"),
  chooseExportPath: () => save({
    title: "导出 CS 瞄点笔记本备份",
    defaultPath: backupFileName(),
    filters: [{ name: "CS Notebook 备份", extensions: ["zip"] }],
  }),
  chooseImportPath: () => open({
    title: "选择 CS 瞄点笔记本备份",
    multiple: false,
    directory: false,
    filters: [{ name: "CS Notebook 备份", extensions: ["zip"] }],
  }),
  exportBackup: (destination: string) => invokeBackup<BackupOperationResult>("export_backup", { destination }),
  restoreBackup: (source: string) => invokeBackup<BackupOperationResult>("restore_backup", { source }),
};
