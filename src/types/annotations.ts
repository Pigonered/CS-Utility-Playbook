export interface Point { x: number; y: number }
export interface Bounds { left: number; top: number; right: number; bottom: number }
export interface StrokeAction { id: string; tool: "pen"; points: Point[]; color: string; width: number }
export interface ShapeAction { id: string; tool: "arrow" | "circle" | "rect"; start: Point; end: Point; color: string; width: number }
export interface TextAction { id: string; tool: "text"; point: Point; text: string; color: string; fontSize: number; textBaseline?: "top" }
export type AnnotationAction = StrokeAction | ShapeAction | TextAction;
export type Handle = "start" | "end" | "nw" | "ne" | "se" | "sw";
export interface History { past: AnnotationAction[][]; present: AnnotationAction[]; future: AnnotationAction[][] }
export const FONT_FAMILY = '"Microsoft YaHei", sans-serif';

export function newAnnotationId(): string { return crypto.randomUUID(); }

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Point;
  return Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

export function parseActions(value: string | null): AnnotationAction[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const ids = new Set<string>();
    return parsed.flatMap((entry, index) => {
      if (!entry || typeof entry !== "object") return [];
      const action = entry as Record<string, unknown>;
      if (typeof action.color !== "string" || !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(action.color)) return [];
      let id = typeof action.id === "string" && action.id.length > 0 && action.id.length <= 128 ? action.id : `legacy-${index}`;
      while (ids.has(id)) id = `${id}-${index}`;
      const positive = (number: unknown) => typeof number === "number" && Number.isFinite(number) && number > 0 && number <= 1000;
      let result: AnnotationAction;
      if (action.tool === "text" && isPoint(action.point) && typeof action.text === "string" && action.text.length <= 2000 && positive(action.fontSize)) {
        result = { id, tool: "text", point: action.point, text: action.text.replace(/\r\n?/g, "\n"), color: action.color, fontSize: action.fontSize as number,
          ...(action.textBaseline === "top" ? { textBaseline: "top" as const } : {}) };
      } else if (action.tool === "pen" && Array.isArray(action.points) && action.points.length > 0 && action.points.every(isPoint) && positive(action.width)) {
        result = { id, tool: "pen", points: action.points, color: action.color, width: action.width as number };
      } else if ((action.tool === "arrow" || action.tool === "rect" || action.tool === "circle") && isPoint(action.start) && isPoint(action.end) && positive(action.width)) {
        result = { id, tool: action.tool, start: action.start, end: action.end, color: action.color, width: action.width as number };
      } else return [];
      ids.add(id);
      return [result];
    });
  } catch { return []; }
}

export function createHistory(actions: AnnotationAction[]): History { return { past: [], present: actions, future: [] }; }
export function commitHistory(history: History, actions: AnnotationAction[]): History {
  if (JSON.stringify(history.present) === JSON.stringify(actions)) return history;
  return { past: [...history.past, history.present].slice(-100), present: actions, future: [] };
}
export function undoHistory(history: History): History {
  const previous = history.past.at(-1);
  return previous ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] } : history;
}
export function redoHistory(history: History): History {
  const next = history.future[0];
  return next ? { past: [...history.past, history.present], present: next, future: history.future.slice(1) } : history;
}

export function textFontPixels(action: TextAction, width: number, height: number): number {
  return Math.max(14, action.fontSize * Math.max(width, height) / 1000);
}
export function textBounds(action: TextAction, width: number, height: number, measure: (text: string, font: number) => number): Bounds {
  const font = textFontPixels(action, width, height);
  const lines = action.text.split("\n");
  const top = action.point.y - (action.textBaseline === "top" ? 0 : font / height);
  return { left: action.point.x, top, right: action.point.x + Math.max(font / 2, ...lines.map((line) => measure(line, font))) / width,
    bottom: top + (font + (lines.length - 1) * font * 1.3) / height };
}
export function actionBounds(action: AnnotationAction, textMeasure: (action: TextAction) => Bounds): Bounds {
  if (action.tool === "text") return textMeasure(action);
  const points = action.tool === "pen" ? action.points : [action.start, action.end];
  return points.reduce<Bounds>((bounds, point) => ({ left: Math.min(bounds.left, point.x), top: Math.min(bounds.top, point.y),
    right: Math.max(bounds.right, point.x), bottom: Math.max(bounds.bottom, point.y) }), { left: 1, top: 1, right: 0, bottom: 0 });
}
export function handlesFor(action: AnnotationAction): Array<{ name: Handle; point: Point }> {
  if (action.tool === "text" || action.tool === "pen") return [];
  if (action.tool === "arrow") return [{ name: "start", point: action.start }, { name: "end", point: action.end }];
  const left = Math.min(action.start.x, action.end.x), right = Math.max(action.start.x, action.end.x);
  const top = Math.min(action.start.y, action.end.y), bottom = Math.max(action.start.y, action.end.y);
  return [{ name: "nw", point: { x: left, y: top } }, { name: "ne", point: { x: right, y: top } },
    { name: "se", point: { x: right, y: bottom } }, { name: "sw", point: { x: left, y: bottom } }];
}
export function resizeAction(action: ShapeAction, handle: Handle, point: Point): ShapeAction {
  if (handle === "start" || handle === "end") return { ...action, [handle]: point };
  const handles = handlesFor(action);
  const opposite: Record<string, string> = { nw: "se", ne: "sw", se: "nw", sw: "ne" };
  const anchor = handles.find((item) => item.name === opposite[handle])!.point;
  return { ...action, start: anchor, end: point };
}
export function moveAction(action: AnnotationAction, delta: Point, textMeasure: (action: TextAction) => Bounds): AnnotationAction {
  const bounds = actionBounds(action, textMeasure);
  const constrain = (value: number, min: number, max: number) => min > max ? min : Math.min(max, Math.max(min, value));
  let dx = constrain(delta.x, -bounds.left, 1 - bounds.right);
  let dy = constrain(delta.y, -bounds.top, 1 - bounds.bottom);
  if (action.tool === "text") {
    dx = Math.min(1 - action.point.x, Math.max(-action.point.x, dx));
    dy = Math.min(1 - action.point.y, Math.max(-action.point.y, dy));
  }
  const move = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy });
  if (action.tool === "text") return { ...action, point: move(action.point) };
  if (action.tool === "pen") return { ...action, points: action.points.map(move) };
  return { ...action, start: move(action.start), end: move(action.end) };
}

function segmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x, dy = end.y - start.y;
  const t = dx === 0 && dy === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}
export function arrowHeadPoints(action: ShapeAction, width: number, height: number): Point[] {
  const start = { x: action.start.x * width, y: action.start.y * height }, end = { x: action.end.x * width, y: action.end.y * height };
  const angle = Math.atan2(end.y - start.y, end.x - start.x), head = Math.max(14, 22 * Math.max(width, height) / 1000);
  return [Math.PI / 6, -Math.PI / 6].map((offset) => ({ x: end.x - head * Math.cos(angle + offset), y: end.y - head * Math.sin(angle + offset) }));
}
export function hitTest(actions: AnnotationAction[], point: Point, width: number, height: number, tolerance: number, textMeasure: (action: TextAction) => Bounds): AnnotationAction | null {
  const pixel = (p: Point) => ({ x: p.x * width, y: p.y * height });
  const target = pixel(point);
  return [...actions].reverse().find((action) => {
    const bounds = actionBounds(action, textMeasure);
    if (action.tool === "text") return target.x >= bounds.left * width - tolerance && target.x <= bounds.right * width + tolerance
      && target.y >= bounds.top * height - tolerance && target.y <= bounds.bottom * height + tolerance;
    const margin = tolerance + Math.max(2, action.width * Math.max(width, height) / 1000) / 2;
    if (action.tool === "pen") return action.points.some((p, index) => segmentDistance(target, pixel(p), pixel(action.points[Math.max(0, index - 1)])) <= margin);
    if (action.tool === "arrow") return segmentDistance(target, pixel(action.start), pixel(action.end)) <= margin
      || arrowHeadPoints(action, width, height).some((head) => segmentDistance(target, pixel(action.end), head) <= margin);
    const left = bounds.left * width, right = bounds.right * width, top = bounds.top * height, bottom = bounds.bottom * height;
    if (action.tool === "rect") return [[{ x: left, y: top }, { x: right, y: top }], [{ x: right, y: top }, { x: right, y: bottom }],
      [{ x: right, y: bottom }, { x: left, y: bottom }], [{ x: left, y: bottom }, { x: left, y: top }]].some(([a, b]) => segmentDistance(target, a, b) <= margin);
    const rx = (right - left) / 2, ry = (bottom - top) / 2;
    if (rx === 0 || ry === 0) return segmentDistance(target, { x: left, y: top }, { x: right, y: bottom }) <= margin;
    const angle = Math.atan2((target.y - (top + bottom) / 2) / ry, (target.x - (left + right) / 2) / rx);
    return Math.hypot(target.x - (left + right) / 2 - rx * Math.cos(angle), target.y - (top + bottom) / 2 - ry * Math.sin(angle)) <= margin;
  }) ?? null;
}
