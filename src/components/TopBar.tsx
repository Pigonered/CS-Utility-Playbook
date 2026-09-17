import { InfoIcon, PlusIcon, SettingsIcon } from "./icons";
import { SearchBar } from "./SearchBar";

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onCreateNote: () => void;
  onOpenAbout: () => void;
  onOpenSettings: () => void;
}

export function TopBar({ searchQuery, onSearchChange, onCreateNote, onOpenAbout, onOpenSettings }: TopBarProps) {
  return (
    <header className="top-bar">
      <SearchBar value={searchQuery} onChange={onSearchChange} />
      <div className="top-actions">
        <button className="primary-button" type="button" onClick={onCreateNote}>
          <PlusIcon />
          新建笔记
        </button>
        <button className="secondary-button about-button" type="button" onClick={onOpenAbout} aria-label="打开关于页面" title="关于">
          <InfoIcon />
          关于
        </button>
        <button className="icon-button settings-button" type="button" onClick={onOpenSettings} aria-label="打开设置" title="设置">
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}
