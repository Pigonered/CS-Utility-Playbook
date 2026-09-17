import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { flushSync } from "react-dom";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { screenshotApi, type CaptureSession } from "../services/screenshot";
import "../screenshot.css";

interface Point {
  x: number;
  y: number;
}

interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PreparedSession extends CaptureSession {
  imageUrl: string;
}

function makeSelection(origin: Point, point: Point): SelectionRect {
  return {
    left: Math.min(origin.x, point.x),
    top: Math.min(origin.y, point.y),
    width: Math.abs(point.x - origin.x),
    height: Math.abs(point.y - origin.y),
  };
}

export function ScreenshotOverlay() {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<Point | null>(null);
  const [session, setSession] = useState<PreparedSession | null>(null);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add("capture-mode");
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let preparationId = 0;

    const prepareSession = async (nextSession: CaptureSession) => {
      const currentPreparation = ++preparationId;
      const imageUrl = convertFileSrc(nextSession.imagePath);
      const preload = new Image();
      preload.decoding = "sync";
      preload.src = imageUrl;
      try {
        await preload.decode();
        if (disposed || currentPreparation !== preparationId) return;
        flushSync(() => {
          originRef.current = null;
          setSelection(null);
          setIsCompleting(false);
          setError(null);
          setSession({ ...nextSession, imageUrl });
        });
        await screenshotApi.showOverlay();
      } catch (preloadError) {
        if (disposed || currentPreparation !== preparationId) return;
        setError(preloadError instanceof Error ? preloadError.message : "无法载入截图画面");
        await screenshotApi.cancel().catch(() => undefined);
      }
    };

    void listen<CaptureSession>("capture-ready", (event) => {
      void prepareSession(event.payload);
    }).then((stopListening) => {
      if (disposed) {
        stopListening();
        return;
      }
      unlisten = stopListening;
      void screenshotApi.getSession()
        .then(prepareSession)
        .catch(() => undefined);
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void screenshotApi.cancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("capture-mode");
      disposed = true;
      preparationId += 1;
      unlisten?.();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const pointFromEvent = (event: ReactPointerEvent<HTMLDivElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!session || isCompleting || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    originRef.current = point;
    setSelection({ left: point.x, top: point.y, width: 0, height: 0 });
    setError(null);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!originRef.current || isCompleting) return;
    setSelection(makeSelection(originRef.current, pointFromEvent(event)));
  };

  const handlePointerUp = async (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = originRef.current;
    originRef.current = null;
    if (!origin || isCompleting) return;

    const nextSelection = makeSelection(origin, pointFromEvent(event));
    if (nextSelection.width < 6 || nextSelection.height < 6) {
      setSelection(null);
      setError("请拖动鼠标选择截图区域");
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    setSelection(nextSelection);
    setIsCompleting(true);
    try {
      await screenshotApi.complete({
        x: nextSelection.left / bounds.width,
        y: nextSelection.top / bounds.height,
        width: nextSelection.width / bounds.width,
        height: nextSelection.height / bounds.height,
      });
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : "保存截图失败");
      setIsCompleting(false);
    }
  };

  return (
    <div
      ref={surfaceRef}
      className="capture-surface"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => void handlePointerUp(event)}
      onPointerCancel={() => {
        originRef.current = null;
        setSelection(null);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {session && <img className="capture-background" src={session.imageUrl} alt="" draggable={false} />}
      {!selection && <div className="capture-idle-mask" />}
      {selection && (
        <div
          className="capture-selection"
          style={{
            left: selection.left,
            top: selection.top,
            width: selection.width,
            height: selection.height,
          }}
        >
          {selection.width >= 90 && selection.height >= 38 && (
            <span>{Math.round(selection.width)} × {Math.round(selection.height)}</span>
          )}
        </div>
      )}
      <div className="capture-help">
        <strong>{isCompleting ? "正在保存截图…" : "拖动鼠标选择区域"}</strong>
        <span>按 Esc 取消</span>
      </div>
      {error && <div className="capture-error" role="alert">{error}</div>}
    </div>
  );
}
