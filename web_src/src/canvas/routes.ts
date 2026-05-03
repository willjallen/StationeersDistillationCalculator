import type { Point } from "./types";

export function drawRoundedRoute(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  radius: number,
) {
  if (points.length < 2) {
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const start = moveToward(current, previous, radius);
    const end = moveToward(current, next, radius);
    ctx.lineTo(start.x, start.y);
    ctx.quadraticCurveTo(current.x, current.y, end.x, end.y);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

export function lastSegmentAngle(points: Point[]) {
  for (let index = points.length - 1; index > 0; index -= 1) {
    const from = points[index - 1];
    const to = points[index];
    if (Math.abs(to.x - from.x) > 0.1 || Math.abs(to.y - from.y) > 0.1) {
      return Math.atan2(to.y - from.y, to.x - from.x);
    }
  }
  return 0;
}

export function centerOf(points: Point[]) {
  if (!points.length) {
    return { x: 0, y: 0 };
  }
  const total = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: total.x / points.length, y: total.y / points.length };
}

function moveToward(from: Point, to: Point, distance: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= distance || length === 0) {
    return { ...to };
  }
  return {
    x: from.x + (dx / length) * distance,
    y: from.y + (dy / length) * distance,
  };
}
