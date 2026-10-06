import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { NoteImage } from "../types/note";
import { CloseIcon } from "./icons";
import { drawAction } from "./annotationCanvas";
import { constrainViewport, INITIAL_VIEWPORT, zoomViewport, type Viewport } from "../types/imageViewport";
import {
  actionBounds, commitHistory, createHistory, FONT_FAMILY, handlesFor, hitTest, moveAction, newAnnotationId,
  parseActions, redoHistory, resizeAction, textBounds, textFontPixels, undoHistory,
  type AnnotationAction, type Handle, type History, type Point, type ShapeAction, type TextAction,
} from "../types/annotations";

type Tool = "select" | AnnotationAction["tool"];
interface AnnotationEditorProps {
  image: NoteImage;
  isSaving: boolean;
  error: string | null;
  onSave: (pngData: string | null, annotationData: string | null) => Promise<void>;
  onClose: () => void;
}
interface TextEdit { action: TextAction; isNew: boolean }
interface Gesture { pointerId: number; mode: "draw" | "move" | "resize"; start: Point; original: AnnotationAction; handle?: Handle }
interface PanGesture { pointerId: number; x: number; y: number; view: Viewport }
const TOOLS: Array<{ value: Tool; label: string; symbol: string }> = [
  { value: "select", label: "选择", symbol: "↖" }, { value: "arrow", label: "箭头", symbol: "↗" },
  { value: "circle", label: "圆圈", symbol: "○" }, { value: "rect", label: "矩形", symbol: "□" },
  { value: "pen", label: "画笔", symbol: "✎" }, { value: "text", label: "文字", symbol: "T" },
];
const COLORS = ["#ff4d4f", "#ffcc00", "#31d06f", "#31a8ff", "#ffffff"];

export function AnnotationEditor({ image, isSaving, error, onSave, onClose }: AnnotationEditorProps) {
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState(COLORS[0]);
  const [lineWidth, setLineWidth] = useState(5);
  const [fontSize, setFontSize] = useState(32);
  const [history, setHistory] = useState<History>(() => createHistory(parseActions(image.annotationData)));
  const historyRef = useRef(history);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<AnnotationAction | null>(null);
  const previewRef = useRef<AnnotationAction | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [editing, setEditing] = useState<TextEdit | null>(null);
  const editingRef = useRef<TextEdit | null>(null);
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const savingRef = useRef(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 });
  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);
  const viewportRef = useRef(viewport);
  const panRef = useRef<PanGesture | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const spaceRef = useRef(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  const disabled = isSaving || isExporting;
  const fitScale = Math.min(1, stageSize.width / imageSize.width, stageSize.height / imageSize.height);
  const fitWidth = imageSize.width * fitScale, fitHeight = imageSize.height * fitScale;
  const scale = fitScale * viewport.zoom;
  const displayWidth = Math.max(1, imageSize.width * scale), displayHeight = Math.max(1, imageSize.height * scale);
  const selected = editing?.action ?? (preview?.id === selectedId ? preview : history.present.find((action) => action.id === selectedId)) ?? null;
  const textSelected = selected?.tool === "text";

  const measureText = (action: TextAction) => textBounds(action, imageSize.width, imageSize.height, (line, font) => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return line.length * font * .7;
    context.save();
    context.font = `700 ${font}px ${FONT_FAMILY}`;
    const width = context.measureText(line).width;
    context.restore();
    return width;
  });
  const selectedBounds = selected ? actionBounds(selected, measureText) : null;
  const handles = selected ? handlesFor(selected) : [];
  const updateViewport = (next: Viewport) => { viewportRef.current = next; setViewport(next); };
  const stopPan = () => {
    const pan = panRef.current;
    panRef.current = null;
    setIsPanning(false);
    if (pan && stageRef.current?.hasPointerCapture(pan.pointerId)) stageRef.current.releasePointerCapture(pan.pointerId);
  };
  const resetViewport = () => {
    if (disabled || savingRef.current || isImageLoading || gestureRef.current) return;
    stopPan(); updateViewport(INITIAL_VIEWPORT);
  };

  const renderCanvas = () => {
    const canvas = canvasRef.current, baseImage = baseImageRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !baseImage || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
    const pending = previewRef.current;
    historyRef.current.present.forEach((action) => {
      if (editingRef.current?.action.id !== action.id) drawAction(context, pending?.id === action.id ? pending : action, canvas.width, canvas.height);
    });
    if (pending && !historyRef.current.present.some((action) => action.id === pending.id)) drawAction(context, pending, canvas.width, canvas.height);
  };
  const updateHistory = (next: History) => { historyRef.current = next; setHistory(next); renderCanvas(); };
  const commit = (actions: AnnotationAction[]) => { updateHistory(commitHistory(historyRef.current, actions)); setLocalError(null); };
  const updateEdit = (next: TextEdit | null) => { editingRef.current = next; setEditing(next); renderCanvas(); };
  const clearGesture = () => {
    stopPan();
    const gesture = gestureRef.current;
    gestureRef.current = null;
    previewRef.current = null;
    setPreview(null);
    if (gesture && canvasRef.current?.hasPointerCapture(gesture.pointerId)) canvasRef.current.releasePointerCapture(gesture.pointerId);
    renderCanvas();
  };
  const finishText = (cancel = false) => {
    const edit = editingRef.current;
    if (!edit) return;
    updateEdit(null);
    if (cancel) { if (edit.isNew) setSelectedId(null); return; }
    const action = { ...edit.action, text: edit.action.text.replace(/\r\n?/g, "\n") };
    const current = historyRef.current.present;
    if (!action.text.trim()) {
      if (!edit.isNew) commit(current.filter((item) => item.id !== action.id));
      setSelectedId(null);
    } else commit(edit.isNew ? [...current, action] : current.map((item) => item.id === action.id ? action : item));
  };
  const beginText = (action: TextAction, isNew = false) => {
    clearGesture();
    setSelectedId(action.id);
    setTool("select");
    setColor(action.color);
    setFontSize(action.fontSize);
    updateEdit({ action, isNew });
    window.requestAnimationFrame(() => {
      if (editingRef.current?.action.id === action.id) textareaRef.current?.focus({ preventScroll: true });
    });
  };
  const selectAction = (action: AnnotationAction | null) => {
    setSelectedId(action?.id ?? null);
    if (!action) return;
    setColor(action.color);
    if (action.tool === "text") setFontSize(action.fontSize); else setLineWidth(action.width);
  };
  const changeStyle = (values: { color?: string; width?: number; fontSize?: number }) => {
    if (disabled || savingRef.current) return;
    if (values.color) setColor(values.color);
    if (values.width) setLineWidth(values.width);
    if (values.fontSize) setFontSize(values.fontSize);
    const edit = editingRef.current;
    if (edit) { updateEdit({ ...edit, action: { ...edit.action, ...values } }); return; }
    if (!selected) return;
    commit(historyRef.current.present.map((action) => action.id === selected.id ? { ...action, ...values } : action));
  };
  const deleteSelected = () => {
    if (disabled || savingRef.current || !selectedId) return;
    finishText(true);
    clearGesture();
    commit(historyRef.current.present.filter((action) => action.id !== selectedId));
    setSelectedId(null);
  };
  const navigateHistory = (direction: "undo" | "redo") => {
    if (disabled || savingRef.current) return;
    finishText();
    clearGesture();
    updateHistory(direction === "undo" ? undoHistory(historyRef.current) : redoHistory(historyRef.current));
    setSelectedId(null);
  };

  useEffect(() => { renderCanvas(); }, [history, editing]);
  useEffect(() => {
    updateViewport(constrainViewport(viewportRef.current, { width: fitWidth, height: fitHeight }, stageSize));
  }, [fitWidth, fitHeight, stageSize.width, stageSize.height]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const wheel = (event: WheelEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) {
        if (event.ctrlKey) event.preventDefault();
        return;
      }
      event.preventDefault();
      if (disabled || savingRef.current || isImageLoading || !baseImageRef.current || gestureRef.current || panRef.current) return;
      const bounds = stage.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stageSize.height : 1);
      updateViewport(zoomViewport(viewportRef.current, delta, { x: event.clientX - bounds.left - stage.clientWidth / 2,
        y: event.clientY - bounds.top - stage.clientHeight / 2 }, { width: fitWidth, height: fitHeight }, stageSize));
    };
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => stage.removeEventListener("wheel", wheel);
  }, [disabled, isImageLoading, fitWidth, fitHeight, stageSize.width, stageSize.height]);
  useEffect(() => {
    if (!stageRef.current) return;
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) }));
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const source = new Image();
    let active = true;
    source.crossOrigin = "anonymous";
    source.onload = () => {
      if (!active || !canvasRef.current) return;
      canvasRef.current.width = source.naturalWidth;
      canvasRef.current.height = source.naturalHeight;
      baseImageRef.current = source;
      setImageSize({ width: source.naturalWidth, height: source.naturalHeight });
      setIsImageLoading(false);
      updateViewport(INITIAL_VIEWPORT);
      renderCanvas();
    };
    source.onerror = () => { if (active) { setIsImageLoading(false); setLocalError("无法加载原始图片，暂时不能进行标注"); } };
    source.src = convertFileSrc(image.imagePath);
    return () => { active = false; source.onload = null; source.onerror = null; baseImageRef.current = null; };
  }, [image.imagePath]);
  useEffect(() => {
    if (editing) textareaRef.current?.focus({ preventScroll: true });
  }, [editing?.action.id]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (disabled || savingRef.current || event.isComposing) return;
      const input = event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]");
      if (input) return;
      if (event.code === "Space") {
        event.preventDefault();
        spaceRef.current = true;
        setSpacePressed(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (panRef.current) { const initial = panRef.current.view; stopPan(); updateViewport(initial); }
        else if (editingRef.current) finishText(true);
        else if (gestureRef.current) clearGesture();
        else if (selectedId) setSelectedId(null);
        else onClose();
      } else if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        navigateHistory(event.key.toLowerCase() === "y" || event.shiftKey ? "redo" : "undo");
      } else if (["Delete", "Backspace"].includes(event.key) && selectedId) {
        event.preventDefault();
        deleteSelected();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") { spaceRef.current = false; setSpacePressed(false); }
    };
    const onBlur = () => { spaceRef.current = false; setSpacePressed(false); clearGesture(); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); window.removeEventListener("blur", onBlur); };
  });

  const handlePanDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || isImageLoading || !baseImageRef.current || gestureRef.current || panRef.current) return;
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
    if (event.button !== 1 && !(event.button === 0 && spaceRef.current)) return;
    event.preventDefault();
    finishText();
    canvasRef.current?.focus({ preventScroll: true });
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view: viewportRef.current };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePanMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId || disabled) return;
    updateViewport(constrainViewport({ ...pan.view, offsetX: pan.view.offsetX + event.clientX - pan.x,
      offsetY: pan.view.offsetY + event.clientY - pan.y }, { width: fitWidth, height: fitHeight }, stageSize));
  };

  const canvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)), y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)) };
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled || savingRef.current || isImageLoading || !baseImageRef.current || event.button !== 0 || spaceRef.current || panRef.current || gestureRef.current) return;
    event.preventDefault();
    finishText();
    const point = canvasPoint(event);
    const tolerance = 7 / Math.max(scale, .001);
    const hit = hitTest(historyRef.current.present, point, imageSize.width, imageSize.height, tolerance, measureText);
    const insideSelection = selectedBounds && point.x >= selectedBounds.left && point.x <= selectedBounds.right && point.y >= selectedBounds.top && point.y <= selectedBounds.bottom;
    const found = hit ?? (tool === "select" && insideSelection ? selected : null);
    if (tool === "text") {
      if (found?.tool === "text") beginText(found);
      else beginText({ id: newAnnotationId(), tool: "text", point: { x: Math.min(point.x, Math.max(0, 1 - 140 / displayWidth)), y: Math.min(point.y, Math.max(0, 1 - 50 / displayHeight)) }, text: "", color, fontSize, textBaseline: "top" }, true);
      return;
    }
    event.currentTarget.focus({ preventScroll: true });
    if (tool === "select") {
      const handle = selected ? handlesFor(selected).find((item) => Math.hypot((item.point.x - point.x) * displayWidth, (item.point.y - point.y) * displayHeight) <= 9) : null;
      if (handle && selected) gestureRef.current = { pointerId: event.pointerId, mode: "resize", start: point, original: selected, handle: handle.name };
      else {
        selectAction(found);
        if (found) gestureRef.current = { pointerId: event.pointerId, mode: "move", start: point, original: found };
      }
    } else {
      setSelectedId(null);
      const action: AnnotationAction = tool === "pen" ? { id: newAnnotationId(), tool, points: [point], color, width: lineWidth }
        : { id: newAnnotationId(), tool, start: point, end: point, color, width: lineWidth };
      gestureRef.current = { pointerId: event.pointerId, mode: "draw", start: point, original: action };
      previewRef.current = action;
    }
    if (gestureRef.current) event.currentTarget.setPointerCapture(event.pointerId);
    renderCanvas();
  };
  const updateGesture = (point: Point) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.mode === "move") previewRef.current = moveAction(gesture.original, { x: point.x - gesture.start.x, y: point.y - gesture.start.y }, measureText);
    else if (gesture.mode === "resize") previewRef.current = resizeAction(gesture.original as ShapeAction, gesture.handle!, point);
    else if (gesture.original.tool === "pen") {
      const draft = previewRef.current;
      if (draft?.tool === "pen") {
        const previous = draft.points.at(-1)!;
        if (Math.hypot((point.x - previous.x) * displayWidth, (point.y - previous.y) * displayHeight) >= 1) draft.points.push(point);
      }
    } else if (gesture.original.tool !== "text") previewRef.current = { ...gesture.original, end: point };
    if (gesture.mode !== "draw") setPreview(previewRef.current);
    renderCanvas();
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled || event.pointerId !== gestureRef.current?.pointerId) return;
    updateGesture(canvasPoint(event));
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    updateGesture(canvasPoint(event));
    const pending = previewRef.current;
    const distance = Math.hypot((canvasPoint(event).x - gesture.start.x) * displayWidth, (canvasPoint(event).y - gesture.start.y) * displayHeight);
    clearGesture();
    if (!pending || disabled) return;
    if (gesture.mode === "draw") {
      if (pending.tool !== "pen" && distance < 3) return;
      commit([...historyRef.current.present, pending]);
      if (pending.tool === "pen") setSelectedId(null);
      else { selectAction(pending); setTool("select"); }
    } else if (distance >= 1) commit(historyRef.current.present.map((action) => action.id === pending.id ? pending : action));
  };
  const chooseTool = (value: Tool) => {
    finishText();
    clearGesture();
    setTool(value);
    if (value !== "select") setSelectedId(null);
  };
  const save = async () => {
    if (disabled || savingRef.current || isImageLoading || !baseImageRef.current) return;
    savingRef.current = true;
    setIsExporting(true);
    setLocalError(null);
    finishText();
    clearGesture();
    try {
      const actions = historyRef.current.present;
      renderCanvas();
      await onSave(actions.length ? canvasRef.current!.toDataURL("image/png") : null, actions.length ? JSON.stringify(actions) : null);
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : "无法保存标注图片，请重试");
    } finally { savingRef.current = false; setIsExporting(false); }
  };
  const editBounds = editing ? measureText(editing.action) : null;
  const editFont = editing ? textFontPixels(editing.action, imageSize.width, imageSize.height) * scale : 14;
  const editLeft = editBounds ? Math.max(0, Math.min(displayWidth - Math.min(140, displayWidth), editBounds.left * displayWidth)) : 0;
  const editTop = editBounds ? Math.max(0, Math.min(displayHeight - Math.min(48, displayHeight), editBounds.top * displayHeight)) : 0;

  return (
    <div className="annotation-backdrop" role="presentation">
      <section className="annotation-editor" role="dialog" aria-modal="true" aria-labelledby="annotation-title">
        <header className="annotation-header">
          <div><span className="eyebrow">图片标注工具</span><h2 id="annotation-title" title={image.displayName || "图片标注"}>{image.displayName || "图片标注"}</h2><p>选择标注后可移动、修改或删除；原图始终保留</p></div>
          <button type="button" className="editor-close" onClick={onClose} disabled={disabled} aria-label="关闭标注器"><CloseIcon /></button>
        </header>
        <div className="annotation-toolbar">
          <div className="annotation-tools" aria-label="标注工具">
            {TOOLS.map((item) => <button type="button" key={item.value} className={tool === item.value ? "active" : ""} aria-label={item.label} aria-pressed={tool === item.value} onClick={() => chooseTool(item.value)} disabled={disabled}><b>{item.symbol}</b><span>{item.label}</span></button>)}
          </div>
          <div className="annotation-options">
            <div className="annotation-colors" aria-label="标注颜色">{COLORS.map((value) => <button type="button" key={value} className={color === value ? "active" : ""} style={{ backgroundColor: value }} onClick={() => changeStyle({ color: value })} disabled={disabled} aria-label={`选择颜色 ${value}`} />)}</div>
            {textSelected || tool === "text" ? <select value={fontSize} onChange={(event) => changeStyle({ fontSize: Number(event.target.value) })} disabled={disabled} aria-label="文字大小">
              {[24, 32, 44].map((size) => <option value={size} key={size}>{size === 24 ? "小字" : size === 32 ? "中字" : "大字"}</option>)}
              {![24, 32, 44].includes(fontSize) && <option value={fontSize}>{fontSize}</option>}
            </select> : <select value={lineWidth} onChange={(event) => changeStyle({ width: Number(event.target.value) })} disabled={disabled} aria-label="线条粗细">
              {[3, 5, 8].map((width) => <option value={width} key={width}>{width === 3 ? "细线" : width === 5 ? "中线" : "粗线"}</option>)}
              {![3, 5, 8].includes(lineWidth) && <option value={lineWidth}>{lineWidth}</option>}
            </select>}
          </div>
          <div className="annotation-history">
            <button type="button" onClick={() => navigateHistory("undo")} disabled={history.past.length === 0 || disabled} title="撤销 Ctrl+Z">↶ 撤销</button>
            <button type="button" onClick={() => navigateHistory("redo")} disabled={history.future.length === 0 || disabled} title="重做 Ctrl+Y">↷ 重做</button>
            <button type="button" className="clear" onClick={() => { finishText(true); clearGesture(); commit([]); setSelectedId(null); }} disabled={history.present.length === 0 || disabled}>清除标注</button>
          </div>
          <div className="annotation-selection-actions">
            <span>{selected ? `已选中${TOOLS.find((item) => item.value === selected.tool)?.label}` : "点击选择标注，拖动控制点调整图形"}</span>
            {textSelected && <button type="button" onClick={() => selected?.tool === "text" && beginText(selected, Boolean(editing?.isNew))} disabled={disabled}>编辑文字</button>}
            <button type="button" onClick={deleteSelected} disabled={!selected || disabled}>删除所选</button>
          </div>
        </div>
        <div className={`annotation-stage${spacePressed ? " space-panning" : ""}${isPanning ? " is-panning" : ""}`} ref={stageRef}
          onPointerDown={handlePanDown} onPointerMove={handlePanMove}
          onPointerUp={(event) => { if (event.pointerId === panRef.current?.pointerId) stopPan(); }}
          onPointerCancel={(event) => { if (event.pointerId === panRef.current?.pointerId) stopPan(); }}
          onLostPointerCapture={(event) => { if (event.pointerId === panRef.current?.pointerId) stopPan(); }}>
          {isImageLoading && <div className="annotation-loading"><span className="spinner" />正在加载原图</div>}
          <div className="annotation-canvas-frame" style={{ width: displayWidth, height: displayHeight, transform: `translate(-50%, -50%) translate(${viewport.offsetX}px, ${viewport.offsetY}px)` }}>
            <canvas ref={canvasRef} tabIndex={0} aria-label="图片标注画布" className={`annotation-canvas tool-${tool}`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
              onPointerCancel={(event) => { if (event.pointerId === gestureRef.current?.pointerId) clearGesture(); }} onLostPointerCapture={(event) => { if (event.pointerId === gestureRef.current?.pointerId) clearGesture(); }}
              onDoubleClick={(event) => {
                if (disabled || isImageLoading || spaceRef.current || panRef.current || (tool !== "select" && tool !== "text")) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                const found = hitTest(historyRef.current.present, { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }, imageSize.width, imageSize.height, 7 / Math.max(scale, .001), measureText);
                if (found?.tool === "text") beginText(found);
              }} />
            {selectedBounds && !editing && <svg className="annotation-selection-overlay" viewBox={`0 0 ${displayWidth} ${displayHeight}`} aria-hidden="true" data-selected-id={selectedId}>
              <rect x={selectedBounds.left * displayWidth - 4} y={selectedBounds.top * displayHeight - 4} width={(selectedBounds.right - selectedBounds.left) * displayWidth + 8} height={(selectedBounds.bottom - selectedBounds.top) * displayHeight + 8} className="annotation-selection-box" />
              {handles.map((handle) => <rect key={handle.name} data-handle={handle.name} x={handle.point.x * displayWidth - 4} y={handle.point.y * displayHeight - 4} width={8} height={8} className="annotation-selection-handle" />)}
            </svg>}
            {editing && <div className="annotation-inline-editor" style={{ left: editLeft, top: editTop, width: Math.min(displayWidth - editLeft, Math.max(180, (editBounds!.right - editBounds!.left) * displayWidth + 20)) }}>
              <textarea ref={textareaRef} aria-label="标注文字内容" wrap="off" value={editing.action.text} maxLength={2000} disabled={disabled} rows={Math.min(8, Math.max(2, editing.action.text.split("\n").length))}
                style={{ fontSize: Math.max(10, editFont), color: editing.action.color }} placeholder="输入标注文字…"
                onChange={(event) => updateEdit({ ...editingRef.current!, action: { ...editingRef.current!.action, text: event.target.value } })}
                onBlur={() => finishText()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Escape") { event.preventDefault(); finishText(true); canvasRef.current?.focus({ preventScroll: true }); }
                  else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); finishText(); canvasRef.current?.focus({ preventScroll: true }); }
                }} />
              <small>Enter 换行 · Ctrl+Enter 完成 · Esc 取消</small>
            </div>}
          </div>
        </div>
        <footer className="annotation-footer">
          <div className="annotation-zoom-controls"><strong role="status" aria-label="图片缩放比例">{Math.round(viewport.zoom * 100)}%</strong><button type="button" onClick={resetViewport} disabled={disabled || isImageLoading || Boolean(gestureRef.current)} aria-label="重置图片缩放">适应窗口</button><small>滚轮缩放 · 按住空格或中键拖动</small></div>
          <div>{(localError || error) ? <span className="annotation-error" role="alert">{localError || error}</span> : <span>{tool === "text" ? "点击图片就地输入文字；双击已有文字可再次编辑" : "选择后拖动移动；Delete 删除；Ctrl+Z 撤销；双击文字编辑"}</span>}</div>
          <div><button type="button" className="secondary-button" onClick={onClose} disabled={disabled}>取消</button><button type="button" className="primary-button" onClick={() => void save()} disabled={disabled || isImageLoading || !baseImageRef.current}>{disabled ? "正在保存" : history.present.length === 0 && image.annotatedPath && !editing ? "恢复原图" : "保存标注"}</button></div>
        </footer>
      </section>
    </div>
  );
}
