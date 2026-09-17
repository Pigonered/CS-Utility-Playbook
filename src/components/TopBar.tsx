import { BookIcon, PlusIcon, SettingsIcon } from "./icons";
import { SearchBar } from "./SearchBar";

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onCreateNote: () => void;
  onOpenSettings: () => void;
}

export function TopBar({ searchQuery, onSearchChange, onCreateNote, onOpenSettings }: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="brand">
        <span className="brand-mark"><BookIcon /></span>
        <div>
          <strong>CS 瞄点笔记本</strong>
          <span>道具瞄点记录</span>
        </div>
      </div>
      <SearchBar value={searchQuery} onChange={onSearchChange} />
      <div className="top-actions">
        <button className="primary-button" type="button" onClick={onCreateNote}>
          <PlusIcon />
          新建笔记
        </button>
        <button className="icon-button settings-button" type="button" onClick={onOpenSettings} aria-label="打开设置" title="设置">
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}
