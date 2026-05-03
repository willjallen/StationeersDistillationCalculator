import { useEffect, useRef } from "react";
import { drawCanvasScene } from "./canvas/draw";
import { hitTestStage } from "./canvas/hitTest";
import { buildPlanScene } from "./canvas/layout";
import type { CanvasScene } from "./canvas/types";
import type { PlanPayload } from "./types";

type Props = {
  plan: PlanPayload | null;
  selectedStageIndex: number | null;
  onSelectStage: (stageIndex: number) => void;
};

export function PlanCanvas({ plan, selectedStageIndex, onSelectStage }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<CanvasScene | null>(null);

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
      const scene = buildPlanScene(plan, { width: rect.width, height: rect.height }, selectedStageIndex);
      sceneRef.current = scene;
      drawCanvasScene(ctx, scene);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(host);
    return () => observer.disconnect();
  }, [plan, selectedStageIndex]);

  return (
    <canvas
      ref={canvasRef}
      className="plan-canvas"
      onClick={(event) => {
        const canvas = canvasRef.current;
        if (!canvas) {
          return;
        }
        const rect = canvas.getBoundingClientRect();
        const stageIndex = hitTestStage(
          sceneRef.current,
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
        if (stageIndex !== null) {
          onSelectStage(stageIndex);
        }
      }}
    />
  );
}
