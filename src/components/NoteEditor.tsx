import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { pickImageFiles } from "../services/images";
import {
  GRENADE_TYPES,
  IMAGE_TYPES,
  MAPS,
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
import { ImageIcon, PlusIcon, TrashIcon } from "./icons";

const THROW_TYPES = ["左键", "右键", "左右键", "Jump Throw", "Run Throw", "Walk Throw"] as const;
const DEFAULT_COMMON_TAGS = ["默认道具", "进攻", "防守", "残局", "必学"] as const;
const COMMON_TAGS_STORAGE_KEY = "cs-notes.common-tags";
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 24;
const MAX_COMMON_TAGS = 20;

type RequiredField = "title" | "mapName" | "side" | "grenadeType";

interface FormState {
  title: string;
  mapName: MapName | "";
  side: Side | "";
  grenadeType: GrenadeType | "";
  startPosition: string;
  targetPosition: string;
  throwPreset: string;
  customThrowType: string;
  description: string;
}

interface NoteEditorProps {
  mode: "create" | "edit";
  note: Note | null;
  capturedImagePaths?: string[];
  availableTags: Tag[];
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

function cleanTag(value: string): string {
  return value.trim().replace(/^#+/, "").trim();
}

function normalizeTags(values: unknown[]): string[] {
  const unique = new Set<string>();
  const normalized: string[] = [];
  values.forEach((value) => {
    if (typeof value !== "string") return;
    const tag = cleanTag(value);
    const key = tag.toLocaleLowerCase("zh-CN");
    if (!tag || tag.length > MAX_TAG_LENGTH || unique.has(key)) return;
    unique.add(key);
    normalized.push(tag);
  });
  return normalized.slice(0, MAX_COMMON_TAGS);
}

function loadCommonTags(): string[] {
  try {
    const saved = window.localStorage.getItem(COMMON_TAGS_STORAGE_KEY);
    if (saved === null) return [...DEFAULT_COMMON_TAGS];
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed) ? normalizeTags(parsed) : [...DEFAULT_COMMON_TAGS];
  } catch {
    return [...DEFAULT_COMMON_TAGS];
  }
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
    displayName: fileName(image.imagePath),
    previewPath: image.annotatedPath ?? image.imagePath,
    imageType: image.imageType,
  })) ?? [];
  const pendingImages = capturedImagePaths.map((path, index) => ({
    key: `capture-${index}-${path}`,
    sourcePath: path,
    displayName: fileName(path),
    previewPath: path,
    imageType: suggestedCaptureType(existingImages.length + index),
  }));
  return [...existingImages, ...pendingImages];
}

function createInitialState(note: Note | null): FormState {
  const knownThrowType = note && THROW_TYPES.some((type) => type === note.throwType);
  return {
    title: note?.title ?? "",
    mapName: note?.mapName ?? "",
    side: note?.side ?? "",
    grenadeType: note?.grenadeType ?? "",
    startPosition: note?.startPosition ?? "",
    targetPosition: note?.targetPosition ?? "",
    throwPreset: knownThrowType ? note.throwType : note?.throwType ? "custom" : "",
    customThrowType: knownThrowType ? "" : note?.throwType ?? "",
    description: note?.description ?? "",
  };
}

const fieldLabels: Record<RequiredField, string> = {
  title: "标题",
  mapName: "地图",
  side: "阵营",
  grenadeType: "道具类型",
};

export function NoteEditor({ mode, note, capturedImagePaths = [], availableTags, isSaving, error, onSave, onClose }: NoteEditorProps) {
  const [form, setForm] = useState<FormState>(() => createInitialState(note));
  const [images, setImages] = useState<EditorImage[]>(() => createInitialImages(note, capturedImagePaths));
  const [tags, setTags] = useState<string[]>(() => note?.tags.map((tag) => tag.name) ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const [commonTags, setCommonTags] = useState<string[]>(loadCommonTags);
  const [isEditingCommonTags, setIsEditingCommonTags] = useState(false);
  const [commonTagDraft, setCommonTagDraft] = useState("");
  const [commonTagError, setCommonTagError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RequiredField, string>>>({});
  const [imageError, setImageError] = useState<string | null>(null);
  const [isPickingImages, setIsPickingImages] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const imageListEndRef = useRef<HTMLDivElement>(null);
  const pendingImageId = useRef(0);
  const seenCapturedPaths = useRef(new Set(capturedImagePaths));
  const tagSuggestions = useMemo(() => {
    const selected = new Set(tags.map((tag) => tag.toLocaleLowerCase("zh-CN")));
    return commonTags.filter((tag) => !selected.has(tag.toLocaleLowerCase("zh-CN")));
  }, [commonTags, tags]);

  const availableCommonTagOptions = useMemo(() => {
    const common = new Set(commonTags.map((tag) => tag.toLocaleLowerCase("zh-CN")));
    return availableTags
      .map((tag) => tag.name)
      .filter((tag) => !common.has(tag.toLocaleLowerCase("zh-CN")));
  }, [availableTags, commonTags]);

  useEffect(() => {
    try {
      window.localStorage.setItem(COMMON_TAGS_STORAGE_KEY, JSON.stringify(commonTags));
    } catch {
      // 存储不可用时仍保留当前编辑会话中的设置。
    }
  }, [commonTags]);

  useEffect(() => {
    titleRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) onClose();
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
        displayName: fileName(path),
        previewPath: path,
        imageType: suggestedCaptureType(current.length + index),
      })),
    ]);
    window.setTimeout(() => {
      imageListEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 0);
  }, [capturedImagePaths]);

  const setField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (field in fieldLabels) {
      setFieldErrors((current) => ({ ...current, [field]: undefined }));
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    const submittedTags = draft && !tags.some((tag) => tag.toLocaleLowerCase("zh-CN") === draft.toLocaleLowerCase("zh-CN"))
      ? [...tags, draft]
      : tags;
    if (submittedTags.length > MAX_TAGS) {
      setTagError(`每条笔记最多添加 ${MAX_TAGS} 个标签`);
      return;
    }

    const throwType = form.throwPreset === "custom" ? form.customThrowType.trim() : form.throwPreset;
    const input: NoteInput = {
      title: form.title.trim(),
      mapName: form.mapName as MapName,
      side: form.side as Side,
      grenadeType: form.grenadeType as GrenadeType,
      startPosition: form.startPosition.trim(),
      targetPosition: form.targetPosition.trim(),
      throwType,
      description: form.description.trim(),
      tags: submittedTags,
    };
    const imageItems: NoteImageInput[] = images.map((image) => (
      image.existingId !== undefined
        ? { existingId: image.existingId, imageType: image.imageType }
        : { sourcePath: image.sourcePath, imageType: image.imageType }
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
    if (tags.length >= MAX_TAGS) {
      setTagError(`每条笔记最多添加 ${MAX_TAGS} 个标签`);
      return;
    }
    if (!tags.some((current) => current.toLocaleLowerCase("zh-CN") === tag.toLocaleLowerCase("zh-CN"))) {
      setTags((current) => [...current, tag]);
    }
    setTagDraft("");
    setTagError(null);
  };

  const removeTag = (tagToRemove: string) => {
    setTags((current) => current.filter((tag) => tag !== tagToRemove));
    setTagError(null);
  };

  const handleTagKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "," || event.key === "，") {
      event.preventDefault();
      addTag(tagDraft);
    } else if (event.key === "Backspace" && !tagDraft && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  const addCommonTag = () => {
    const tag = cleanTag(commonTagDraft);
    if (!tag) return;
    if (tag.length > MAX_TAG_LENGTH) {
      setCommonTagError(`每个标签最多 ${MAX_TAG_LENGTH} 个字符`);
      return;
    }
    if (commonTags.length >= MAX_COMMON_TAGS) {
      setCommonTagError(`常用标签最多设置 ${MAX_COMMON_TAGS} 个`);
      return;
    }
    if (commonTags.some((current) => current.toLocaleLowerCase("zh-CN") === tag.toLocaleLowerCase("zh-CN"))) {
      setCommonTagError("该标签已在常用标签中");
      return;
    }
    setCommonTags((current) => [...current, tag]);
    setCommonTagDraft("");
    setCommonTagError(null);
  };

  const removeCommonTag = (tagToRemove: string) => {
    setCommonTags((current) => current.filter((tag) => tag !== tagToRemove));
    setCommonTagError(null);
  };

  const handleCommonTagKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "," || event.key === "，") {
      event.preventDefault();
      addCommonTag();
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
            displayName: fileName(path),
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
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <section className="note-editor" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <header className="editor-header">
          <div>
            <span className="eyebrow">{mode === "create" ? "CREATE NOTE" : "EDIT NOTE"}</span>
            <h2 id="editor-title">{mode === "create" ? "新建笔记" : "编辑笔记"}</h2>
            <p>{mode === "create" ? "记录一个新的 CS2 道具瞄点" : "修改当前笔记的基础信息"}</p>
          </div>
          <button type="button" className="editor-close" onClick={onClose} disabled={isSaving} aria-label="关闭编辑器">×</button>
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
                    {MAPS.map((map) => <option key={map} value={map}>{map}</option>)}
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
                    {GRENADE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
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

              <div className={form.throwPreset === "custom" ? "form-grid two-columns" : "form-grid"}>
                <label className="form-field">
                  <span>投掷方式</span>
                  <select value={form.throwPreset} onChange={(event) => setField("throwPreset", event.target.value)} disabled={isSaving}>
                    <option value="">未设置</option>
                    {THROW_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    <option value="custom">自定义…</option>
                  </select>
                </label>
                {form.throwPreset === "custom" && (
                  <label className="form-field">
                    <span>自定义方式</span>
                    <input value={form.customThrowType} onChange={(event) => setField("customThrowType", event.target.value)} placeholder="输入投掷方式" maxLength={80} disabled={isSaving} />
                  </label>
                )}
              </div>
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
                      <button type="button" onClick={() => removeTag(tag)} disabled={isSaving} aria-label={`删除标签 ${tag}`}>×</button>
                    </span>
                  ))}
                  <input
                    value={tagDraft}
                    onChange={(event) => {
                      setTagDraft(event.target.value);
                      setTagError(null);
                    }}
                    onKeyDown={handleTagKeyDown}
                    onBlur={() => addTag(tagDraft)}
                    placeholder={tags.length === 0 ? "输入标签后按 Enter，例如：关键道具" : "继续添加…"}
                    maxLength={MAX_TAG_LENGTH + 1}
                    disabled={isSaving || tags.length >= MAX_TAGS}
                    aria-label="添加标签"
                  />
                </div>
                {tagError && <small className="tag-error">{tagError}</small>}
                <div className="tag-suggestions">
                  <span>常用标签</span>
                  {!isEditingCommonTags && tags.length < MAX_TAGS && tagSuggestions.map((tag) => (
                    <button type="button" key={tag} onClick={() => addTag(tag)} disabled={isSaving}>+ {tag}</button>
                  ))}
                  {!isEditingCommonTags && tagSuggestions.length === 0 && <small>暂无可添加标签</small>}
                  <button
                    type="button"
                    className="common-tags-edit-button"
                    onClick={() => {
                      setIsEditingCommonTags((current) => !current);
                      setCommonTagDraft("");
                      setCommonTagError(null);
                    }}
                    disabled={isSaving}
                  >
                    {isEditingCommonTags ? "完成" : "修改"}
                  </button>
                </div>
                {isEditingCommonTags && (
                  <div className="common-tags-manager">
                    <div className="common-tags-list">
                      {commonTags.map((tag) => (
                        <span key={tag}>
                          #{tag}
                          <button type="button" onClick={() => removeCommonTag(tag)} disabled={isSaving} aria-label={`从常用标签中删除 ${tag}`}>×</button>
                        </span>
                      ))}
                      {commonTags.length === 0 && <small>还没有常用标签</small>}
                    </div>
                    <div className="common-tag-add-row">
                      <input
                        value={commonTagDraft}
                        onChange={(event) => {
                          setCommonTagDraft(event.target.value);
                          setCommonTagError(null);
                        }}
                        onKeyDown={handleCommonTagKeyDown}
                        placeholder="输入要添加的常用标签"
                        maxLength={MAX_TAG_LENGTH + 1}
                        list="available-common-tags"
                        disabled={isSaving || commonTags.length >= MAX_COMMON_TAGS}
                        aria-label="添加常用标签"
                      />
                      <datalist id="available-common-tags">
                        {availableCommonTagOptions.map((tag) => <option value={tag} key={tag} />)}
                      </datalist>
                      <button type="button" onClick={addCommonTag} disabled={isSaving || !commonTagDraft.trim() || commonTags.length >= MAX_COMMON_TAGS}>添加</button>
                    </div>
                    {commonTagError && <small className="tag-error">{commonTagError}</small>}
                  </div>
                )}
              </div>
            </section>

            <section className="form-section image-form-section">
              <div className="form-section-title"><span>05</span><strong>图片</strong><small>{images.length} 张</small></div>
              <div className="continuous-capture-tip">
                <span className="shortcut-key">Alt</span><span>+</span><span className="shortcut-key">Q</span>
                <p>编辑期间可连续截图，新图片会自动追加到当前笔记</p>
              </div>
              <button
                type="button"
                className="add-images-button"
                onClick={() => void handleAddImages()}
                disabled={isSaving || isPickingImages}
              >
                <PlusIcon />
                <span>{isPickingImages ? "正在打开选择器…" : "添加图片"}</span>
                <small>PNG / JPG / JPEG / WEBP，可多选</small>
              </button>

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
                        <strong>{image.displayName}</strong>
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
              <button type="button" className="secondary-button" onClick={onClose} disabled={isSaving || isPickingImages}>取消</button>
              <button type="submit" className="primary-button editor-save" disabled={isSaving}>
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
