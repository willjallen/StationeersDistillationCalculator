import type { Point, Rect } from "./types";

export type Projector = ReturnType<typeof makeProjector>;

export function makeProjector(width: number, height: number, designWidth: number, designHeight: number, zoom: number, panX: number, panY: number) {
  const baseScale = Math.min(width / designWidth, height / designHeight);
  const scale = baseScale * zoom;
  const offsetX = (width - designWidth * baseScale) / 2 + panX;
  const offsetY = (height - designHeight * baseScale) / 2 + panY;
  return {
    scale,
    x: (value: number) => offsetX + value * scale,
    y: (value: number) => offsetY + value * scale,
    point: (x: number, y: number): Point => ({
      x: offsetX + x * scale,
      y: offsetY + y * scale,
    }),
    rect: (x: number, y: number, w: number, h: number): Rect => ({
      x: offsetX + x * scale,
      y: offsetY + y * scale,
      w: w * scale,
      h: h * scale,
    }),
  };
}

export function port(rect: Rect, side: "left" | "right" | "top" | "bottom", offset = 0): Point {
  if (side === "left") {
    return { x: rect.x, y: rect.y + rect.h / 2 + offset };
  }
  if (side === "right") {
    return { x: rect.x + rect.w, y: rect.y + rect.h / 2 + offset };
  }
  if (side === "top") {
    return { x: rect.x + rect.w / 2 + offset, y: rect.y };
  }
  return { x: rect.x + rect.w / 2 + offset, y: rect.y + rect.h };
}

export function centerX(rect: Rect) {
  return rect.x + rect.w / 2;
}

export function centerY(rect: Rect) {
  return rect.y + rect.h / 2;
}
