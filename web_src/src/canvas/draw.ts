import { canvasTheme } from "./theme";
import { centerOf, drawRoundedRoute, lastSegmentAngle } from "./routes";
import type { CanvasScene, EdgeTone, NodeIcon, Point, Rect, SceneEdge, SceneNode } from "./types";

export function drawCanvasScene(ctx: CanvasRenderingContext2D, scene: CanvasScene) {
  ctx.clearRect(0, 0, scene.width, scene.height);
  drawGrid(ctx, scene.width, scene.height);

  if (scene.emptyMessage) {
    drawEmpty(ctx, scene);
    return;
  }

  scene.edges.forEach((edge) => drawEdge(ctx, scene, edge));
  scene.edges.forEach((edge) => drawEdgeLabel(ctx, scene, edge));
  scene.nodes.forEach((node) => drawNode(ctx, scene, node));
  drawMiniMap(ctx, scene);
  drawZoomControls(ctx, scene);
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = canvasTheme.panel;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = canvasTheme.grid;
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

function drawEmpty(ctx: CanvasRenderingContext2D, scene: CanvasScene) {
  ctx.fillStyle = canvasTheme.muted;
  ctx.font = font(scene, 15, 700);
  ctx.textAlign = "center";
  ctx.fillText(scene.emptyMessage ?? "", scene.width / 2, scene.height / 2);
}

function drawEdge(ctx: CanvasRenderingContext2D, scene: CanvasScene, edge: SceneEdge) {
  const color = canvasTheme.edge[edge.tone];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = edge.width * scene.scale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = edge.tone === "recycle" ? "rgba(69, 82, 98, 0.18)" : "rgba(15, 23, 42, 0.12)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  if (edge.dashed) {
    ctx.setLineDash([8 * scene.scale, 7 * scene.scale]);
  }
  drawRoundedRoute(ctx, edge.points, 18 * scene.scale);
  ctx.stroke();
  ctx.setLineDash([]);
  if (edge.arrow !== false) {
    drawArrowhead(ctx, edge.points, color, edge.width * scene.scale);
  }
  ctx.restore();
}

function drawArrowhead(ctx: CanvasRenderingContext2D, points: Point[], color: string, lineWidth: number) {
  const tip = points[points.length - 1];
  if (!tip) {
    return;
  }
  const angle = lastSegmentAngle(points);
  const size = Math.max(7, lineWidth + 4);
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = "transparent";
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - size * Math.cos(angle - 0.48), tip.y - size * Math.sin(angle - 0.48));
  ctx.lineTo(tip.x - size * Math.cos(angle + 0.48), tip.y - size * Math.sin(angle + 0.48));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawEdgeLabel(ctx: CanvasRenderingContext2D, scene: CanvasScene, edge: SceneEdge) {
  if (!edge.label) {
    return;
  }
  const point = edge.labelPoint ?? centerOf(edge.points);
  const scale = scene.scale;
  ctx.save();
  ctx.font = font(scene, 10, 700);
  const width = ctx.measureText(edge.label).width + 12 * scale;
  const height = 20 * scale;
  ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
  roundedRect(ctx, point.x - width / 2, point.y - height / 2, width, height, 6 * scale);
  ctx.fill();
  ctx.fillStyle = canvasTheme.muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(edge.label, point.x, point.y + 0.5 * scale);
  ctx.restore();
}

function drawNode(ctx: CanvasRenderingContext2D, scene: CanvasScene, node: SceneNode) {
  const scale = scene.scale;
  const palette = canvasTheme.node[node.tone];
  const iconSize = 24 * scale;
  const iconX = node.rect.x + 14 * scale;
  const iconY = node.rect.y + 18 * scale;
  const textX = node.rect.x + 44 * scale;
  const textWidth = node.rect.w - 55 * scale;

  ctx.save();
  ctx.shadowColor = node.selected ? "rgba(11, 140, 155, 0.18)" : "rgba(16, 24, 40, 0.08)";
  ctx.shadowBlur = node.selected ? 14 * scale : 10 * scale;
  ctx.shadowOffsetY = 4 * scale;
  ctx.fillStyle = palette.fill;
  ctx.strokeStyle = node.selected ? canvasTheme.teal : palette.stroke;
  ctx.lineWidth = node.selected ? 2 * scale : 1 * scale;
  roundedRect(ctx, node.rect.x, node.rect.y, node.rect.w, node.rect.h, 8 * scale);
  ctx.fill();
  ctx.stroke();
  ctx.shadowColor = "transparent";

  drawIcon(ctx, node.icon, iconX, iconY, iconSize, palette.accent);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = canvasTheme.ink;
  ctx.font = font(scene, node.tone === "separator" ? 11 : 10.5, 800);
  fillTrimmedText(ctx, node.title, textX, node.rect.y + 24 * scale, textWidth);

  if (node.badge) {
    drawBadge(ctx, scene, node.badge, node.rect.x + node.rect.w - 11 * scale, node.rect.y + 15 * scale);
  }

  if (node.rows?.length) {
    drawRows(ctx, scene, node);
  } else {
    ctx.fillStyle = canvasTheme.muted;
    ctx.font = font(scene, 9.5, 550);
    if (node.subtitle) {
      fillTrimmedText(ctx, node.subtitle, textX, node.rect.y + 42 * scale, textWidth);
    }
    node.lines?.slice(0, 3).forEach((line, index) => {
      fillTrimmedText(ctx, line, textX, node.rect.y + (58 + index * 13) * scale, textWidth);
    });
  }

  ctx.restore();
}

function drawRows(ctx: CanvasRenderingContext2D, scene: CanvasScene, node: SceneNode) {
  const scale = scene.scale;
  const left = node.rect.x + 18 * scale;
  const right = node.rect.x + node.rect.w - 14 * scale;
  ctx.font = font(scene, 9.5, 650);
  node.rows?.slice(0, 3).forEach((row, index) => {
    const y = node.rect.y + (52 + index * 21) * scale;
    drawMiniDroplet(ctx, left, y - 10 * scale, 12 * scale, canvasTheme.edge[row.tone as EdgeTone] ?? canvasTheme.liquid);
    ctx.fillStyle = canvasTheme.ink;
    fillTrimmedText(ctx, row.label, left + 18 * scale, y, 58 * scale);
    ctx.fillStyle = canvasTheme.muted;
    ctx.textAlign = "right";
    fillTrimmedText(ctx, row.value, right - 4 * scale, y, 62 * scale);
    ctx.textAlign = "left";
  });
  if (node.lines?.[0]) {
    ctx.fillStyle = canvasTheme.muted;
    ctx.font = font(scene, 9, 550);
    ctx.textAlign = "center";
    fillTrimmedText(ctx, node.lines[0], node.rect.x + node.rect.w / 2, node.rect.y + node.rect.h - 12 * scale, node.rect.w - 24 * scale);
    ctx.textAlign = "left";
  }
}

function drawBadge(ctx: CanvasRenderingContext2D, scene: CanvasScene, text: string, right: number, y: number) {
  ctx.save();
  ctx.font = font(scene, 8.5, 800);
  const width = ctx.measureText(text).width + 14 * scene.scale;
  const height = 20 * scene.scale;
  ctx.fillStyle = "#dff6f2";
  roundedRect(ctx, right - width, y - height / 2, width, height, 7 * scene.scale);
  ctx.fill();
  ctx.fillStyle = canvasTheme.teal;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, right - width / 2, y + 0.5 * scene.scale);
  ctx.restore();
}

function drawMiniMap(ctx: CanvasRenderingContext2D, scene: CanvasScene) {
  const scale = scene.scale;
  const x = 18 * scale;
  const y = scene.height - 132 * scale;
  const w = 205 * scale;
  const h = 112 * scale;
  const bounds = nodeBounds(scene.nodes);
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
  ctx.strokeStyle = canvasTheme.line;
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y, w, h, 8 * scale);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = canvasTheme.ink;
  ctx.font = font(scene, 10, 800);
  ctx.fillText("MINIMAP", x + 13 * scale, y + 22 * scale);
  const map = (point: Point) => ({
    x: x + 16 * scale + ((point.x - bounds.x) / bounds.w) * (w - 32 * scale),
    y: y + 38 * scale + ((point.y - bounds.y) / bounds.h) * (h - 54 * scale),
  });
  ctx.strokeStyle = "#a5b0bc";
  ctx.setLineDash([2 * scale, 2 * scale]);
  ctx.strokeRect(x + 14 * scale, y + 34 * scale, w - 28 * scale, h - 48 * scale);
  ctx.setLineDash([]);
  scene.edges.forEach((edge) => {
    ctx.strokeStyle = canvasTheme.edge[edge.tone];
    ctx.lineWidth = 1.5 * scale;
    const mapped = edge.points.map(map);
    drawRoundedRoute(ctx, mapped, 4 * scale);
    ctx.stroke();
  });
  ctx.restore();
}

function drawZoomControls(ctx: CanvasRenderingContext2D, scene: CanvasScene) {
  const scale = scene.scale;
  const x = 236 * scale;
  const y = scene.height - 110 * scale;
  const w = 34 * scale;
  const h = 98 * scale;
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
  ctx.strokeStyle = canvasTheme.line;
  roundedRect(ctx, x, y, w, h, 8 * scale);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = canvasTheme.ink;
  ctx.font = font(scene, 18, 500);
  ctx.textAlign = "center";
  ctx.fillText("+", x + w / 2, y + 26 * scale);
  ctx.fillText("-", x + w / 2, y + 58 * scale);
  ctx.strokeStyle = canvasTheme.muted;
  ctx.lineWidth = 1.5 * scale;
  const cy = y + 81 * scale;
  ctx.strokeRect(x + 10 * scale, cy - 7 * scale, 14 * scale, 14 * scale);
  ctx.restore();
}

function nodeBounds(nodes: SceneNode[]): Rect {
  if (!nodes.length) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  const minX = Math.min(...nodes.map((node) => node.rect.x));
  const minY = Math.min(...nodes.map((node) => node.rect.y));
  const maxX = Math.max(...nodes.map((node) => node.rect.x + node.rect.w));
  const maxY = Math.max(...nodes.map((node) => node.rect.y + node.rect.h));
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function drawIcon(
  ctx: CanvasRenderingContext2D,
  icon: NodeIcon,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.4, size * 0.08);
  if (icon === "feed" || icon === "separator") {
    drawCylinder(ctx, x + size * 0.18, y, size * 0.46, size * 0.86, color);
  } else if (icon === "compressor") {
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.78);
    ctx.bezierCurveTo(x + size * 0.25, y + size * 0.1, x + size * 0.52, y + size * 0.88, x + size * 0.8, y + size * 0.22);
    ctx.lineTo(x + size * 0.98, y + size * 0.75);
    ctx.lineTo(x, y + size * 0.78);
    ctx.stroke();
  } else if (icon === "cooler") {
    for (let index = 0; index < 6; index += 1) {
      const angle = (Math.PI / 3) * index;
      ctx.beginPath();
      ctx.moveTo(x + size / 2, y + size / 2);
      ctx.lineTo(x + size / 2 + Math.cos(angle) * size * 0.42, y + size / 2 + Math.sin(angle) * size * 0.42);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size * 0.16, 0, Math.PI * 2);
    ctx.stroke();
  } else if (icon === "valve") {
    ctx.beginPath();
    ctx.moveTo(x + size * 0.15, y + size * 0.1);
    ctx.lineTo(x + size * 0.5, y + size * 0.45);
    ctx.lineTo(x + size * 0.85, y + size * 0.1);
    ctx.moveTo(x + size * 0.15, y + size * 0.9);
    ctx.lineTo(x + size * 0.5, y + size * 0.55);
    ctx.lineTo(x + size * 0.85, y + size * 0.9);
    ctx.stroke();
  } else if (icon === "heater" || icon === "flame") {
    drawFlame(ctx, x, y, size, color);
  } else if (icon === "droplet") {
    drawDroplet(ctx, x + size * 0.1, y, size * 0.75, color);
  } else if (icon === "risk") {
    ctx.beginPath();
    ctx.moveTo(x + size * 0.5, y + size * 0.08);
    ctx.lineTo(x + size * 0.92, y + size * 0.86);
    ctx.lineTo(x + size * 0.08, y + size * 0.86);
    ctx.closePath();
    ctx.stroke();
    ctx.fillRect(x + size * 0.47, y + size * 0.36, size * 0.06, size * 0.27);
    ctx.fillRect(x + size * 0.47, y + size * 0.7, size * 0.06, size * 0.06);
  } else if (icon === "recycle") {
    ctx.beginPath();
    ctx.arc(x + size * 0.48, y + size * 0.48, size * 0.36, -0.4, Math.PI * 1.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + size * 0.87, y + size * 0.28);
    ctx.lineTo(x + size * 0.96, y + size * 0.56);
    ctx.lineTo(x + size * 0.7, y + size * 0.47);
    ctx.fill();
  } else if (icon === "stack") {
    drawMiniDroplet(ctx, x + size * 0.08, y, size * 0.45, color);
    drawMiniDroplet(ctx, x + size * 0.38, y + size * 0.24, size * 0.45, color);
  }
  ctx.restore();
}

function drawCylinder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h * 0.15, w / 2, h * 0.12, 0, 0, Math.PI * 2);
  ctx.moveTo(x, y + h * 0.15);
  ctx.lineTo(x, y + h * 0.82);
  ctx.ellipse(x + w / 2, y + h * 0.82, w / 2, h * 0.12, 0, 0, Math.PI);
  ctx.moveTo(x + w, y + h * 0.15);
  ctx.lineTo(x + w, y + h * 0.82);
  ctx.stroke();
}

function drawFlame(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.beginPath();
  ctx.moveTo(x + size * 0.5, y + size * 0.05);
  ctx.bezierCurveTo(x + size * 0.92, y + size * 0.42, x + size * 0.7, y + size * 0.92, x + size * 0.48, y + size * 0.94);
  ctx.bezierCurveTo(x + size * 0.08, y + size * 0.88, x + size * 0.2, y + size * 0.5, x + size * 0.43, y + size * 0.32);
  ctx.bezierCurveTo(x + size * 0.34, y + size * 0.48, x + size * 0.44, y + size * 0.6, x + size * 0.57, y + size * 0.66);
  ctx.bezierCurveTo(x + size * 0.72, y + size * 0.44, x + size * 0.58, y + size * 0.24, x + size * 0.5, y + size * 0.05);
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawDroplet(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.beginPath();
  ctx.moveTo(x + size * 0.5, y);
  ctx.bezierCurveTo(x + size, y + size * 0.52, x + size * 0.84, y + size, x + size * 0.5, y + size);
  ctx.bezierCurveTo(x + size * 0.16, y + size, x, y + size * 0.52, x + size * 0.5, y);
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawMiniDroplet(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, size * 0.13);
  drawDroplet(ctx, x, y, size, color);
  ctx.restore();
}

function fillTrimmedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y);
    return;
  }
  let length = Math.max(1, text.length - 1);
  let output = `${text.slice(0, length)}...`;
  while (length > 1 && ctx.measureText(output).width > maxWidth) {
    length -= 1;
    output = `${text.slice(0, length)}...`;
  }
  ctx.fillText(output, x, y);
}

function font(scene: CanvasScene, size: number, weight: number) {
  return `${weight} ${Math.max(8, size * scene.scale)}px Inter, ui-sans-serif, system-ui`;
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
