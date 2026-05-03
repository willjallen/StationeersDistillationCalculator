import { numberText, percentText } from "../format";
import type { PlanPayload, ProcessGraphEdge, ProcessGraphNode, Stream } from "../types";
import { centerX, centerY, makeProjector, port } from "./geometry";
import { gridRectToDesignRect, isOperationNodeKind, layoutProcessGraph, type GridPlacement } from "./gridLayout";
import type { CanvasScene, CanvasView, EdgeTone, Point, Rect, SceneEdge, SceneNode } from "./types";

const MIN_DESIGN_W = 1080;
const DESIGN_H = 730;
const DEFAULT_VIEW: CanvasView = { zoom: 1, panX: 0, panY: 0 };

type LogicalNode = {
  graphNode: ProcessGraphNode;
  rect: Rect;
  stageIndex?: number;
};

export function buildPlanScene(
  plan: PlanPayload | null,
  viewport: { width: number; height: number },
  selectedStageIndex: number | null,
  view: CanvasView = DEFAULT_VIEW,
): CanvasScene {
  if (!plan || plan.stages.length === 0 || !plan.graph?.nodes.length) {
    return {
      width: viewport.width,
      height: viewport.height,
      scale: 1,
      nodes: [],
      edges: [],
      stages: [],
      emptyMessage: "Run a plan to draw the separator network",
    };
  }

  const gridLayout = layoutProcessGraph(plan);
  const designWidth = Math.max(MIN_DESIGN_W, gridLayout.designWidth);
  const designHeight = Math.max(DESIGN_H, gridLayout.designHeight);
  const project = makeProjector(viewport.width, viewport.height, designWidth, designHeight, view.zoom, view.panX, view.panY);
  const logicalNodes = layoutGraphNodes(gridLayout.placements, project);
  const logicalById = new Map(logicalNodes.map((node) => [node.graphNode.node_id, node]));
  const sceneNodes = logicalNodes.map((node) => sceneNodeForGraphNode(node, plan, selectedStageIndex));
  const sceneEdges = buildGraphEdges(plan.graph.edges, logicalById, sortedStageNodes(plan.graph.nodes).length);

  return {
    width: viewport.width,
    height: viewport.height,
    scale: project.scale,
    nodes: sceneNodes,
    edges: sceneEdges,
    stages: plan.stages,
    layout: gridLayout.diagnostics,
  };
}

function layoutGraphNodes(
  placements: GridPlacement[],
  project: ReturnType<typeof makeProjector>,
): LogicalNode[] {
  return placements.map((placement) => ({
    graphNode: placement.graphNode,
    rect: projectDesignRect(project, gridRectToDesignRect(placement.grid)),
    stageIndex: placement.stageIndex,
  }));
}

function projectDesignRect(
  project: ReturnType<typeof makeProjector>,
  rect: Rect,
) {
  return project.rect(rect.x, rect.y, rect.w, rect.h);
}

function sceneNodeForGraphNode(
  node: LogicalNode,
  plan: PlanPayload,
  selectedStageIndex: number | null,
): SceneNode {
  const graphNode = node.graphNode;
  if (graphNode.node_kind === "source") {
    return {
      id: graphNode.node_id,
      rect: node.rect,
      tone: "feed",
      icon: "feed",
      title: "Feed",
      subtitle: `${numberText(plan.initial_stream.total_moles, 0)} mol`,
      lines: [
        `${numberText(plan.initial_stream.temperature_kelvin, 0)} K`,
        `${numberText(plan.initial_stream.pressure_kpa, 0)} kPa`,
      ],
    };
  }

  if (isOperationNode(graphNode)) {
    return {
      id: graphNode.node_id,
      rect: node.rect,
      tone: "equipment",
      icon: operationIcon(graphNode),
      title: `${pad(displayIndexForNode(graphNode, node.stageIndex))} ${operationTitle(graphNode)}`,
      subtitle: `${numberText(paramNumber(graphNode, "output_temperature_kelvin"), 0)} K`,
      lines: [operationSetpointLine(graphNode)],
      selected: node.stageIndex === selectedStageIndex,
      stageIndex: node.stageIndex,
    };
  }

  if (graphNode.node_kind === "phase_splitter") {
    return {
      id: graphNode.node_id,
      rect: node.rect,
      tone: "separator",
      icon: "separator",
      title: `${pad(node.stageIndex)} Separator`,
      subtitle: `${numberText(paramNumber(graphNode, "temperature_kelvin"), 0)} K`,
      lines: [`${numberText(paramNumber(graphNode, "pressure_kpa"), 0)} kPa`],
      selected: node.stageIndex === selectedStageIndex,
      stageIndex: node.stageIndex,
    };
  }

  if (graphNode.node_kind === "solid_risk") {
    return {
      id: graphNode.node_id,
      rect: node.rect,
      tone: "risk",
      icon: "risk",
      title: "Solid Risk",
      subtitle: `${numberText(paramNumber(graphNode, "total_moles"), 3)} mol`,
      stageIndex: node.stageIndex,
      selected: node.stageIndex === selectedStageIndex,
    };
  }

  if (graphNode.node_kind === "polishing_recycle") {
    const passes = paramNumber(graphNode, "passes");
    return {
      id: graphNode.node_id,
      rect: node.rect,
      tone: "recycle",
      icon: "recycle",
      title: `${pad(displayIndexForNode(graphNode, node.stageIndex))} Polish`,
      subtitle: passes ? `${numberText(passes, 0)} passes` : "Polishing",
      lines: [`${percentText(paramNumber(graphNode, "final_purity"), 2)} purity`],
      variant: "compact",
      stageIndex: node.stageIndex,
      selected: node.stageIndex === selectedStageIndex,
    };
  }

  if (graphNode.node_kind === "recycle" || graphNode.node_kind === "residue") {
    const isFinalResidue = graphNode.node_kind === "residue";
    return {
      id: graphNode.node_id,
      rect: node.rect,
      tone: isFinalResidue ? "risk" : "recycle",
      icon: isFinalResidue ? "risk" : "recycle",
      title: isFinalResidue
        ? "Residue"
        : `${pad(displayIndexForNode(graphNode, node.stageIndex))} Recycle`,
      subtitle: `${numberText(paramNumber(graphNode, "residue_total_moles"), 1)} mol`,
      lines: [`${numberText(paramNumber(graphNode, "temperature_kelvin"), 0)} K`],
      variant: isFinalResidue ? undefined : "compact",
      stageIndex: node.stageIndex,
      selected: node.stageIndex === selectedStageIndex,
    };
  }

  const branch = branchForNode(graphNode);
  return {
    id: graphNode.node_id,
    rect: node.rect,
    tone: branch,
    icon: branch === "gas" ? "flame" : "droplet",
    title: String(graphNode.parameters.substance ?? "Product"),
    subtitle: `${numberText(paramNumber(graphNode, "product_total_moles"), 1)} mol`,
    lines: [`${percentText(paramNumber(graphNode, "product_purity"), 0)} purity`],
    stageIndex: node.stageIndex,
    selected: node.stageIndex === selectedStageIndex,
  };
}

function buildGraphEdges(
  graphEdges: ProcessGraphEdge[],
  logicalById: Map<string, LogicalNode>,
  stageCount: number,
): SceneEdge[] {
  const sceneEdges: SceneEdge[] = [];
  graphEdges.forEach((edge, index) => {
    const source = logicalById.get(edge.source_node_id);
    const destination = logicalById.get(edge.destination_node_id);
    if (source && destination) {
      sceneEdges.push(edgeFromNodes(edge, source, destination, index, stageCount));
    }
  });
  return sceneEdges;
}

function edgeFromNodes(
  graphEdge: ProcessGraphEdge,
  source: LogicalNode,
  destination: LogicalNode,
  index: number,
  stageCount: number,
): SceneEdge {
  const tone = edgeTone(graphEdge, source.graphNode, destination.graphNode);
  const moles = graphEdge.stream?.total_moles ?? 0;
  return {
    id: `${graphEdge.source_node_id}-${graphEdge.destination_node_id}-${index}`,
    tone,
    points: routeBetween(source.rect, destination.rect),
    width: tone === "recycle" ? Math.max(1.35, pipeWidth(moles) * 0.68) : pipeWidth(moles),
    label: stageCount <= 3 && moles > 0 ? `${numberText(moles, 1)} mol` : undefined,
    labelPoint: labelPointBetween(source.rect, destination.rect),
    arrow: true,
  };
}

function routeBetween(source: Rect, destination: Rect): Point[] {
  if (destination.x >= source.x + source.w) {
    const midX = (source.x + source.w + destination.x) / 2;
    return [
      port(source, "right"),
      { x: midX, y: centerY(source) },
      { x: midX, y: centerY(destination) },
      port(destination, "left"),
    ];
  }
  if (destination.x + destination.w <= source.x) {
    const midX = (destination.x + destination.w + source.x) / 2;
    return [
      port(source, "left"),
      { x: midX, y: centerY(source) },
      { x: midX, y: centerY(destination) },
      port(destination, "right"),
    ];
  }
  if (destination.y >= source.y + source.h) {
    const midY = (source.y + source.h + destination.y) / 2;
    return [
      port(source, "bottom"),
      { x: centerX(source), y: midY },
      { x: centerX(destination), y: midY },
      port(destination, "top"),
    ];
  }
  const midX = Math.max(source.x + source.w + 28, destination.x + destination.w + 28);
  return [
    port(source, "right"),
    { x: midX, y: centerY(source) },
    { x: midX, y: centerY(destination) },
    port(destination, "right"),
  ];
}

function labelPointBetween(source: Rect, destination: Rect): Point {
  return {
    x: (centerX(source) + centerX(destination)) / 2,
    y: (centerY(source) + centerY(destination)) / 2 - 14,
  };
}

function sortedStageNodes(nodes: ProcessGraphNode[]) {
  return nodes
    .filter((node) => node.node_kind === "phase_splitter")
    .sort((left, right) => (stageIndexForNode(left) ?? 0) - (stageIndexForNode(right) ?? 0));
}

function isOperationNode(node: ProcessGraphNode) {
  return isOperationNodeKind(node.node_kind);
}

function operationTitle(node: ProcessGraphNode) {
  if (node.node_kind === "compressor") {
    return "Compressor";
  }
  if (node.node_kind === "cooler") {
    return "Cooler";
  }
  if (node.node_kind === "heater" || node.node_kind === "evaporation_heater") {
    return "Heater";
  }
  if (node.node_kind === "expansion_valve") {
    return "Expansion Valve";
  }
  if (node.node_kind === "condensation_valve") {
    return "Cond. Valve";
  }
  return "Valve";
}

function operationIcon(node: ProcessGraphNode) {
  if (node.node_kind === "compressor") {
    return "compressor";
  }
  if (node.node_kind === "cooler") {
    return "cooler";
  }
  if (node.node_kind === "heater" || node.node_kind === "evaporation_heater") {
    return "heater";
  }
  return "valve";
}

function operationSetpointLine(node: ProcessGraphNode) {
  const inputPressure = paramNumber(node, "input_pressure_kpa");
  const outputPressure = paramNumber(node, "output_pressure_kpa");
  if (inputPressure !== null && outputPressure !== null && Math.abs(outputPressure - inputPressure) > 0.25) {
    return `${numberText(inputPressure, 0)} → ${numberText(outputPressure, 0)} kPa`;
  }
  const inputTemperature = paramNumber(node, "input_temperature_kelvin");
  const outputTemperature = paramNumber(node, "output_temperature_kelvin");
  if (inputTemperature !== null && outputTemperature !== null && Math.abs(outputTemperature - inputTemperature) > 0.25) {
    return `${numberText(inputTemperature, 0)} → ${numberText(outputTemperature, 0)} K`;
  }
  return `${numberText(outputPressure, 0)} kPa`;
}

function stageIndexForNode(node: ProcessGraphNode) {
  const raw = node.parameters.stage_index;
  if (typeof raw === "number") {
    return raw;
  }
  const match = node.node_id.match(/_(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function branchForNode(node: ProcessGraphNode): "gas" | "liquid" {
  return node.parameters.selected_branch === "gas" ? "gas" : "liquid";
}

function edgeTone(
  edge: ProcessGraphEdge,
  source: ProcessGraphNode,
  destination: ProcessGraphNode,
): EdgeTone {
  if (destination.node_kind === "solid_risk") {
    return "solid";
  }
  if (destination.node_kind === "product_storage") {
    return branchForNode(destination);
  }
  if (
    destination.node_kind === "recycle" ||
    source.node_kind === "recycle" ||
    destination.node_kind === "polishing_recycle" ||
    source.node_kind === "polishing_recycle" ||
    destination.node_kind === "residue" ||
    source.node_kind === "residue" ||
    source.node_kind === "phase_splitter"
  ) {
    return "recycle";
  }
  const phase = (edge.stream as Stream | null)?.phase_hint;
  return phase === "liquid" || phase === "gas" ? phase : "recycle";
}

function paramNumber(node: ProcessGraphNode, key: string) {
  const value = node.parameters[key];
  return typeof value === "number" ? value : null;
}

function displayIndexForNode(node: ProcessGraphNode, fallback: number | undefined) {
  return paramNumber(node, "unit_index") ?? fallback;
}

function pipeWidth(moles: number) {
  const fraction = Math.max(0, moles || 0) / 100;
  return clamp(1.35 + 2.1 * Math.sqrt(fraction), 1.8, 4.05);
}

function pad(value: number | undefined) {
  return String(value ?? 0).padStart(2, "0");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
