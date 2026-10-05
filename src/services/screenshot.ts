import { invoke } from "@tauri-apps/api/core";

export interface CaptureSession {
  captureId: number;
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
  showOverlay: (captureId: number) => call<void>("show_capture_overlay", { captureId }),
  complete: (captureId: number, selection: CaptureSelection) => call<string>("complete_capture", { captureId, selection }),
  cancel: (captureId: number) => call<void>("cancel_capture", { captureId }),
  discardTempImages: (paths: string[]) => call<void>("discard_temp_images", { paths }),
};
