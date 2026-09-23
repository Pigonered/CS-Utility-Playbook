import { useState, type FormEvent } from "react";
import { GRENADE_TYPES, SIDES, grenadeTypeLabel, type GrenadeType, type MapName, type NoteFilters, type Side, type Tag } from "../types/note";
import { CrosshairIcon, GrenadeIcon, MapIcon, PlusIcon, ShieldIcon } from "./icons";

interface SidebarProps {
  filters: NoteFilters;
  tags: Tag[];
  maps: readonly MapName[];
  hiddenMaps: readonly MapName[];
  screenshotShortcut: string | null;
  onChange: (filters: NoteFilters) => void;
  onMapsChange: (maps: MapName[], hiddenMaps: MapName[]) => void;
}

interface FilterSectionProps<T extends string> {
  title: string;
  icon: React.ReactNode;
  items: readonly T[];
  value: T | null;
  onSelect: (value: T | null) => void;
  renderLabel?: (item: T) => React.ReactNode;
  renderBadge?: (item: T) => React.ReactNode;
}

function FilterSection<T extends string>({ title, icon, items, value, onSelect, renderLabel, renderBadge }: FilterSectionProps<T>) {
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
            <span>{renderLabel ? renderLabel(item) : item}</span>
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

function sameMap(left: string, right: string): boolean {
  return left.localeCompare(right, "en", { sensitivity: "base" }) === 0;
}

interface MapFilterProps {
  maps: readonly MapName[];
  hiddenMaps: readonly MapName[];
  value: MapName | null;
  onSelect: (value: MapName | null) => void;
  onMapsChange: (maps: MapName[], hiddenMaps: MapName[]) => void;
}

function MapFilter({ maps, hiddenMaps, value, onSelect, onMapsChange }: MapFilterProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const visibleMaps = maps.filter((map) => !hiddenMaps.some((hidden) => sameMap(hidden, map)));

  const moveMap = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= maps.length) return;
    const next = [...maps];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onMapsChange(next, [...hiddenMaps]);
  };

  const toggleMap = (map: MapName) => {
    const isHidden = hiddenMaps.some((hidden) => sameMap(hidden, map));
    const nextHidden = isHidden
      ? hiddenMaps.filter((hidden) => !sameMap(hidden, map))
      : [...hiddenMaps, map];
    if (!isHidden && value && sameMap(value, map)) onSelect(null);
    onMapsChange([...maps], nextHidden);
  };

  const addMap = (event: FormEvent) => {
    event.preventDefault();
    const name = draft.trim().replace(/\s+/g, " ");
    if (!name) {
      setError("请输入地图名称");
      return;
    }
    if (name.length > 32) {
      setError("地图名称不能超过 32 个字符");
      return;
    }
    if (maps.some((map) => sameMap(map, name))) {
      setError("该地图已经存在");
      return;
    }
    onMapsChange([...maps, name], hiddenMaps.filter((hidden) => !sameMap(hidden, name)));
    setDraft("");
    setError(null);
  };

  return (
    <section className="filter-section map-filter-section">
      <div className="section-title">
        <MapIcon />
        <span>地图</span>
        <button
          type="button"
          className={isEditing ? "map-manage-button active" : "map-manage-button"}
          onClick={() => { setIsEditing((current) => !current); setError(null); }}
          aria-expanded={isEditing}
        >
          {isEditing ? "完成" : "管理"}
        </button>
      </div>
      {!isEditing && (
        <>
          <div className="filter-options">
            {visibleMaps.map((map) => (
              <button
                key={map}
                type="button"
                className={value === map ? "filter-button active" : "filter-button"}
                onClick={() => onSelect(value === map ? null : map)}
                aria-pressed={value === map}
              >
                <span>{map}</span>
              </button>
            ))}
          </div>
          {hiddenMaps.length > 0 && <div className="hidden-map-summary">已收起 {hiddenMaps.length} 张地图</div>}
        </>
      )}
      {isEditing && (
        <div className="map-manager">
          <p>调整显示顺序，或收起不常用地图。</p>
          <div className="map-manager-list">
            {maps.map((map, index) => {
              const isHidden = hiddenMaps.some((hidden) => sameMap(hidden, map));
              return (
                <div className={isHidden ? "map-manager-item hidden" : "map-manager-item"} key={map}>
                  <span title={map}>{map}</span>
                  <div className="map-order-actions">
                    <button type="button" onClick={() => moveMap(index, -1)} disabled={index === 0} aria-label={`上移 ${map}`}>↑</button>
                    <button type="button" onClick={() => moveMap(index, 1)} disabled={index === maps.length - 1} aria-label={`下移 ${map}`}>↓</button>
                  </div>
                  <button type="button" className="map-visibility-button" onClick={() => toggleMap(map)}>
                    {isHidden ? "显示" : "收起"}
                  </button>
                </div>
              );
            })}
          </div>
          <form className="map-add-form" onSubmit={addMap}>
            <input
              value={draft}
              onChange={(event) => { setDraft(event.target.value); setError(null); }}
              placeholder="添加地图名称"
              aria-label="添加地图名称"
            />
            <button type="submit" aria-label="添加地图"><PlusIcon /></button>
          </form>
          {error && <small className="map-manager-error">{error}</small>}
        </div>
      )}
    </section>
  );
}

export function Sidebar({ filters, tags, maps, hiddenMaps, screenshotShortcut, onChange, onMapsChange }: SidebarProps) {
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <div><CrosshairIcon /><span>筛选笔记</span></div>
        {hasFilters && <button type="button" onClick={() => onChange({ mapName: null, side: null, grenadeType: null, tagName: null })}>清除筛选</button>}
      </div>
      <MapFilter
        maps={maps}
        hiddenMaps={hiddenMaps}
        value={filters.mapName}
        onSelect={(mapName) => onChange({ ...filters, mapName })}
        onMapsChange={onMapsChange}
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
        renderLabel={grenadeTypeLabel}
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
        {screenshotShortcut ? screenshotShortcut.split("+").map((key, index) => (
          <span className="shortcut-key-group" key={`${key}-${index}`}>
            {index > 0 && <i>+</i>}<span className="shortcut-key">{key}</span>
          </span>
        )) : <span className="shortcut-unbound">未绑定</span>}
        <small>{screenshotShortcut ? "全局快速截图" : "截图快捷键"}</small>
      </div>
    </aside>
  );
}
