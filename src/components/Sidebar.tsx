import { GRENADE_TYPES, MAPS, SIDES, type GrenadeType, type MapName, type NoteFilters, type Side, type Tag } from "../types/note";
import { CrosshairIcon, GrenadeIcon, MapIcon, ShieldIcon } from "./icons";

interface SidebarProps {
  filters: NoteFilters;
  tags: Tag[];
  onChange: (filters: NoteFilters) => void;
}

interface FilterSectionProps<T extends string> {
  title: string;
  icon: React.ReactNode;
  items: readonly T[];
  value: T | null;
  onSelect: (value: T | null) => void;
  renderBadge?: (item: T) => React.ReactNode;
}

function FilterSection<T extends string>({ title, icon, items, value, onSelect, renderBadge }: FilterSectionProps<T>) {
  return (
    <section className="filter-section">
      <div className="section-title">{icon}<span>{title}</span></div>
      <div className="filter-options">
        {items.map((item) => (
          <button
            key={item}
            type="button"
            className={value === item ? "filter-button active" : "filter-button"}
            onClick={() => onSelect(value === item ? null : item)}
            aria-pressed={value === item}
          >
            <span>{item}</span>
            {renderBadge?.(item)}
          </button>
        ))}
      </div>
    </section>
  );
}

const grenadeClass: Record<GrenadeType, string> = {
  Smoke: "smoke",
  Flash: "flash",
  Molotov: "molotov",
  HE: "he",
  Other: "other",
};

export function Sidebar({ filters, tags, onChange }: SidebarProps) {
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <div><CrosshairIcon /><span>筛选笔记</span></div>
        {hasFilters && <button type="button" onClick={() => onChange({ mapName: null, side: null, grenadeType: null, tagName: null })}>清除筛选</button>}
      </div>
      <FilterSection<MapName>
        title="地图"
        icon={<MapIcon />}
        items={MAPS}
        value={filters.mapName}
        onSelect={(mapName) => onChange({ ...filters, mapName })}
      />
      <FilterSection<Side>
        title="阵营"
        icon={<ShieldIcon />}
        items={SIDES}
        value={filters.side}
        onSelect={(side) => onChange({ ...filters, side })}
        renderBadge={(side) => <span className={`side-dot ${side.toLowerCase()}`} />}
      />
      <FilterSection<GrenadeType>
        title="道具类型"
        icon={<GrenadeIcon />}
        items={GRENADE_TYPES}
        value={filters.grenadeType}
        onSelect={(grenadeType) => onChange({ ...filters, grenadeType })}
        renderBadge={(type) => <span className={`grenade-dot ${grenadeClass[type]}`} />}
      />
      {tags.length > 0 && (
        <FilterSection<string>
          title="标签"
          icon={<span className="hash-icon">#</span>}
          items={tags.map((tag) => tag.name)}
          value={filters.tagName}
          onSelect={(tagName) => onChange({ ...filters, tagName })}
        />
      )}
      <div className="sidebar-footer">
        <span className="shortcut-key">Alt</span><span>+</span><span className="shortcut-key">Q</span>
        <small>全局快速截图</small>
      </div>
    </aside>
  );
}
