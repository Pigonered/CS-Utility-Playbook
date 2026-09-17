import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnnotationEditor } from "./components/AnnotationEditor";
import { BackupManager } from "./components/BackupManager";
import { NoteDetail } from "./components/NoteDetail";
import { NoteEditor } from "./components/NoteEditor";
import { NoteList } from "./components/NoteList";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { notesApi } from "./services/notes";
import { screenshotApi } from "./services/screenshot";
import type { BackupOperationResult } from "./services/backup";
import { grenadeTypeLabel, throwTypeLabel, type Note, type NoteFilters, type NoteImage, type NoteImageInput, type NoteInput, type Tag } from "./types/note";

const initialFilters: NoteFilters = { mapName: null, side: null, grenadeType: null, tagName: null };

type EditorState =
  | { mode: "create"; note: null; temporaryImagePaths: string[] }
  | { mode: "edit"; note: Note; temporaryImagePaths: string[] };

interface ScreenshotCompletedPayload {
  path: string;
}

function App() {
  const [filters, setFilters] = useState<NoteFilters>(initialFilters);
  const [searchQuery, setSearchQuery] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [annotationImage, setAnnotationImage] = useState<NoteImage | null>(null);
  const [isAnnotationSaving, setIsAnnotationSaving] = useState(false);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadNotes = useCallback(async (preferredId?: number) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [loadedNotes, loadedTags] = await Promise.all([
        notesApi.getNotes(),
        notesApi.getTags(),
      ]);
      setNotes(loadedNotes);
      setAvailableTags(loadedTags);
      setSelectedId((currentId) => (
        preferredId !== undefined && loadedNotes.some((note) => note.id === preferredId)
          ? preferredId
          : currentId !== null && loadedNotes.some((note) => note.id === currentId)
          ? currentId
          : loadedNotes[0]?.id ?? null
      ));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "无法读取本地数据库");
      setNotes([]);
      setAvailableTags([]);
      setSelectedId(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void listen<ScreenshotCompletedPayload>("screenshot-completed", (event) => {
      setEditorError(null);
      setEditor((current) => {
        if (!current) {
          return { mode: "create", note: null, temporaryImagePaths: [event.payload.path] };
        }
        return {
          ...current,
          temporaryImagePaths: [...current.temporaryImagePaths, event.payload.path],
        };
      });
      setNotice("截图已追加到当前笔记");
      window.setTimeout(() => setNotice(null), 2600);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    }).catch(() => {
      // 普通浏览器预览没有 Tauri 事件通道，桌面应用中会正常注册。
    });

    void listen<string>("screenshot-error", (event) => {
      setNotice(event.payload || "截图失败");
      window.setTimeout(() => setNotice(null), 3200);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    }).catch(() => {
      // 普通浏览器预览没有 Tauri 事件通道，桌面应用中会正常注册。
    });

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const filteredNotes = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("zh-CN");
    return notes.filter((note) => {
      const matchesFilters = (!filters.mapName || note.mapName === filters.mapName)
        && (!filters.side || note.side === filters.side)
        && (!filters.grenadeType || note.grenadeType === filters.grenadeType)
        && (!filters.tagName || note.tags.some(
          (tag) => tag.name.toLocaleLowerCase("zh-CN") === filters.tagName?.toLocaleLowerCase("zh-CN"),
        ));
      if (!matchesFilters || !query) return matchesFilters;
      const searchable = [
        note.title,
        note.mapName,
        note.side,
        grenadeTypeLabel(note.grenadeType),
        throwTypeLabel(note.throwType),
        note.startPosition,
        note.targetPosition,
        note.description,
        ...note.tags.map((tag) => tag.name),
      ];
      return searchable.some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
    });
  }, [filters, notes, searchQuery]);

  useEffect(() => {
    if (filteredNotes.length === 0) {
      setSelectedId(null);
    } else if (!filteredNotes.some((note) => note.id === selectedId)) {
      setSelectedId(filteredNotes[0].id);
    }
  }, [filteredNotes, selectedId]);

  useEffect(() => {
    let cancelled = false;
    if (selectedId === null) {
      setSelectedNote(null);
      setDetailError(null);
      setIsDetailLoading(false);
      return () => { cancelled = true; };
    }

    setSelectedNote(null);
    setDetailError(null);
    setIsDetailLoading(true);
    void notesApi.getNote(selectedId)
      .then((note) => {
        if (!cancelled) setSelectedNote(note);
      })
      .catch((error: unknown) => {
        if (!cancelled) setDetailError(error instanceof Error ? error.message : "无法读取笔记详情");
      })
      .finally(() => {
        if (!cancelled) setIsDetailLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.search-bar input')?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const hasActiveSearch = Boolean(searchQuery.trim()) || Object.values(filters).some(Boolean);

  const showPhaseNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  };

  const handleDelete = async () => {
    if (!selectedNote || isDeleting) return;
    const confirmed = window.confirm(`确定要删除「${selectedNote.title}」吗？此操作无法撤销。`);
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await notesApi.deleteNote(selectedNote.id);
      setNotice("笔记已删除");
      setSelectedNote(null);
      await loadNotes();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除笔记失败");
    } finally {
      setIsDeleting(false);
      window.setTimeout(() => setNotice(null), 2600);
    }
  };

  const openCreateEditor = () => {
    setEditorError(null);
    setEditor({ mode: "create", note: null, temporaryImagePaths: [] });
  };

  const openEditEditor = () => {
    if (!selectedNote) return;
    setEditorError(null);
    setEditor({ mode: "edit", note: selectedNote, temporaryImagePaths: [] });
  };

  const closeEditor = () => {
    if (isSaving) return;
    if (editor && editor.temporaryImagePaths.length > 0) {
      void screenshotApi.discardTempImages(editor.temporaryImagePaths);
    }
    setEditor(null);
    setEditorError(null);
  };

  const handleSave = async (input: NoteInput, imageItems: NoteImageInput[]) => {
    if (!editor || isSaving) return;
    const temporaryImages = editor.temporaryImagePaths;
    setIsSaving(true);
    setEditorError(null);
    try {
      const savedNote = await notesApi.saveNoteWithImages(
        editor.mode === "create" ? null : editor.note.id,
        input,
        imageItems,
      );

      if (editor.mode === "create") {
        setFilters(initialFilters);
        setSearchQuery("");
      }
      await loadNotes(savedNote.id);
      setSelectedId(savedNote.id);
      setSelectedNote(savedNote);
      setEditor(null);
      if (temporaryImages.length > 0) {
        void screenshotApi.discardTempImages(temporaryImages);
      }
      showPhaseNotice(editor.mode === "create" ? "笔记已创建" : "修改已保存");
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "保存笔记失败");
    } finally {
      setIsSaving(false);
    }
  };

  const openAnnotationEditor = (image: NoteImage) => {
    setAnnotationError(null);
    setAnnotationImage(image);
  };

  const handleSaveAnnotation = async (pngData: string | null, annotationData: string | null) => {
    if (!annotationImage || isAnnotationSaving) return;
    setIsAnnotationSaving(true);
    setAnnotationError(null);
    try {
      const savedNote = await notesApi.saveImageAnnotation(
        annotationImage.id,
        pngData,
        annotationData,
      );
      setSelectedNote(savedNote);
      setNotes((current) => current.map((note) => note.id === savedNote.id ? savedNote : note));
      setAnnotationImage(null);
      showPhaseNotice(annotationData ? "图片标注已保存" : "图片已恢复为原图");
    } catch (error) {
      setAnnotationError(error instanceof Error ? error.message : "保存图片标注失败");
    } finally {
      setIsAnnotationSaving(false);
    }
  };

  const openBackupManager = () => {
    if (editor || annotationImage) {
      showPhaseNotice("请先保存或关闭当前编辑器");
      return;
    }
    setIsBackupOpen(true);
  };

  const handleBackupRestored = async (_result: BackupOperationResult) => {
    setFilters(initialFilters);
    setSearchQuery("");
    setSelectedId(null);
    setSelectedNote(null);
    await loadNotes();
    showPhaseNotice("备份已完整恢复");
  };

  return (
    <div className="app-shell">
      <TopBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onCreateNote={openCreateEditor}
        onOpenBackup={openBackupManager}
      />
      <div className="workspace">
        <Sidebar filters={filters} tags={availableTags} onChange={setFilters} />
        <NoteList
          notes={filteredNotes}
          selectedId={selectedId}
          onSelect={setSelectedId}
          hasActiveSearch={hasActiveSearch}
          isLoading={isLoading}
          error={loadError}
          onRetry={() => void loadNotes()}
        />
        <NoteDetail
          note={selectedNote}
          isLoading={isLoading || isDetailLoading}
          error={detailError ?? (notes.length === 0 ? loadError : null)}
          isDeleting={isDeleting}
          onEdit={openEditEditor}
          onDelete={() => void handleDelete()}
          onTagSelect={(tagName) => setFilters((current) => ({ ...current, tagName }))}
          onAnnotate={openAnnotationEditor}
        />
      </div>
      {editor && (
        <NoteEditor
          key={editor.mode === "create" ? "create" : `edit-${editor.note.id}`}
          mode={editor.mode}
          note={editor.note}
          capturedImagePaths={editor.temporaryImagePaths}
          availableTags={availableTags}
          isSaving={isSaving}
          error={editorError}
          onSave={(input, imageItems) => void handleSave(input, imageItems)}
          onClose={closeEditor}
        />
      )}
      {annotationImage && (
        <AnnotationEditor
          key={annotationImage.id}
          image={annotationImage}
          isSaving={isAnnotationSaving}
          error={annotationError}
          onSave={handleSaveAnnotation}
          onClose={() => {
            if (!isAnnotationSaving) {
              setAnnotationImage(null);
              setAnnotationError(null);
            }
          }}
        />
      )}
      {isBackupOpen && (
        <BackupManager
          onClose={() => setIsBackupOpen(false)}
          onRestored={handleBackupRestored}
        />
      )}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

export default App;
