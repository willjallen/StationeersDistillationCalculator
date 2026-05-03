import { useEffect, useRef } from "react";
import { numberText, percentText, shortName } from "./format";
import type { PlanPayload, Stage } from "./types";

type Box = {
  kind: "stage" | "product" | "feed" | "risk" | "residue";
  stageIndex: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
};

type Props = {
  plan: PlanPayload | null;
  selectedStageIndex: number | null;
  onSelectStage: (stageIndex: number) => void;
};

const gas = "#d89400";
const liquid = "#0c8796";
const recycle = "#667484";
const solid = "#d51b1b";
const ink = "#141b2c";

export function PlanCanvas({ plan, selectedStageIndex, onSelectStage }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxesRef = useRef<Box[]>([]);

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
      boxesRef.current = drawPlan(ctx, rect.width, rect.height, plan, selectedStageIndex);
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
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const match = boxesRef.current.find(
          (box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h,
        );
        if (match?.stageIndex !== null && match?.stageIndex !== undefined) {
          onSelectStage(match.stageIndex);
        }
      }}
    />
  );
}

function drawPlan(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  plan: PlanPayload | null,
  selectedStageIndex: number | null,
): Box[] {
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);
  if (!plan || plan.stages.length === 0) {
    drawEmpty(ctx, width, height);
    return [];
  }

  const boxes: Box[] = [];
  const stages = plan.stages.slice(0, 7);
  const left = 34;
  const right = width - 32;
  const top = 58;
  const bottom = height - 44;
  const stageX = width * 0.44;
  const productX = width * 0.75;
  const feedY = height * 0.48;
  const stageW = clamp(width * 0.14, 130, 176);
  const stageH = 64;
  const productW = clamp(width * 0.13, 128, 170);
  const total = plan.initial_stream.total_moles || 1;
  const rowGap = stages.length > 1 ? (bottom - top - stageH) / (stages.length - 1) : 0;

  const feedBox: Box = { kind: "feed", stageIndex: null, x: left, y: feedY - 34, w: 96, h: 68 };
  drawNode(ctx, feedBox, "Feed", `${numberText(total, 0)} mol`, ["294 K", "100 kPa"], "feed");
  boxes.push(feedBox);

  let previousX = feedBox.x + feedBox.w;
  let previousY = feedY;
  stages.forEach((stage, index) => {
    const stageY = top + rowGap * index;
    const stageBox: Box = {
      kind: "stage",
      stageIndex: stage.stage_index,
      x: stageX,
      y: stageY,
      w: stageW,
      h: stageH,
    };
    const stageCy = stageBox.y + stageBox.h / 2;
    drawPipe(ctx, previousX, previousY, stageBox.x, stageCy, recycle, pipeWidth(stage.feed_total_moles, total));
    drawPipeLabel(ctx, (previousX + stageBox.x) / 2 - 16, (previousY + stageCy) / 2 - 9, `${numberText(stage.feed_total_moles, 1)} mol`);
    drawStageNode(ctx, stageBox, stage, selectedStageIndex === stage.stage_index);
    boxes.push(stageBox);

    const branchColor = stage.product_branch === "gas" ? gas : liquid;
    const productY = stageCy + (index % 2 === 0 ? -40 : 36);
    const productBox: Box = {
      kind: "product",
      stageIndex: stage.stage_index,
      x: Math.min(productX + (index % 3) * 18, right - productW),
      y: clamp(productY - 30, 24, height - 92),
      w: productW,
      h: 62,
    };
    drawPipe(ctx, stageBox.x + stageBox.w, stageCy, productBox.x, productBox.y + 31, branchColor, pipeWidth(stage.product_total_moles, total));
    drawPipeLabel(ctx, stageBox.x + stageBox.w + 26, productBox.y + 18, `${numberText(stage.product_total_moles, 1)} mol`);
    drawNode(
      ctx,
      productBox,
      shortName(stage.target_name),
      `${percentText(stage.product_purity, 1)} purity`,
      [`${numberText(stage.product_total_moles, 1)} mol`],
      stage.product_branch,
    );
    boxes.push(productBox);

    if (stage.solid_risk_total_moles > 0.001) {
      const riskBox: Box = {
        kind: "risk",
        stageIndex: stage.stage_index,
        x: clamp(stageBox.x + stageBox.w + 78, 0, width - 145),
        y: clamp(height - 112 - (index % 2) * 12, 30, height - 58),
        w: 138,
        h: 50,
      };
      drawPipe(ctx, stageBox.x + stageBox.w / 2, stageCy + 18, riskBox.x, riskBox.y + 25, solid, 4);
      drawNode(ctx, riskBox, "Solid Risk", `${numberText(stage.solid_risk_total_moles, 3)} mol`, [], "risk");
      boxes.push(riskBox);
    }

    previousX = stageBox.x + 8;
    previousY = stageBox.y + stageBox.h;
    if (index < stages.length - 1) {
      const nextY = top + rowGap * (index + 1) + stageH / 2;
      const loopX = Math.max(160, stageX - 116 - (index % 2) * 18);
      drawPipe(ctx, stageBox.x + 20, stageBox.y + stageBox.h, loopX, nextY, recycle, pipeWidth(stage.residue_total_moles, total));
      drawPipe(ctx, loopX, nextY, stageX, nextY, recycle, pipeWidth(stage.residue_total_moles, total));
      drawPipeLabel(ctx, loopX - 8, nextY - 12, `${numberText(stage.residue_total_moles, 1)} mol`);
      previousX = loopX;
      previousY = nextY;
    }
  });

  drawMiniMap(ctx, width, height);
  return boxes;
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#edf1f5";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawEmpty(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = "#667085";
  ctx.font = "600 15px Inter, system-ui";
  ctx.textAlign = "center";
  ctx.fillText("Run a plan to draw the separator network", width / 2, height / 2);
}

function drawPipe(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
) {
  const cx = (x1 + x2) / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo(cx, y1, cx, y2, x2, y2);
  ctx.stroke();
  drawArrow(ctx, x1, y1, x2, y2, color, width);
  ctx.restore();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = Math.max(7, width + 4);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - 0.42), y2 - size * Math.sin(angle - 0.42));
  ctx.lineTo(x2 - size * Math.cos(angle + 0.42), y2 - size * Math.sin(angle + 0.42));
  ctx.closePath();
  ctx.fill();
}

function drawPipeLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  const metrics = ctx.measureText(text);
  roundedRect(ctx, x - 5, y - 14, metrics.width + 10, 20, 6);
  ctx.fill();
  ctx.fillStyle = "#526171";
  ctx.font = "500 10px Inter, system-ui";
  ctx.textAlign = "left";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawStageNode(ctx: CanvasRenderingContext2D, box: Box, stage: Stage, selected: boolean) {
  drawNode(
    ctx,
    box,
    `${String(stage.stage_index).padStart(2, "0")} Separator`,
    stage.target_name,
    [`${numberText(stage.temperature_kelvin, 0)} K`, `${numberText(stage.pressure_kpa, 0)} kPa`],
    "stage",
    selected,
  );
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  box: Box,
  title: string,
  subtitle: string,
  lines: string[],
  tone: "feed" | "stage" | "gas" | "liquid" | "risk" | "residue",
  selected = false,
) {
  const palette = {
    feed: ["#f9fbfb", "#d7e4e8", "#5e7680"],
    stage: ["#ffffff", selected ? "#07848c" : "#d9e2e6", "#0c8796"],
    gas: ["#fffaf0", "#f1b13a", gas],
    liquid: ["#f3fcfd", "#7bc7d0", liquid],
    risk: ["#fff7f7", "#ffaaaa", solid],
    residue: ["#f7f9fb", "#c9d2dc", recycle],
  } as const;
  const [fill, stroke, accent] = palette[tone];
  ctx.save();
  ctx.shadowColor = "rgba(16, 24, 40, 0.08)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = selected ? 2 : 1;
  roundedRect(ctx, box.x, box.y, box.w, box.h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.shadowColor = "transparent";
  drawIcon(ctx, box.x + 14, box.y + 16, accent, tone);
  ctx.fillStyle = ink;
  ctx.font = "700 12px Inter, system-ui";
  ctx.textAlign = "left";
  ctx.fillText(title, box.x + 40, box.y + 23);
  ctx.fillStyle = "#596678";
  ctx.font = "500 10px Inter, system-ui";
  ctx.fillText(subtitle, box.x + 40, box.y + 41);
  lines.slice(0, 2).forEach((line, index) => {
    ctx.fillText(line, box.x + 40, box.y + 56 + index * 13);
  });
  ctx.restore();
}

function drawIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  tone: string,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.7;
  if (tone === "gas") {
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 18);
    ctx.bezierCurveTo(x - 2, y + 7, x + 12, y + 8, x + 7, y);
    ctx.bezierCurveTo(x + 18, y + 8, x + 18, y + 18, x + 6, y + 18);
    ctx.fill();
  } else if (tone === "liquid") {
    ctx.beginPath();
    ctx.moveTo(x + 8, y);
    ctx.bezierCurveTo(x + 20, y + 13, x + 15, y + 22, x + 8, y + 22);
    ctx.bezierCurveTo(x + 1, y + 22, x - 4, y + 13, x + 8, y);
    ctx.stroke();
  } else if (tone === "risk") {
    ctx.beginPath();
    ctx.moveTo(x + 8, y);
    ctx.lineTo(x + 18, y + 18);
    ctx.lineTo(x - 2, y + 18);
    ctx.closePath();
    ctx.stroke();
    ctx.fillRect(x + 7, y + 7, 2, 6);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, 17, 22);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 5);
    ctx.lineTo(x + 13, y + 5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMiniMap(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const x = 18;
  const y = height - 116;
  const w = 188;
  const h = 92;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.strokeStyle = "#d8e0e8";
  roundedRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = "700 10px Inter, system-ui";
  ctx.fillText("MINIMAP", x + 12, y + 20);
  ctx.strokeStyle = "#9aa8b6";
  ctx.setLineDash([2, 2]);
  ctx.strokeRect(x + 14, y + 34, w - 28, h - 46);
  ctx.setLineDash([]);
  ctx.strokeStyle = liquid;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 30, y + 58);
  ctx.lineTo(x + 72, y + 58);
  ctx.lineTo(x + 106, y + 48);
  ctx.lineTo(x + 148, y + 64);
  ctx.stroke();
  ctx.strokeStyle = gas;
  ctx.beginPath();
  ctx.moveTo(x + 92, y + 58);
  ctx.lineTo(x + 134, y + 42);
  ctx.stroke();
  ctx.restore();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function pipeWidth(moles: number, total: number) {
  const fraction = Math.max(0, moles || 0) / Math.max(total, 1);
  return clamp(3 + 12 * Math.sqrt(fraction), 3.5, 13);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
