import { numberText, percentText } from "../format";
import type { PlanPayload, ProcessGraphEdge, ProcessGraphNode, Stream } from "../types";
import { centerX, centerY, makeProjector, port } from "./geometry";
import type { CanvasScene, CanvasView, EdgeTone, Point, Rect, SceneEdge, SceneNode } from "./types";

const MIN_DESIGN_W = 1080;
const DESIGN_H = 730;
const STAGES_PER_COLUMN = 5;
const DEFAULT_VIEW: CanvasView = { zoom: 1, panX: 0, panY: 0 };

type LogicalNode = {
  graphNode: ProcessGraphNode;
  rect: Rect;
  stageIndex?: number;
};

type StageSlot = {
  operation: Rect;
  separator: Rect;
  product: Rect;
  solid: Rect;
  residue: Rect;
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

  const stageNodes = sortedStageNodes(plan.graph.nodes);
  const columns = Math.max(1, Math.ceil(stageNodes.length / STAGES_PER_COLUMN));
  const designWidth = Math.max(MIN_DESIGN_W, 170 + (columns - 1) * 300 + 455);
  const project = makeProjector(viewport.width, viewport.height, designWidth, DESIGN_H, view.zoom, view.panX, view.panY);
  const logicalNodes = layoutGraphNodes(plan, project);
  const logicalById = new Map(logicalNodes.map((node) => [node.graphNode.node_id, node]));
  const sceneNodes = logicalNodes.map((node) => sceneNodeForGraphNode(node, plan, selectedStageIndex));
  const sceneEdges = buildGraphEdges(plan.graph.edges, logicalById, stageNodes.length);

  return {
    width: viewport.width,
    height: viewport.height,
    scale: project.scale,
    nodes: sceneNodes,
    edges: sceneEdges,
    stages: plan.stages,
  };
}

function layoutGraphNodes(
  plan: PlanPayload,
  project: ReturnType<typeof makeProjector>,
): LogicalNode[] {
  const stageNodes = sortedStageNodes(plan.graph.nodes);
  const stageSlots = makeStageSlots(stageNodes, project);
  const logicalNodes: LogicalNode[] = [];
  const source = plan.graph.nodes.find((node) => node.node_id === "source");
  if (source) {
    logicalNodes.push({
      graphNode: source,
      rect: sourceRect(stageNodes, project),
    });
  }

  plan.graph.nodes.forEach((node) => {
    if (node.node_id === "source") {
      return;
    }
    const stageIndex = stageIndexForNode(node);
    if (stageIndex === undefined) {
      return;
    }
    const slot = stageSlots.get(stageIndex);
    if (!slot) {
      return;
    }
    if (isOperationNode(node)) {
      logicalNodes.push({ graphNode: node, rect: slot.operation, stageIndex });
    } else if (node.node_kind === "phase_splitter") {
      logicalNodes.push({ graphNode: node, rect: slot.separator, stageIndex });
    } else if (node.node_kind === "product_storage") {
      logicalNodes.push({ graphNode: node, rect: slot.product, stageIndex });
    } else if (node.node_kind === "solid_risk") {
      logicalNodes.push({ graphNode: node, rect: slot.solid, stageIndex });
    } else if (node.node_kind === "residue") {
      logicalNodes.push({ graphNode: node, rect: slot.residue, stageIndex });
    }
  });

  return logicalNodes;
}

function makeStageSlots(
  stageNodes: ProcessGraphNode[],
  project: ReturnType<typeof makeProjector>,
) {
  if (stageNodes.length <= 8) {
    return makeReferenceStageSlots(stageNodes, project);
  }
  return makeGridStageSlots(stageNodes, project);
}

function makeGridStageSlots(
  stageNodes: ProcessGraphNode[],
  project: ReturnType<typeof makeProjector>,
) {
  const stageSlots = new Map<number, StageSlot>();
  const rowCount = Math.max(1, Math.min(STAGES_PER_COLUMN, stageNodes.length));
  const blockHeight = (rowCount - 1) * 120 + 88;
  const startY = Math.max(62, (DESIGN_H - blockHeight) / 2);

  stageNodes.forEach((stageNode, index) => {
    const stageIndex = stageIndexForNode(stageNode) ?? index + 1;
    const column = Math.floor(index / STAGES_PER_COLUMN);
    const row = index % STAGES_PER_COLUMN;
    const baseX = 170 + column * 300;
    const y = startY + row * 120;
    stageSlots.set(stageIndex, {
      operation: project.rect(baseX, y + 4, 138, 62),
      separator: project.rect(baseX + 164, y, 132, 70),
      product: project.rect(baseX + 320, y + (branchForNode(stageNode) === "liquid" ? -4 : 6), 132, 66),
      solid: project.rect(baseX + 320, y + 76, 132, 54),
      residue: project.rect(baseX + 176, y + 82, 116, 46),
    });
  });
  return stageSlots;
}

function makeReferenceStageSlots(
  stageNodes: ProcessGraphNode[],
  project: ReturnType<typeof makeProjector>,
) {
  const stageSlots = new Map<number, StageSlot>();
  const gasNodes = new Set(stageNodes.filter((node) => branchForNode(node) === "gas").map((node) => node.node_id));
  const mainGasIndex = stageIndexForNode(stageNodes.find((node) => gasNodes.has(node.node_id)) ?? stageNodes[0]);
  const stageAnchors = [
    { operation: [170, 80, 124, 62], separator: [334, 80, 124, 62], solid: [742, 532, 132, 62] },
    { operation: [170, 210, 124, 62], separator: [334, 210, 124, 62], solid: [742, 532, 132, 62] },
    { operation: [336, 300, 124, 66], separator: [510, 224, 136, 82], solid: [742, 532, 132, 62] },
    { operation: [496, 404, 124, 66], separator: [650, 404, 124, 66], solid: [742, 532, 132, 62] },
    { operation: [496, 520, 124, 62], separator: [680, 520, 124, 62], solid: [742, 532, 132, 62] },
    { operation: [642, 80, 120, 62], separator: [790, 80, 124, 62], solid: [742, 532, 132, 62] },
    { operation: [642, 210, 120, 62], separator: [790, 210, 124, 62], solid: [742, 532, 132, 62] },
    { operation: [642, 520, 120, 62], separator: [790, 520, 124, 62], solid: [742, 532, 132, 62] },
  ];
  const gasProductAnchors = [
    { x: 940, y: 140, w: 106, h: 74 },
    { x: 250, y: 414, w: 124, h: 66 },
    { x: 532, y: 520, w: 124, h: 62 },
    { x: 344, y: 520, w: 124, h: 62 },
  ];
  const liquidProductAnchors = [
    { x: 960, y: 268, w: 118, h: 70 },
    { x: 920, y: 366, w: 154, h: 86 },
    { x: 920, y: 468, w: 154, h: 76 },
    { x: 960, y: 50, w: 106, h: 70 },
    { x: 920, y: 552, w: 154, h: 62 },
  ];
  let gasIndex = 0;
  let liquidIndex = 0;

  stageNodes.forEach((stageNode, index) => {
    const stageIndex = stageIndexForNode(stageNode) ?? index + 1;
    const isGas = branchForNode(stageNode) === "gas";
    const anchor = stageAnchors[index] ?? stageAnchors[stageAnchors.length - 1];
    const product = isGas
      ? gasProductAnchors[gasIndex++] ?? gasProductAnchors[gasProductAnchors.length - 1]
      : liquidProductAnchors[liquidIndex++] ?? liquidProductAnchors[liquidProductAnchors.length - 1];
    stageSlots.set(stageIndex, slotFromAnchors(project, anchor, product));
  });

  if (mainGasIndex !== undefined) {
    const mainSlot = stageSlots.get(mainGasIndex);
    if (mainSlot) {
      stageSlots.set(mainGasIndex, {
        ...mainSlot,
        operation: project.rect(336, 300, 124, 66),
        separator: project.rect(510, 224, 136, 82),
      });
    }
  }
  return stageSlots;
}

function slotFromAnchors(
  project: ReturnType<typeof makeProjector>,
  anchor: { operation: number[]; separator: number[]; solid: number[] },
  product: { x: number; y: number; w: number; h: number },
) {
  const residue = [
    anchor.separator[0] + 8,
    anchor.separator[1] + anchor.separator[3] + 14,
    110,
    42,
  ];
  return {
    operation: project.rect(anchor.operation[0], anchor.operation[1], anchor.operation[2], anchor.operation[3]),
    separator: project.rect(anchor.separator[0], anchor.separator[1], anchor.separator[2], anchor.separator[3]),
    product: project.rect(product.x, product.y, product.w, product.h),
    solid: project.rect(anchor.solid[0], anchor.solid[1], anchor.solid[2], anchor.solid[3]),
    residue: project.rect(residue[0], residue[1], residue[2], residue[3]),
  };
}

function sourceRect(
  stageNodes: ProcessGraphNode[],
  project: ReturnType<typeof makeProjector>,
) {
  if (stageNodes.length <= 8) {
    return project.rect(18, 244, 88, 88);
  }
  const rowCount = Math.max(1, Math.min(STAGES_PER_COLUMN, stageNodes.length));
  const blockHeight = (rowCount - 1) * 120 + 88;
  const startY = Math.max(62, (DESIGN_H - blockHeight) / 2);
  const sourceY = startY + (rowCount - 1) * 60 - 44;
  return project.rect(18, Math.max(62, sourceY), 88, 88);
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

  if (graphNode.node_kind === "residue") {
    return {
      id: graphNode.node_id,
      rect: node.rect,
      tone: "recycle",
      icon: "recycle",
      title: `${pad(displayIndexForNode(graphNode, node.stageIndex))} Recycle`,
      subtitle: `${numberText(paramNumber(graphNode, "residue_total_moles"), 1)} mol`,
      lines: [`${numberText(paramNumber(graphNode, "temperature_kelvin"), 0)} K`],
      variant: "compact",
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
  return [
    "compressor",
    "cooler",
    "heater",
    "expansion_valve",
    "condensation_valve",
    "evaporation_heater",
    "conditioning_valve",
  ].includes(node.node_kind);
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
  return "Conditioning Valve";
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
  if (destination.node_kind === "residue" || source.node_kind === "residue" || source.node_kind === "phase_splitter") {
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
