import { open } from "@tauri-apps/plugin-dialog";

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
