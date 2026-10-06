import { arrowHeadPoints, FONT_FAMILY, textFontPixels, type AnnotationAction } from "../types/annotations";

export function drawAction(context: CanvasRenderingContext2D, action: AnnotationAction, width: number, height: number) {
  const scale = Math.max(width, height) / 1000;
  context.save();
  context.strokeStyle = action.color;
  context.fillStyle = action.color;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (action.tool === "text") {
    const font = textFontPixels(action, width, height);
    context.font = `700 ${font}px ${FONT_FAMILY}`;
    context.textBaseline = action.textBaseline === "top" ? "top" : "alphabetic";
    context.lineWidth = Math.max(2, 3 * scale);
    context.strokeStyle = "rgba(0, 0, 0, .72)";
    action.text.split("\n").forEach((line, index) => {
      const x = action.point.x * width, y = action.point.y * height + index * font * 1.3;
      context.strokeText(line, x, y);
      context.fillText(line, x, y);
    });
  } else {
    context.lineWidth = Math.max(2, action.width * scale);
    context.beginPath();
    if (action.tool === "pen") {
      const first = action.points[0];
      context.moveTo(first.x * width, first.y * height);
      action.points.slice(1).forEach((point) => context.lineTo(point.x * width, point.y * height));
      if (action.points.length === 1) {
        context.arc(first.x * width, first.y * height, context.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
        context.restore();
        return;
      }
    } else {
      const sx = action.start.x * width, sy = action.start.y * height, ex = action.end.x * width, ey = action.end.y * height;
      if (action.tool === "rect") context.rect(sx, sy, ex - sx, ey - sy);
      else if (action.tool === "circle") context.ellipse((sx + ex) / 2, (sy + ey) / 2, Math.abs(ex - sx) / 2, Math.abs(ey - sy) / 2, 0, 0, Math.PI * 2);
      else {
        context.moveTo(sx, sy);
        context.lineTo(ex, ey);
        arrowHeadPoints(action, width, height).forEach((head) => { context.moveTo(ex, ey); context.lineTo(head.x, head.y); });
      }
    }
    context.stroke();
  }
  context.restore();
}
