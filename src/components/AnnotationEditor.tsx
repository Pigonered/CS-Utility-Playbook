import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { NoteImage } from "../types/note";

type Tool = "arrow" | "circle" | "rect" | "pen" | "text";

interface Point {
  x: number;
  y: number;
}

interface StrokeAction {
  tool: "pen";
  points: Point[];
  color: string;
  width: number;
}

interface ShapeAction {
  tool: "arrow" | "circle" | "rect";
  start: Point;
  end: Point;
  color: string;
  width: number;
}

interface TextAction {
  tool: "text";
  point: Point;
  text: string;
  color: string;
  fontSize: number;
}

type AnnotationAction = StrokeAction | ShapeAction | TextAction;

interface AnnotationEditorProps {
  image: NoteImage;
  isSaving: boolean;
  error: string | null;
  onSave: (pngData: string | null, annotationData: string | null) => Promise<void>;
  onClose: () => void;
}

const TOOLS: Array<{ value: Tool; label: string; symbol: string }> = [
  { value: "arrow", label: "箭头", symbol: "↗" },
  { value: "circle", label: "圆圈", symbol: "○" },
  { value: "rect", label: "矩形", symbol: "□" },
  { value: "pen", label: "画笔", symbol: "✎" },
  { value: "text", label: "文字", symbol: "T" },
];

const COLORS = ["#ff4d4f", "#ffcc00", "#31d06f", "#31a8ff", "#ffffff"];

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Point;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isAnnotationAction(value: unknown): value is AnnotationAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<AnnotationAction> & Record<string, unknown>;
  if (typeof action.color !== "string" || typeof action.tool !== "string") return false;
  if (action.tool === "text") {
    return isPoint(action.point) && typeof action.text === "string" && typeof action.fontSize === "number";
  }
  if (action.tool === "pen") {
    return Array.isArray(action.points) && action.points.every(isPoint) && typeof action.width === "number";
  }
  return (action.tool === "arrow" || action.tool === "circle" || action.tool === "rect")
    && isPoint(action.start) && isPoint(action.end) && typeof action.width === "number";
}

function parseActions(value: string | null): AnnotationAction[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isAnnotationAction) : [];
  } catch {
    return [];
  }
}

function drawAction(context: CanvasRenderingContext2D, action: AnnotationAction, width: number, height: number) {
  const scale = Math.max(width, height) / 1000;
  context.save();
  context.strokeStyle = action.color;
  context.fillStyle = action.color;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (action.tool === "text") {
    const x = action.point.x * width;
    const y = action.point.y * height;
    context.font = `700 ${Math.max(14, action.fontSize * scale)}px "Microsoft YaHei", sans-serif`;
    context.lineWidth = Math.max(2, 3 * scale);
    context.strokeStyle = "rgba(0, 0, 0, .72)";
    context.strokeText(action.text, x, y);
    context.fillStyle = action.color;
    context.fillText(action.text, x, y);
    context.restore();
    return;
  }

  context.lineWidth = Math.max(2, action.width * scale);
  if (action.tool === "pen") {
    if (action.points.length < 2) {
      context.restore();
      return;
    }
    context.beginPath();
    context.moveTo(action.points[0].x * width, action.points[0].y * height);
    action.points.slice(1).forEach((point) => context.lineTo(point.x * width, point.y * height));
    context.stroke();
    context.restore();
    return;
  }

  const startX = action.start.x * width;
  const startY = action.start.y * height;
  const endX = action.end.x * width;
  const endY = action.end.y * height;
  context.beginPath();
  if (action.tool === "rect") {
    context.rect(startX, startY, endX - startX, endY - startY);
  } else if (action.tool === "circle") {
    context.ellipse(
      (startX + endX) / 2,
      (startY + endY) / 2,
      Math.abs(endX - startX) / 2,
      Math.abs(endY - startY) / 2,
      0,
      0,
      Math.PI * 2,
    );
  } else {
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    const angle = Math.atan2(endY - startY, endX - startX);
    const head = Math.max(14, 22 * scale);
    context.moveTo(endX, endY);
    context.lineTo(endX - head * Math.cos(angle - Math.PI / 6), endY - head * Math.sin(angle - Math.PI / 6));
    context.moveTo(endX, endY);
    context.lineTo(endX - head * Math.cos(angle + Math.PI / 6), endY - head * Math.sin(angle + Math.PI / 6));
  }
  context.stroke();
  context.restore();
}

export function AnnotationEditor({ image, isSaving, error, onSave, onClose }: AnnotationEditorProps) {
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState(COLORS[0]);
  const [lineWidth, setLineWidth] = useState(5);
  const [fontSize, setFontSize] = useState(32);
  const [text, setText] = useState("");
  const [actions, setActions] = useState<AnnotationAction[]>(() => parseActions(image.annotationData));
  const [redoActions, setRedoActions] = useState<AnnotationAction[]>([]);
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  const actionsRef = useRef(actions);
  const draftRef = useRef<AnnotationAction | null>(null);

  const renderCanvas = () => {
    const canvas = canvasRef.current;
    const baseImage = baseImageRef.current;
    if (!canvas || !baseImage) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
    actionsRef.current.forEach((action) => drawAction(context, action, canvas.width, canvas.height));
    if (draftRef.current) drawAction(context, draftRef.current, canvas.width, canvas.height);
  };

  useEffect(() => {
    actionsRef.current = actions;
    renderCanvas();
  }, [actions]);

  useEffect(() => {
    const source = new Image();
    source.crossOrigin = "anonymous";
    source.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = source.naturalWidth;
      canvas.height = source.naturalHeight;
      baseImageRef.current = source;
      setIsImageLoading(false);
      window.requestAnimationFrame(renderCanvas);
    };
    source.onerror = () => {
      setIsImageLoading(false);
      setLocalError("无法加载原始图片，暂时不能进行标注");
    };
    source.src = convertFileSrc(image.imagePath);
  }, [image.imagePath]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) onClose();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setActions((current) => {
          const removed = current.at(-1);
          if (!removed) return current;
          setRedoActions((redo) => [...redo, removed]);
          return current.slice(0, -1);
        });
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        setRedoActions((current) => {
          const restored = current.at(-1);
          if (!restored) return current;
          setActions((items) => [...items, restored]);
          return current.slice(0, -1);
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSaving, onClose]);

  const canvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const commitAction = (action: AnnotationAction) => {
    setActions((current) => [...current, action]);
    setRedoActions([]);
    setLocalError(null);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (isSaving || isImageLoading) return;
    const point = canvasPoint(event);
    if (tool === "text") {
      const value = text.trim();
      if (!value) {
        setLocalError("请先在工具栏输入要添加的文字");
        return;
      }
      commitAction({ tool: "text", point, text: value, color, fontSize });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    draftRef.current = tool === "pen"
      ? { tool: "pen", points: [point], color, width: lineWidth }
      : { tool, start: point, end: point, color, width: lineWidth };
    renderCanvas();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const draft = draftRef.current;
    if (!draft) return;
    const point = canvasPoint(event);
    if (draft.tool === "pen") {
      const previous = draft.points.at(-1);
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.0015) return;
      draft.points.push(point);
    } else if (draft.tool !== "text") {
      draft.end = point;
    }
    renderCanvas();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const draft = draftRef.current;
    if (!draft) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    draftRef.current = null;
    if (draft.tool === "pen") {
      if (draft.points.length > 1) commitAction(draft);
    } else if (draft.tool !== "text") {
      const distance = Math.hypot(draft.end.x - draft.start.x, draft.end.y - draft.start.y);
      if (distance > 0.003) commitAction(draft);
    }
    renderCanvas();
  };

  const undo = () => {
    setActions((current) => {
      const removed = current.at(-1);
      if (!removed) return current;
      setRedoActions((redo) => [...redo, removed]);
      return current.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoActions((current) => {
      const restored = current.at(-1);
      if (!restored) return current;
      setActions((items) => [...items, restored]);
      return current.slice(0, -1);
    });
  };

  const save = async () => {
    setLocalError(null);
    if (actions.length === 0) {
      await onSave(null, null);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas || !baseImageRef.current) {
      setLocalError("图片尚未加载完成");
      return;
    }
    renderCanvas();
    try {
      const pngData = canvas.toDataURL("image/png");
      await onSave(pngData, JSON.stringify(actions));
    } catch {
      setLocalError("无法生成标注图片，请重新打开标注器后再试");
    }
  };

  return (
    <div className="annotation-backdrop" role="presentation">
      <section className="annotation-editor" role="dialog" aria-modal="true" aria-labelledby="annotation-title">
        <header className="annotation-header">
          <div>
            <span className="eyebrow">图片标注工具</span>
            <h2 id="annotation-title">图片标注</h2>
            <p>原图会被保留，保存后生成单独的标注版本</p>
          </div>
          <button type="button" className="editor-close" onClick={onClose} disabled={isSaving} aria-label="关闭标注器">×</button>
        </header>

        <div className="annotation-toolbar">
          <div className="annotation-tools" aria-label="标注工具">
            {TOOLS.map((item) => (
              <button
                type="button"
                key={item.value}
                className={tool === item.value ? "active" : ""}
                onClick={() => setTool(item.value)}
                disabled={isSaving}
                title={item.label}
              >
                <b>{item.symbol}</b><span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="annotation-options">
            <div className="annotation-colors" aria-label="标注颜色">
              {COLORS.map((value) => (
                <button
                  type="button"
                  key={value}
                  className={color === value ? "active" : ""}
                  style={{ backgroundColor: value }}
                  onClick={() => setColor(value)}
                  disabled={isSaving}
                  aria-label={`选择颜色 ${value}`}
                />
              ))}
            </div>
            {tool === "text" ? (
              <>
                <input className="annotation-text-input" value={text} onChange={(event) => setText(event.target.value)} placeholder="输入文字后点击图片" maxLength={80} disabled={isSaving} />
                <select value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} disabled={isSaving} aria-label="文字大小">
                  <option value={24}>小字</option><option value={32}>中字</option><option value={44}>大字</option>
                </select>
              </>
            ) : (
              <select value={lineWidth} onChange={(event) => setLineWidth(Number(event.target.value))} disabled={isSaving} aria-label="线条粗细">
                <option value={3}>细线</option><option value={5}>中线</option><option value={8}>粗线</option>
              </select>
            )}
          </div>
          <div className="annotation-history">
            <button type="button" onClick={undo} disabled={actions.length === 0 || isSaving} title="撤销 Ctrl+Z">↶ 撤销</button>
            <button type="button" onClick={redo} disabled={redoActions.length === 0 || isSaving} title="重做 Ctrl+Y">↷ 重做</button>
            <button type="button" className="clear" onClick={() => { setActions([]); setRedoActions([]); }} disabled={actions.length === 0 || isSaving}>清除标注</button>
          </div>
        </div>

        <div className="annotation-stage">
          {isImageLoading && <div className="annotation-loading"><span className="spinner" />正在加载原图</div>}
          <canvas
            ref={canvasRef}
            className={`annotation-canvas tool-${tool}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        </div>

        <footer className="annotation-footer">
          <div>
            {(localError || error) && <span className="annotation-error" role="alert">{localError || error}</span>}
            {!localError && !error && <span>拖动绘制图形；文字工具需先输入内容再点击图片</span>}
          </div>
          <div>
            <button type="button" className="secondary-button" onClick={onClose} disabled={isSaving}>取消</button>
            <button type="button" className="primary-button" onClick={() => void save()} disabled={isSaving || isImageLoading || Boolean(localError && !baseImageRef.current)}>
              {isSaving ? "正在保存" : actions.length === 0 && image.annotatedPath ? "恢复原图" : "保存标注"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
