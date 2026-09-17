import { invoke } from "@tauri-apps/api/core";

export interface CaptureSession {
  imagePath: string;
  width: number;
  height: number;
}

export interface CaptureSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

function messageFrom(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "截图操作失败";
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(messageFrom(error));
  }
}

export const screenshotApi = {
  getSession: () => call<CaptureSession>("get_capture_session"),
  showOverlay: () => call<void>("show_capture_overlay"),
  complete: (selection: CaptureSelection) => call<string>("complete_capture", { selection }),
  cancel: () => call<void>("cancel_capture"),
  discardTempImages: (paths: string[]) => call<void>("discard_temp_images", { paths }),
};
