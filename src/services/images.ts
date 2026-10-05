import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface ClipboardImage {
  path: string;
  width: number;
  height: number;
}

export async function importClipboardImage(): Promise<ClipboardImage> {
  try {
    return await invoke<ClipboardImage>("import_clipboard_image");
  } catch (error) {
    throw new Error(typeof error === "string" ? error : error instanceof Error ? error.message : "无法读取剪贴板图片");
  }
}

export async function pickImageFiles(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    title: "选择笔记图片",
    filters: [
      {
        name: "图片",
        extensions: ["png", "jpg", "jpeg", "webp"],
      },
    ],
  });

  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}
