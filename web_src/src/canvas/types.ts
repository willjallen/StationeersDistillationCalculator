import type { Stage } from "../types";

export type Point = {
  x: number;
  y: number;
};

export type Rect = Point & {
  w: number;
  h: number;
};

export type NodeTone =
  | "feed"
  | "equipment"
  | "separator"
  | "gas"
  | "liquid"
  | "risk"
  | "recycle";

export type NodeIcon =
  | "feed"
  | "compressor"
  | "cooler"
  | "separator"
  | "valve"
  | "heater"
  | "droplet"
  | "flame"
  | "risk"
  | "recycle"
  | "stack";

export type SceneNode = {
  id: string;
  rect: Rect;
  tone: NodeTone;
  icon: NodeIcon;
  title: string;
  subtitle?: string;
  lines?: string[];
  rows?: Array<{ label: string; value: string; tone: "gas" | "liquid" | "risk" }>;
  badge?: string;
  stageIndex?: number;
  selected?: boolean;
};

export type EdgeTone = "gas" | "liquid" | "recycle" | "solid";

export type SceneEdge = {
  id: string;
  tone: EdgeTone;
  points: Point[];
  width: number;
  label?: string;
  labelPoint?: Point;
  arrow?: boolean;
  dashed?: boolean;
};

export type CanvasScene = {
  width: number;
  height: number;
  scale: number;
  nodes: SceneNode[];
  edges: SceneEdge[];
  stages: Stage[];
  emptyMessage?: string;
};
