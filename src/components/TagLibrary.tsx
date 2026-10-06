import { useRef, useState } from "react";
import { notesApi } from "../services/notes";
import type { Tag } from "../types/note";
import { cleanTag, MAX_TAG_LENGTH } from "../types/tags";

interface TagLibraryProps {
  tags: Tag[];
  disabled: boolean;
  onChange: (tags: Tag[]) => void;
  onBusyChange: (busy: boolean) => void;
}

export function TagLibrary({ tags, disabled, onChange, onBusyChange }: TagLibraryProps) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const visible = tags.filter((tag) => tag.name.toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN")));

  const mutate = async (action: () => Promise<Tag[]>, clearDraft = false) => {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      onChange(await action());
      if (clearDraft) setDraft("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存标签库，请重试");
    } finally {
      busyRef.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };

  const addCommon = () => {
    const name = cleanTag(draft);
    if (!name) return;
    if (name.length > MAX_TAG_LENGTH) {
      setError(`每个标签最多 ${MAX_TAG_LENGTH} 个字符`);
      return;
    }
    void mutate(() => notesApi.setTagFavorite(name, true), true);
  };

  return (
    <div className="tag-library-manager">
      <p>常用设置立即保存。普通新标签在保存笔记后进入标签库；取消常用仍可复用。已被笔记使用的标签需先从笔记移除后才能删除。</p>
      <input aria-label="搜索标签库" placeholder="搜索标签库…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="tag-library-list">
        {visible.map((tag) => (
          <div className="tag-library-row" key={tag.id}>
            <span title={tag.name}>#{tag.name}<small>{tag.usageCount} 条笔记</small></span>
            <button type="button" disabled={disabled || busy} onClick={() => void mutate(() => notesApi.setTagFavorite(tag.name, tag.favoriteOrder === null))}>
              {tag.favoriteOrder === null ? "设为常用" : "取消常用"}
            </button>
            <button type="button" disabled={disabled || busy || tag.usageCount > 0} onClick={() => void mutate(() => notesApi.deleteUnusedTag(tag.id))} aria-label={`从标签库删除 ${tag.name}`}>删除</button>
          </div>
        ))}
        {visible.length === 0 && <small>没有匹配的标签</small>}
      </div>
      <div className="common-tag-add-row">
        <input aria-label="添加常用标签" placeholder="输入新标签或已有标签名称" value={draft} maxLength={MAX_TAG_LENGTH + 1} disabled={disabled || busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              addCommon();
            }
          }} />
        <button type="button" disabled={disabled || busy || !cleanTag(draft)} onClick={addCommon}>{busy ? "保存中…" : "添加到常用"}</button>
      </div>
      {error && <small className="tag-error" role="alert">{error}</small>}
    </div>
  );
}
