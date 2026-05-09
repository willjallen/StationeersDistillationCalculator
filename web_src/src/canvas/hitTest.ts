import type { CanvasScene } from "./types";

export function hitTestStage(scene: CanvasScene | null, x: number, y: number) {
  const node = hitTestNode(scene, x, y);
  return node?.stageIndex ?? null;
}

export function hitTestNode(scene: CanvasScene | null, x: number, y: number) {
  if (!scene) {
    return null;
  }
  return scene.nodes.find(
    (node) =>
      x >= node.rect.x &&
      x <= node.rect.x + node.rect.w &&
      y >= node.rect.y &&
      y <= node.rect.y + node.rect.h,
  ) ?? null;
}

export function hitTestEdge(scene: CanvasScene | null, x: number, y: number) {
  if (!scene) {
    return null;
  }
  let bestId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  scene.edges.forEach((edge) => {
    for (let index = 1; index < edge.points.length; index += 1) {
      const distance = distanceToSegment(x, y, edge.points[index - 1], edge.points[index]);
      if (distance <= 8 && distance < bestDistance) {
        bestId = edge.id;
        bestDistance = distance;
      }
    }
  });
  return bestId;
}

function distanceToSegment(
  x: number,
  y: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(x - start.x, y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared));
  return Math.hypot(x - (start.x + t * dx), y - (start.y + t * dy));
}
