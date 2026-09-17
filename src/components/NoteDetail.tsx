import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { grenadeTypeLabel, throwTypeLabel, type Note, type NoteImage } from "../types/note";
import { CloseIcon, CrosshairIcon, ImageIcon, PencilIcon, TrashIcon } from "./icons";

interface NoteDetailProps {
  note: Note | null;
  isLoading: boolean;
  error: string | null;
  isDeleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onTagSelect: (tagName: string) => void;
  onAnnotate: (image: NoteImage) => void;
}

function DetailField({ label, value }: { label: string; value: string }) {
  return <div className="detail-field"><span>{label}</span><strong>{value || "—"}</strong></div>;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function NoteDetail({ note, isLoading, error, isDeleting, onEdit, onDelete, onTagSelect, onAnnotate }: NoteDetailProps) {
  const [viewerImage, setViewerImage] = useState<string | null>(null);

  useEffect(() => {
    setViewerImage(null);
  }, [note?.id]);

  useEffect(() => {
    if (!viewerImage) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewerImage(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewerImage]);

  if (isLoading) {
    return (
      <main className="note-detail empty-detail">
        <span className="spinner" />
        <h2>正在加载详情</h2>
      </main>
    );
  }

  if (error) {
    return (
      <main className="note-detail empty-detail detail-error">
        <CrosshairIcon />
        <h2>无法加载笔记详情</h2>
        <p>{error}</p>
      </main>
    );
  }

  if (!note) {
    return (
      <main className="note-detail empty-detail">
        <CrosshairIcon />
        <h2>还没有笔记</h2>
        <p>点击「新建笔记」开始记录你的第一个瞄点</p>
      </main>
    );
  }

  return (
    <main className="note-detail">
      <header className="detail-header">
        <div>
          <span className="breadcrumb">{note.mapName} / {note.side} / {grenadeTypeLabel(note.grenadeType)}</span>
          <h1>{note.title}</h1>
          <span className="updated-at">更新于 {formatUpdatedAt(note.updatedAt)}</span>
        </div>
        <div className="detail-actions">
          <button type="button" className="secondary-button" onClick={onEdit}><PencilIcon />编辑</button>
          <button type="button" className="icon-button danger" onClick={onDelete} disabled={isDeleting} aria-label="删除笔记"><TrashIcon /></button>
        </div>
      </header>

      <div className="detail-scroll">
        <section className="details-grid">
          <DetailField label="地图" value={note.mapName} />
          <DetailField label="阵营" value={note.side} />
          <DetailField label="道具类型" value={grenadeTypeLabel(note.grenadeType)} />
          <DetailField label="投掷方式" value={throwTypeLabel(note.throwType)} />
          <DetailField label="起点" value={note.startPosition} />
          <DetailField label="落点" value={note.targetPosition} />
        </section>

        <section className="content-section image-section">
          <div className="content-heading"><span>图片步骤</span><small>{note.images.length} 张图片</small></div>
          {note.images.length > 0 ? (
            <div className="image-gallery">
              {note.images.map((image, index) => (
                <article className="note-image-card" key={image.id}>
                  <button
                    type="button"
                    className="note-image-preview"
                    onClick={() => setViewerImage(image.annotatedPath ?? image.imagePath)}
                    title="点击查看大图"
                  >
                    <img src={convertFileSrc(image.annotatedPath ?? image.imagePath)} alt={`${note.title} ${image.imageType}图 ${index + 1}`} />
                  </button>
                  <footer>
                    <span><ImageIcon />图片 {index + 1}：{image.imageType}{image.annotatedPath && <i>已标注</i>}</span>
                    <div>
                      <button type="button" onClick={() => setViewerImage(image.annotatedPath ?? image.imagePath)}>查看</button>
                      <button type="button" className="annotate-button" onClick={() => onAnnotate(image)}>编辑图片</button>
                    </div>
                  </footer>
                </article>
              ))}
            </div>
          ) : <div className="empty-images"><ImageIcon /><span>暂未添加图片</span><small>点击「编辑」可以导入本地图片</small></div>}
        </section>

        <section className="content-section description-section">
          <div className="content-heading"><span>笔记说明</span></div>
          <p>{note.description || "暂无描述"}</p>
        </section>

        <section className="content-section tags-section">
          <div className="content-heading"><span>标签</span></div>
          <div className="tag-list">
            {note.tags.length > 0 ? note.tags.map((tag) => (
              <button type="button" key={tag.id} onClick={() => onTagSelect(tag.name)} title={`筛选标签：${tag.name}`}>
                #{tag.name}
              </button>
            )) : <small>暂无标签</small>}
          </div>
        </section>
      </div>
      {viewerImage && (
        <div className="image-viewer" role="dialog" aria-modal="true" aria-label="图片大图预览" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setViewerImage(null);
        }}>
          <button type="button" onClick={() => setViewerImage(null)} aria-label="关闭大图"><CloseIcon /></button>
          <img src={convertFileSrc(viewerImage)} alt="笔记大图预览" />
        </div>
      )}
    </main>
  );
}
