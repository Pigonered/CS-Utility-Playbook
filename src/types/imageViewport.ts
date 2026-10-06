export interface Viewport { zoom: number; offsetX: number; offsetY: number }
export interface Size { width: number; height: number }
export const INITIAL_VIEWPORT: Viewport = { zoom: 1, offsetX: 0, offsetY: 0 };

export function constrainViewport(view: Viewport, image: Size, area: Size): Viewport {
  const zoom = Math.min(5, Math.max(.5, view.zoom));
  const limitX = Math.max(0, (image.width * zoom - area.width) / 2);
  const limitY = Math.max(0, (image.height * zoom - area.height) / 2);
  return { zoom, offsetX: Math.min(limitX, Math.max(-limitX, view.offsetX)), offsetY: Math.min(limitY, Math.max(-limitY, view.offsetY)) };
}

export function zoomViewport(view: Viewport, delta: number, pointer: { x: number; y: number }, image: Size, area: Size): Viewport {
  const zoom = Math.min(5, Math.max(.5, view.zoom * Math.exp(-Math.min(240, Math.max(-240, delta)) * .001)));
  if (zoom === view.zoom) return view;
  const ratio = zoom / view.zoom;
  return constrainViewport({ zoom, offsetX: pointer.x - (pointer.x - view.offsetX) * ratio,
    offsetY: pointer.y - (pointer.y - view.offsetY) * ratio }, image, area);
}
