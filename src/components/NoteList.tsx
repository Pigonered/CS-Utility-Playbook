import type { Note } from "../types/note";
import { NoteListItem } from "./NoteListItem";

interface NoteListProps {
  notes: Note[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  hasActiveSearch: boolean;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function NoteList({ notes, selectedId, onSelect, hasActiveSearch, isLoading, error, onRetry }: NoteListProps) {
  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="list-status">
          <span className="spinner" />
          <strong>正在读取笔记</strong>
          <p>正在连接本地数据库…</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="list-status error-state">
          <strong>无法读取笔记</strong>
          <p>{error}</p>
          <button type="button" className="secondary-button" onClick={onRetry}>重试</button>
        </div>
      );
    }

    if (notes.length === 0) {
      return (
        <div className="empty-list">
          <span>{hasActiveSearch ? "没有找到笔记" : "还没有笔记"}</span>
          <p>{hasActiveSearch ? "试试调整搜索内容或清除筛选条件。" : "点击「新建笔记」开始记录你的第一个瞄点"}</p>
        </div>
      );
    }

    return notes.map((note) => (
      <NoteListItem
        key={note.id}
        note={note}
        selected={selectedId === note.id}
        onSelect={() => onSelect(note.id)}
      />
    ));
  };

  return (
    <section className="note-list-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">笔记列表</span>
          <strong>{notes.length} 条笔记</strong>
        </div>
        <select aria-label="排序方式" defaultValue="updated">
          <option value="updated">最近更新</option>
          <option value="map">按地图</option>
          <option value="title">按标题</option>
        </select>
      </div>
      <div className="note-list">
        {renderContent()}
      </div>
    </section>
  );
}
