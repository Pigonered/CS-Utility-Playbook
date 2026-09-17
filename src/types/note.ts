export const MAPS = ["Mirage", "Inferno", "Dust2", "Ancient", "Nuke", "Anubis", "Train"] as const;
export const SIDES = ["T", "CT"] as const;
export const GRENADE_TYPES = ["Smoke", "Flash", "Molotov", "HE", "Other"] as const;
export const IMAGE_TYPES = ["站位", "瞄点", "效果", "其他"] as const;

export type MapName = (typeof MAPS)[number];
export type Side = (typeof SIDES)[number];
export type GrenadeType = (typeof GRENADE_TYPES)[number];
export type ImageType = (typeof IMAGE_TYPES)[number];

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
