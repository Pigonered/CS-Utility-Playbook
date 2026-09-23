export const DEFAULT_MAPS = [
  "Mirage",
  "Inferno",
  "Dust2",
  "Ancient",
  "Nuke",
  "Anubis",
  "Train",
  "Cache",
  "Overpass",
  "Vertigo",
] as const;
export const SIDES = ["T", "CT"] as const;
export const GRENADE_TYPES = ["Smoke", "Flash", "Molotov", "HE", "Other"] as const;
export const IMAGE_TYPES = ["站位", "瞄点", "效果", "其他"] as const;
export const THROW_TYPES = ["左键", "右键", "左右键", "Jump Throw", "Run Throw", "Walk Throw"] as const;

// 地图列表支持由用户扩展，因此地图名不能再限制为编译期的固定联合类型。
export type MapName = string;
export type Side = (typeof SIDES)[number];
export type GrenadeType = (typeof GRENADE_TYPES)[number];
export type ImageType = (typeof IMAGE_TYPES)[number];
export type ThrowType = (typeof THROW_TYPES)[number];

export const GRENADE_TYPE_LABELS: Record<GrenadeType, string> = {
  Smoke: "烟雾弹",
  Flash: "闪光弹",
  Molotov: "燃烧瓶",
  HE: "高爆手雷",
  Other: "其他",
};

export const THROW_TYPE_LABELS: Record<ThrowType, string> = {
  左键: "左键投掷",
  右键: "右键投掷",
  左右键: "双键投掷",
  "Jump Throw": "跳投",
  "Run Throw": "跑投",
  "Walk Throw": "走投",
};

export function grenadeTypeLabel(value: GrenadeType): string {
  return GRENADE_TYPE_LABELS[value];
}

export function throwTypeLabel(value: string): string {
  return THROW_TYPES.includes(value as ThrowType)
    ? THROW_TYPE_LABELS[value as ThrowType]
    : value;
}

export interface NoteImage {
  id: number;
  noteId: number;
  imagePath: string;
  annotatedPath: string | null;
  annotationData: string | null;
  imageType: ImageType;
  sortOrder: number;
  createdAt: string;
}

export interface NoteImageInput {
  existingId?: number;
  sourcePath?: string;
  imageType: ImageType;
}

export interface Tag {
  id: number;
  name: string;
}

export interface Note {
  id: number;
  title: string;
  mapName: MapName;
  side: Side;
  grenadeType: GrenadeType;
  startPosition: string;
  targetPosition: string;
  throwType: string;
  description: string;
  images: NoteImage[];
  tags: Tag[];
  createdAt: string;
  updatedAt: string;
}

export interface NoteInput {
  title: string;
  mapName: MapName;
  side: Side;
  grenadeType: GrenadeType;
  startPosition: string;
  targetPosition: string;
  throwType: string;
  description: string;
  tags: string[];
}

export interface NoteFilters {
  mapName: MapName | null;
  side: Side | null;
  grenadeType: GrenadeType | null;
  tagName: string | null;
}
