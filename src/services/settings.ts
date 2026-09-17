import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface AppSettings {
  dataDirectory: string;
  screenshotShortcut: string | null;
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "设置操作失败";
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

export const settingsApi = {
  get: () => call<AppSettings>("get_settings"),
  setScreenshotShortcut: (shortcut: string | null) => (
    call<AppSettings>("set_screenshot_shortcut", { shortcut })
  ),
  chooseDataDirectory: async () => {
    const selected = await open({
      title: "选择笔记和图片的保存文件夹",
      multiple: false,
      directory: true,
    });
    return typeof selected === "string" ? selected : null;
  },
  changeDataDirectory: (destination: string) => (
    call<void>("change_data_directory", { destination })
  ),
};
