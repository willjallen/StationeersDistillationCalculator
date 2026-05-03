import type { CanvasScene } from "./types";

export function hitTestStage(scene: CanvasScene | null, x: number, y: number) {
  if (!scene) {
    return null;
  }
  const match = scene.nodes.find(
    (node) =>
      node.stageIndex !== undefined &&
      x >= node.rect.x &&
      x <= node.rect.x + node.rect.w &&
      y >= node.rect.y &&
      y <= node.rect.y + node.rect.h,
  );
  return match?.stageIndex ?? null;
}
