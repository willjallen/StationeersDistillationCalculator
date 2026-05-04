import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { drawCanvasScene } from "./canvas/draw";
import { hitTestStage } from "./canvas/hitTest";
import { buildPlanScene } from "./canvas/layout";
import type { CanvasScene, CanvasView } from "./canvas/types";
import { clampCanvasZoom, zoomStep } from "./canvas/zoom";
import type { PlanPayload } from "./types";

type Props = {
  plan: PlanPayload | null;
  selectedStageIndex: number | null;
  onSelectStage: (stageIndex: number) => void;
  view: CanvasView;
  onViewChange: Dispatch<SetStateAction<CanvasView>>;
};

type PointerDrag = {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
};

export function PlanCanvas({ plan, selectedStageIndex, onSelectStage, view, onViewChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<CanvasScene | null>(null);
  const dragRef = useRef<PointerDrag | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) {
      return undefined;
    }

    const draw = () => {
      const rect = host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const scene = buildPlanScene(plan, { width: rect.width, height: rect.height }, selectedStageIndex, view);
      sceneRef.current = scene;
      canvas.dataset.graphNodeCount = String(plan?.graph.nodes.length ?? 0);
      canvas.dataset.graphEdgeCount = String(plan?.graph.edges.length ?? 0);
      canvas.dataset.sceneNodeCount = String(scene.nodes.length);
      canvas.dataset.sceneEdgeCount = String(scene.edges.length);
      canvas.dataset.layoutViolations = scene.layout?.violations.join("|") ?? "";
      canvas.dataset.layoutSignature = scene.layout?.signature ?? "";
      canvas.dataset.stageTargets = scene.nodes
        .filter((node) => node.tone === "separator" && node.stageIndex !== undefined)
        .map((node) => `${node.stageIndex}:${Math.round(node.rect.x + node.rect.w / 2)},${Math.round(node.rect.y + node.rect.h / 2)}`)
        .join("|");
      canvas.dataset.sceneSignature = scene.nodes
        .map((node) =>
          [
            node.id,
            node.title,
            node.subtitle ?? "",
            node.lines?.join(",") ?? "",
            node.rows?.map((row) => `${row.label}:${row.value}:${row.tone}`).join(",") ?? "",
            String(node.stageIndex ?? ""),
            `${Math.round(node.rect.x)},${Math.round(node.rect.y)},${Math.round(node.rect.w)},${Math.round(node.rect.h)}`,
          ].join(":"),
        )
        .join("|");
      drawCanvasScene(ctx, scene);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(host);
    return () => observer.disconnect();
  }, [plan, selectedStageIndex, view]);

  function selectAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const stageIndex = hitTestStage(
      sceneRef.current,
      clientX - rect.left,
      clientY - rect.top,
    );
    if (stageIndex !== null) {
      onSelectStage(stageIndex);
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className={`plan-canvas ${dragging ? "is-panning" : ""}`}
      onPointerDown={(event) => {
        const canvas = canvasRef.current;
        if (!canvas) {
          return;
        }
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic smoke-test events do not create a browser pointer capture target.
        }
        dragRef.current = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          moved: false,
        };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.id !== event.pointerId) {
          return;
        }
        const dx = event.clientX - drag.lastX;
        const dy = event.clientY - drag.lastY;
        const totalDx = event.clientX - drag.startX;
        const totalDy = event.clientY - drag.startY;
        if (Math.hypot(totalDx, totalDy) > 3) {
          drag.moved = true;
        }
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        if (drag.moved) {
          onViewChange((current) => ({
            ...current,
            panX: current.panX + dx,
            panY: current.panY + dy,
          }));
        }
      }}
      onPointerUp={(event) => {
        const canvas = canvasRef.current;
        const drag = dragRef.current;
        if (canvas?.hasPointerCapture(event.pointerId)) {
          try {
            canvas.releasePointerCapture(event.pointerId);
          } catch {
            // Ignore capture release races from synthetic smoke-test events.
          }
        }
        dragRef.current = null;
        setDragging(false);
        if (drag && drag.id === event.pointerId && !drag.moved) {
          selectAt(event.clientX, event.clientY);
        }
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setDragging(false);
      }}
      onWheel={(event) => {
        event.preventDefault();
        const direction = event.deltaY > 0 ? -1 : 1;
        onViewChange((current) => ({
          ...current,
          zoom: clampCanvasZoom(plan, current.zoom + direction * zoomStep(plan)),
        }));
      }}
    />
  );
}
