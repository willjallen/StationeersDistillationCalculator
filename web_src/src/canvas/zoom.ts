import type { CanvasView } from "./types";
import type { PlanPayload } from "../types";
import { canonicalNodeCount } from "../buildPlanGraph";

export const fitCanvasView: CanvasView = { zoom: 1, panX: 0, panY: 0 };

export function readableCanvasView(plan: PlanPayload | null): CanvasView {
  return { zoom: readableZoomBase(plan), panX: 0, panY: 0 };
}

export function readableZoomBase(plan: PlanPayload | null) {
  const nodeCount = canonicalNodeCount(plan);
  if (nodeCount <= 0) {
    return 1;
  }
  return clamp(Math.sqrt(nodeCount / 15), 1, 2.7);
}

export function zoomStep(plan: PlanPayload | null) {
  return readableZoomBase(plan) * 0.1;
}

export function zoomPercent(plan: PlanPayload | null, view: CanvasView) {
  return Math.round((view.zoom / readableZoomBase(plan)) * 100);
}

export function clampCanvasZoom(plan: PlanPayload | null, zoom: number) {
  const base = readableZoomBase(plan);
  return clamp(zoom, Math.min(0.35, base * 0.25), base * 4);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
