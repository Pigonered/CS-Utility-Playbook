export const DEFAULT_COMMON_TAGS = ["默认道具", "进攻", "防守", "残局", "必学"];
export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 24;

export function cleanTag(value: string): string {
  return value.trim().replace(/^#+/, "").trim();
}

export function ratingGroup(value: string): string | null {
  return /^(容错率|实用性)[：:]/.exec(value)?.[1] ?? null;
}

export function withTag(tags: string[], value: string): string[] {
  const tag = cleanTag(value);
  if (!tag) return tags;
  const group = ratingGroup(tag);
  const retained = group ? tags.filter((current) => ratingGroup(current) !== group) : tags;
  return retained.some((current) => current.toLocaleLowerCase("zh-CN") === tag.toLocaleLowerCase("zh-CN"))
    ? retained : [...retained, tag];
}

export function loadLegacyCommonTags(): string[] {
  try {
    const saved = window.localStorage.getItem("cs-notes.common-tags");
    if (saved === null) return [...DEFAULT_COMMON_TAGS];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [...DEFAULT_COMMON_TAGS];
    const unique = new Set<string>();
    return parsed.filter((value): value is string => typeof value === "string")
      .map(cleanTag).filter((tag) => {
        const key = tag.toLocaleLowerCase("zh-CN");
        if (!tag || tag.length > MAX_TAG_LENGTH || unique.has(key)) return false;
        unique.add(key);
        return true;
      }).slice(0, 20);
  } catch {
    return [...DEFAULT_COMMON_TAGS];
  }
}
