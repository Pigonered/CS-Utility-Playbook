import { invoke } from "@tauri-apps/api/core";
import type { Note, NoteImageInput, NoteInput, Tag } from "../types/note";

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "发生了未知错误";
}

async function invokeDatabase<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

export const notesApi = {
  getNotes: () => invokeDatabase<Note[]>("get_notes"),
  getNote: (id: number) => invokeDatabase<Note | null>("get_note", { id }),
  createNote: (input: NoteInput) => invokeDatabase<Note>("create_note", { input }),
  updateNote: (id: number, input: NoteInput) => invokeDatabase<Note>("update_note", { id, input }),
  saveNoteWithImages: (id: number | null, input: NoteInput, imageItems: NoteImageInput[]) => (
    invokeDatabase<Note>("save_note_with_images", { id, input, imageItems })
  ),
  deleteNote: (id: number) => invokeDatabase<void>("delete_note", { id }),
  saveImageAnnotation: (imageId: number, pngData: string | null, annotationData: string | null) => (
    invokeDatabase<Note>("save_image_annotation", { imageId, pngData, annotationData })
  ),
  getTags: () => invokeDatabase<Tag[]>("get_tags"),
  createTag: (name: string) => invokeDatabase<Tag>("create_tag", { name }),
};
