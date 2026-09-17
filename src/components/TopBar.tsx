import { BookIcon, DatabaseIcon, PlusIcon } from "./icons";
import { SearchBar } from "./SearchBar";

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onCreateNote: () => void;
  onOpenBackup: () => void;
}

export function TopBar({ searchQuery, onSearchChange, onCreateNote, onOpenBackup }: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="brand">
        <span className="brand-mark"><BookIcon /></span>
        <div>
          <strong>CS 瞄点笔记本</strong>
          <span>LINEUP NOTEBOOK</span>
        </div>
      </div>
      <SearchBar value={searchQuery} onChange={onSearchChange} />
      <div className="top-actions">
        <button className="secondary-button data-safety-button" type="button" onClick={onOpenBackup}>
          <DatabaseIcon />
          数据安全
        </button>
        <button className="primary-button" type="button" onClick={onCreateNote}>
          <PlusIcon />
          新建笔记
        </button>
      </div>
    </header>
  );
}
