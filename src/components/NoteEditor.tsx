import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { importClipboardImage, pickImageFiles } from "../services/images";
import { TagLibrary } from "./TagLibrary";
import { cleanTag, MAX_TAGS, MAX_TAG_LENGTH, withTag } from "../types/tags";
import { screenshotApi } from "../services/screenshot";
import {
  GRENADE_TYPES,
  GRENADE_TYPE_LABELS,
  IMAGE_TYPES,
  SIDES,
  type GrenadeType,
  type ImageType,
  type MapName,
  type Note,
  type NoteImageInput,
  type NoteInput,
  type Side,
  type Tag,
} from "../types/note";
import { CloseIcon, ImageIcon, PlusIcon, TrashIcon } from "./icons";
import { DEFAULT_THROW_METHOD, formatThrowMethod } from "../types/throwMethod";
import { ThrowMethodPicker } from "./ThrowMethodPicker";

type RequiredField = "title" | "mapName" | "side" | "grenadeType";

interface FormState {
  title: string;
  mapName: MapName | "";
  side: Side | "";
  grenadeType: GrenadeType | "";
  startPosition: string;
  targetPosition: string;
  throwType: string;
  description: string;
}

interface NoteEditorProps {
  mode: "create" | "edit";
  note: Note | null;
  maps: readonly MapName[];
  capturedImagePaths?: string[];
  availableTags: Tag[];
  onTagsChange: (tags: Tag[]) => void;
  screenshotShortcut: string | null;
  isSaving: boolean;
  error: string | null;
  onSave: (input: NoteInput, imageItems: NoteImageInput[]) => void;
  onClose: () => void;
}

interface EditorImage {
  key: string;
  existingId?: number;
  sourcePath?: string;
  displayName: string;
  previewPath?: string;
  imageType: ImageType;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || "未命名图片";
}

function suggestedCaptureType(index: number): ImageType {
  if (index === 0) return "站位";
  if (index === 1) return "瞄点";
  if (index === 2) return "效果";
  return "其他";
}

function createInitialImages(note: Note | null, capturedImagePaths: string[]): EditorImage[] {
  const existingImages = note?.images.map((image) => ({
    key: `existing-${image.id}`,
    existingId: image.id,
    displayName: image.displayName ?? "",
    previewPath: image.annotatedPath ?? image.imagePath,
    imageType: image.imageType,
  })) ?? [];
  const pendingImages = capturedImagePaths.map((path, index) => ({
    key: `capture-${index}-${path}`,
    sourcePath: path,
    displayName: `截图 ${existingImages.length + index + 1}`,
    previewPath: path,
    imageType: suggestedCaptureType(existingImages.length + index),
  }));
  return [...existingImages, ...pendingImages];
}

function createInitialState(note: Note | null): FormState {
  return {
    title: note?.title ?? "",
    mapName: note?.mapName ?? "",
    side: note?.side ?? "",
    grenadeType: note?.grenadeType ?? "",
    startPosition: note?.startPosition ?? "",
    targetPosition: note?.targetPosition ?? "",
    throwType: note?.throwType ?? formatThrowMethod(DEFAULT_THROW_METHOD),
    description: note?.description ?? "",
  };
}

const fieldLabels: Record<RequiredField, string> = {
  title: "标题",
  mapName: "地图",
  side: "阵营",
  grenadeType: "道具类型",
};

export function NoteEditor({ mode, note, maps, capturedImagePaths = [], availableTags, onTagsChange, screenshotShortcut, isSaving, error, onSave, onClose }: NoteEditorProps) {
  const [form, setForm] = useState<FormState>(() => createInitialState(note));
  const [images, setImages] = useState<EditorImage[]>(() => createInitialImages(note, capturedImagePaths));
  const [tags, setTags] = useState<string[]>(() => note?.tags.map((tag) => tag.name) ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const commonTags = availableTags.filter((tag) => tag.favoriteOrder !== null).map((tag) => tag.name);
  const [isUpdatingTags, setIsUpdatingTags] = useState(false);
  const tagBusyRef = useRef(false);
  const [isEditingCommonTags, setIsEditingCommonTags] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RequiredField, string>>>({});
  const [imageError, setImageError] = useState<string | null>(null);
  const [isPickingImages, setIsPickingImages] = useState(false);
  const [isImportingClipboard, setIsImportingClipboard] = useState(false);
  const importBusyRef = useRef(false);
  const mountedRef = useRef(false);
  const clipboardPathsRef = useRef(new Set<string>());
  const titleRef = useRef<HTMLInputElement>(null);
  const imageListEndRef = useRef<HTMLDivElement>(null);
  const pendingImageId = useRef(0);
  const seenCapturedPaths = useRef(new Set(capturedImagePaths));
  const tagSuggestions = useMemo(() => {
    const selected = new Set(tags.map((tag) => tag.toLocaleLowerCase("zh-CN")));
    return commonTags.filter((tag) => !selected.has(tag.toLocaleLowerCase("zh-CN")));
  }, [commonTags, tags]);

  const reusableTags = useMemo(() => {
    const query = cleanTag(tagDraft).toLocaleLowerCase("zh-CN");
    const selected = new Set(tags.map((tag) => tag.toLocaleLowerCase("zh-CN")));
    return availableTags.filter((tag) => !selected.has(tag.name.toLocaleLowerCase("zh-CN"))
      && (query ? tag.name.toLocaleLowerCase("zh-CN").includes(query) : tag.favoriteOrder === null));
  }, [availableTags, tags, tagDraft]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const paths = [...clipboardPathsRef.current];
      clipboardPathsRef.current.clear();
      if (paths.length > 0) void screenshotApi.discardTempImages(paths).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving && !tagBusyRef.current) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSaving, onClose]);

  useEffect(() => {
    const additions = capturedImagePaths.filter((path) => !seenCapturedPaths.current.has(path));
    if (additions.length === 0) return;
    additions.forEach((path) => seenCapturedPaths.current.add(path));
    setImages((current) => [
      ...current,
      ...additions.map((path, index) => ({
        key: `capture-${Date.now()}-${pendingImageId.current++}`,
        sourcePath: path,
        displayName: `截图 ${current.length + index + 1}`,
        previewPath: path,
        imageType: suggestedCaptureType(current.length + index),
      })),
    ]);
    const scrollTimer = window.setTimeout(() => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLInputElement
        || activeElement instanceof HTMLTextAreaElement
        || activeElement instanceof HTMLSelectElement
        || (activeElement instanceof HTMLElement && activeElement.isContentEditable)) return;
      imageListEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 0);
    return () => window.clearTimeout(scrollTimer);
  }, [capturedImagePaths]);

  const setField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (field in fieldLabels) {
      setFieldErrors((current) => ({ ...current, [field]: undefined }));
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving || isPickingImages || importBusyRef.current || tagBusyRef.current) return;
    const nextErrors: Partial<Record<RequiredField, string>> = {};
    (Object.keys(fieldLabels) as RequiredField[]).forEach((field) => {
      if (!form[field].trim()) nextErrors[field] = `请选择或填写${fieldLabels[field]}`;
    });

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const draft = cleanTag(tagDraft);
    if (draft.length > MAX_TAG_LENGTH) {
      setTagError(`每个标签最多 ${MAX_TAG_LENGTH} 个字符`);
      return;
    }
    const submittedTags = draft ? withTag(tags, draft) : tags;
    if (submittedTags.length > MAX_TAGS) {
      setTagError(`每条笔记最多添加 ${MAX_TAGS} 个标签`);
      return;
    }

    const input: NoteInput = {
      title: form.title.trim(),
      mapName: form.mapName as MapName,
      side: form.side as Side,
      grenadeType: form.grenadeType as GrenadeType,
      startPosition: form.startPosition.trim(),
      targetPosition: form.targetPosition.trim(),
      throwType: form.throwType,
      description: form.description.replace(/\r\n?/g, "\n"),
      tags: submittedTags,
    };
    const imageItems: NoteImageInput[] = images.map((image) => (
      image.existingId !== undefined
        ? { existingId: image.existingId, imageType: image.imageType, displayName: image.displayName.trim() }
        : { sourcePath: image.sourcePath, imageType: image.imageType, displayName: image.displayName.trim() }
    ));
    onSave(input, imageItems);
  };

  const addTag = (value: string) => {
    const tag = cleanTag(value);
    if (!tag) {
      setTagDraft("");
      return;
    }
    if (tag.length > MAX_TAG_LENGTH) {
      setTagError(`每个标签最多 ${MAX_TAG_LENGTH} 个字符`);
      return;
    }
    const nextTags = withTag(tags, tag);
    if (nextTags.length > MAX_TAGS) {
      setTagError(`每条笔记最多添加 ${MAX_TAGS} 个标签`);
      return;
    }
    setTags(nextTags);
    setTagDraft("");
    setTagError(null);
  };

  const removeTag = (tagToRemove: string) => {
    setTags((current) => current.filter((tag) => tag !== tagToRemove));
    setTagError(null);
  };

  const handleTagKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" || event.key === "," || event.key === "，") {
      event.preventDefault();
      addTag(tagDraft);
    } else if (event.key === "Backspace" && !tagDraft && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  const handleAddImages = async () => {
    setIsPickingImages(true);
    setImageError(null);
    try {
      const selectedPaths = await pickImageFiles();
      setImages((current) => {
        const pendingPaths = new Set(current.map((image) => image.sourcePath).filter(Boolean));
        const additions = selectedPaths
          .filter((path) => !pendingPaths.has(path))
          .map((path) => ({
            key: `pending-${Date.now()}-${pendingImageId.current++}`,
            sourcePath: path,
            displayName: fileName(path).replace(/\.[^.]+$/, "").slice(0, 80),
            previewPath: path,
            imageType: "其他" as ImageType,
          }));
        return [...current, ...additions];
      });
    } catch (pickerError) {
      setImageError(pickerError instanceof Error ? pickerError.message : "无法打开图片选择器");
    } finally {
      setIsPickingImages(false);
    }
  };

  const handleImportClipboard = async () => {
    if (isSaving || isPickingImages || importBusyRef.current || tagBusyRef.current) return;
    importBusyRef.current = true;
    setIsImportingClipboard(true);
    setImageError(null);
    try {
      const imported = await importClipboardImage();
      if (!mountedRef.current) {
        await screenshotApi.discardTempImages([imported.path]);
        return;
      }
      clipboardPathsRef.current.add(imported.path);
      setImages((current) => [...current, {
        key: `clipboard-${pendingImageId.current++}`,
        sourcePath: imported.path,
        previewPath: imported.path,
        displayName: `剪贴板图片 ${current.length + 1}`,
        imageType: suggestedCaptureType(current.length),
      }]);
    } catch (clipboardError) {
      if (mountedRef.current) setImageError(clipboardError instanceof Error ? clipboardError.message : "无法读取剪贴板图片");
    } finally {
      importBusyRef.current = false;
      if (mountedRef.current) setIsImportingClipboard(false);
    }
  };

  const handleImagePaste = (event: ClipboardEvent<HTMLElement>) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    void handleImportClipboard();
  };

  const moveImage = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= images.length) return;
    setImages((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeImage = (key: string) => {
    setImages((current) => current.filter((image) => image.key !== key));
  };

  const setImageType = (key: string, imageType: ImageType) => {
    setImages((current) => current.map((image) => (
      image.key === key ? { ...image, imageType } : image
    )));
  };

  return (
    <div
      className="editor-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving && !tagBusyRef.current) onClose();
      }}
    >
      <section className="note-editor" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <header className="editor-header">
          <div>
            <span className="eyebrow">{mode === "create" ? "新建笔记" : "编辑笔记"}</span>
            <h2 id="editor-title">{mode === "create" ? "新建笔记" : "编辑笔记"}</h2>
            <p>{mode === "create" ? "记录一个新的 CS2 道具瞄点" : "修改当前笔记的基础信息"}</p>
          </div>
          <button type="button" className="editor-close" onClick={onClose} disabled={isSaving || isUpdatingTags} aria-label="关闭编辑器"><CloseIcon /></button>
        </header>

        <form className="editor-form" onSubmit={handleSubmit} noValidate>
          <div className="editor-scroll">
            <section className="form-section">
              <div className="form-section-title"><span>01</span><strong>基本信息</strong><small>* 为必填项</small></div>
              <label className={fieldErrors.title ? "form-field has-error" : "form-field"}>
                <span>标题 <b>*</b></span>
                <input
                  ref={titleRef}
                  value={form.title}
                  onChange={(event) => setField("title", event.target.value)}
                  placeholder="例如：A1 台阶封 CT 烟"
                  maxLength={120}
                  disabled={isSaving}
                />
                {fieldErrors.title && <small className="field-error">{fieldErrors.title}</small>}
              </label>

              <div className="form-grid three-columns">
                <label className={fieldErrors.mapName ? "form-field has-error" : "form-field"}>
                  <span>地图 <b>*</b></span>
                  <select value={form.mapName} onChange={(event) => setField("mapName", event.target.value as MapName | "")} disabled={isSaving}>
                    <option value="">选择地图</option>
                    {maps.map((map) => <option key={map} value={map}>{map}</option>)}
                  </select>
                  {fieldErrors.mapName && <small className="field-error">{fieldErrors.mapName}</small>}
                </label>

                <label className={fieldErrors.side ? "form-field has-error" : "form-field"}>
                  <span>阵营 <b>*</b></span>
                  <select value={form.side} onChange={(event) => setField("side", event.target.value as Side | "")} disabled={isSaving}>
                    <option value="">选择阵营</option>
                    {SIDES.map((side) => <option key={side} value={side}>{side}</option>)}
                  </select>
                  {fieldErrors.side && <small className="field-error">{fieldErrors.side}</small>}
                </label>

                <label className={fieldErrors.grenadeType ? "form-field has-error" : "form-field"}>
                  <span>道具类型 <b>*</b></span>
                  <select value={form.grenadeType} onChange={(event) => setField("grenadeType", event.target.value as GrenadeType | "")} disabled={isSaving}>
                    <option value="">选择道具</option>
                    {GRENADE_TYPES.map((type) => <option key={type} value={type}>{GRENADE_TYPE_LABELS[type]}</option>)}
                  </select>
                  {fieldErrors.grenadeType && <small className="field-error">{fieldErrors.grenadeType}</small>}
                </label>
              </div>
            </section>

            <section className="form-section">
              <div className="form-section-title"><span>02</span><strong>投掷信息</strong><small>选填</small></div>
              <div className="form-grid two-columns">
                <label className="form-field">
                  <span>起点</span>
                  <input value={form.startPosition} onChange={(event) => setField("startPosition", event.target.value)} placeholder="从哪里开始" maxLength={120} disabled={isSaving} />
                </label>
                <label className="form-field">
                  <span>落点</span>
                  <input value={form.targetPosition} onChange={(event) => setField("targetPosition", event.target.value)} placeholder="道具落在哪里" maxLength={120} disabled={isSaving} />
                </label>
              </div>

              <ThrowMethodPicker value={form.throwType} disabled={isSaving} onChange={(value) => setField("throwType", value)} />
            </section>

            <section className="form-section">
              <div className="form-section-title"><span>03</span><strong>备注说明</strong><small>选填</small></div>
              <label className="form-field">
                <span>描述</span>
                <textarea
                  value={form.description}
                  onChange={(event) => setField("description", event.target.value)}
                  placeholder="记录站位细节、瞄准参照物、投掷时机等…"
                  rows={6}
                  maxLength={3000}
                  disabled={isSaving}
                />
                <small className="character-count">{form.description.length} / 3000</small>
              </label>
            </section>

            <section className="form-section">
              <div className="form-section-title"><span>04</span><strong>标签</strong><small>{tags.length} / {MAX_TAGS}</small></div>
              <div className="tag-editor">
                <div className="tag-input-shell">
                  {tags.map((tag) => (
                    <span className="tag-chip" key={tag}>
                      #{tag}
                      <button type="button" onClick={() => removeTag(tag)} disabled={isSaving} aria-label={`删除标签 ${tag}`}><CloseIcon /></button>
                    </span>
                  ))}
                  <input
                    value={tagDraft}
                    onChange={(event) => {
                      setTagDraft(event.target.value);
                      setTagError(null);
                    }}
                    onKeyDown={handleTagKeyDown}
                    placeholder="搜索已有标签，或输入新标签后按 Enter"
                    maxLength={MAX_TAG_LENGTH + 1}
                    disabled={isSaving}
                    aria-label="添加标签"
                  />
                </div>
                {tagError && <small className="tag-error">{tagError}</small>}
                <div className="tag-suggestions">
                  <span>常用标签</span>
                  {tagSuggestions.map((tag) => (
                    <button type="button" key={tag} onClick={() => addTag(tag)} disabled={isSaving}>+ {tag}</button>
                  ))}
                  {tagSuggestions.length === 0 && <small>暂无可添加的常用标签</small>}
                  <button type="button" className="common-tags-edit-button" disabled={isSaving || isUpdatingTags}
                    onClick={() => setIsEditingCommonTags((current) => !current)}>{isEditingCommonTags ? "完成管理" : "管理标签库"}</button>
                </div>
                <div className="tag-suggestions reusable-tags">
                  <span>{cleanTag(tagDraft) ? "匹配标签" : "已有标签"}</span>
                  {reusableTags.slice(0, 12).map((tag) => <button type="button" key={tag.id} disabled={isSaving} onClick={() => addTag(tag.name)}>+ {tag.name}</button>)}
                  {reusableTags.length > 12 && <small>还有 {reusableTags.length - 12} 个，输入名称继续搜索</small>}
                  {reusableTags.length === 0 && <small>{cleanTag(tagDraft) ? "没有匹配项，按 Enter 创建新标签" : "保存过的标签会显示在这里"}</small>}
                </div>
                {isEditingCommonTags && <TagLibrary tags={availableTags} disabled={isSaving} onChange={onTagsChange} onBusyChange={(busy) => { tagBusyRef.current = busy; setIsUpdatingTags(busy); }} />}
              </div>
            </section>

            <section className="form-section image-form-section" tabIndex={0} onPaste={handleImagePaste} aria-label="笔记图片，可按 Ctrl+V 添加剪贴板图片">
              <div className="form-section-title"><span>05</span><strong>图片</strong><small>{images.length} 张</small></div>
              <div className="continuous-capture-tip">
                {screenshotShortcut ? screenshotShortcut.split("+").map((key, index) => (
                  <span className="shortcut-key-group" key={`${key}-${index}`}>
                    {index > 0 && <i>+</i>}<span className="shortcut-key">{key}</span>
                  </span>
                )) : <span className="shortcut-unbound">未绑定</span>}
                <p>{screenshotShortcut ? "编辑期间可连续截图，新图片会自动追加到当前笔记" : "可在设置中绑定截图快捷键"}</p>
              </div>
              <div className="image-import-actions">
                <button
                  type="button"
                  className="add-images-button"
                  onClick={() => void handleAddImages()}
                  disabled={isSaving || isPickingImages || isImportingClipboard}
                >
                  <PlusIcon />
                  <span>{isPickingImages ? "正在打开选择器…" : "添加图片"}</span>
                  <small>PNG / JPG / JPEG / WEBP，可多选</small>
                </button>
                <button type="button" className="add-images-button" onClick={() => void handleImportClipboard()} disabled={isSaving || isPickingImages || isImportingClipboard}>
                  <ImageIcon />
                  <span>{isImportingClipboard ? "正在读取剪贴板…" : "从剪贴板添加"}</span>
                  <small>微信 / QQ 截图后复制，在此按 Ctrl+V</small>
                </button>
              </div>

              {imageError && <div className="form-submit-error" role="alert">{imageError}</div>}

              {images.length > 0 && (
                <div className="editor-image-list">
                  {images.map((image, index) => (
                    <div className="editor-image-item" key={image.key}>
                      <div className="editor-image-thumb">
                        {image.previewPath ? (
                          <img src={convertFileSrc(image.previewPath)} alt="" />
                        ) : <ImageIcon />}
                      </div>
                      <div className="editor-image-info">
                        <input className="image-name-input" aria-label={`图片 ${index + 1} 名称`} placeholder={`图片 ${index + 1} · ${image.imageType}`} maxLength={80}
                          value={image.displayName} disabled={isSaving} onChange={(event) => {
                            const displayName = event.target.value;
                            setImages((current) => current.map((item) => item.key === image.key ? { ...item, displayName } : item));
                          }} />
                        <select
                          className="image-type-select"
                          value={image.imageType}
                          onChange={(event) => setImageType(image.key, event.target.value as ImageType)}
                          disabled={isSaving}
                          aria-label={`图片 ${index + 1} 类型`}
                        >
                          {IMAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                        </select>
                        <span>{image.existingId !== undefined ? "已保存" : "保存笔记后复制到应用目录"}</span>
                      </div>
                      <div className="editor-image-actions">
                        <button type="button" onClick={() => moveImage(index, -1)} disabled={index === 0 || isSaving} aria-label="上移图片">↑</button>
                        <button type="button" onClick={() => moveImage(index, 1)} disabled={index === images.length - 1 || isSaving} aria-label="下移图片">↓</button>
                        <button type="button" className="remove-image" onClick={() => removeImage(image.key)} disabled={isSaving} aria-label="删除图片"><TrashIcon /></button>
                      </div>
                    </div>
                  ))}
                  <div ref={imageListEndRef} />
                </div>
              )}
            </section>

            {error && <div className="form-submit-error" role="alert">{error}</div>}
          </div>

          <footer className="editor-footer">
            <span>{mode === "edit" ? "保存后详情会立即更新" : "保存后将自动选中新笔记"}</span>
            <div>
              <button type="button" className="secondary-button" onClick={onClose} disabled={isSaving || isPickingImages || isUpdatingTags}>取消</button>
              <button type="submit" className="primary-button editor-save" disabled={isSaving || isPickingImages || isImportingClipboard || isUpdatingTags}>
                {isSaving && <span className="button-spinner" />}
                {isSaving ? "正在保存" : "保存笔记"}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
