import type { PlanPayload, ProcessGraphEdge, ProcessGraphNode } from "../types";
import type { Rect } from "./types";

export const GRID_CELL = 12;
export const MIN_GRID_GAP = 2;

type GridNodeType = "source" | "equipment" | "separator" | "product" | "recycle" | "residue" | "risk";

type GridRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type GridPlacement = {
  graphNode: ProcessGraphNode;
  stageIndex?: number;
  type: GridNodeType;
  grid: GridRect;
};

export type GridLayoutResult = {
  placements: GridPlacement[];
  designWidth: number;
  designHeight: number;
  diagnostics: {
    violations: string[];
    signature: string;
  };
};

const NODE_SIZES: Record<GridNodeType, { w: number; h: number }> = {
  source: { w: 7, h: 7 },
  equipment: { w: 10, h: 5 },
  separator: { w: 10, h: 6 },
  product: { w: 10, h: 5 },
  recycle: { w: 8, h: 3 },
  residue: { w: 10, h: 4 },
  risk: { w: 10, h: 4 },
};

const PRODUCT_OFFSETS = [-8, 8, -12, 12, -16, 16, -20, 20];

export function layoutProcessGraph(plan: PlanPayload): GridLayoutResult {
  const stageNodes = sortedStageNodes(plan.graph.nodes);
  const stageCount = stageNodes.length;
  const stageStep = 14;
  const designGridWidth = Math.max(90, 38 + Math.max(0, stageCount - 1) * stageStep + 14);
  const designGridHeight = Math.max(58, 44 + Math.min(18, Math.ceil(stageCount / 2) * 2));
  const centerY = Math.floor(designGridHeight / 2);
  const solver = new GridPlacementSolver(designGridWidth, designGridHeight);
  const placements: GridPlacement[] = [];

  const source = plan.graph.nodes.find((node) => node.node_id === "source");
  if (source) {
    placements.push(solver.place(source, "source", 2, centerY - Math.floor(NODE_SIZES.source.h / 2)));
  }

  const stageOrder = new Map(stageNodes.map((node, index) => [stageIndexForNode(node) ?? index + 1, index]));
  plan.graph.nodes.forEach((node) => {
    if (node.node_id === "source") {
      return;
    }
    const stageIndex = stageIndexForNode(node);
    if (stageIndex === undefined) {
      return;
    }
    const order = stageOrder.get(stageIndex);
    if (order === undefined) {
      return;
    }

    const stageNode = stageNodes[order];
    const stageY = centerY + stageLaneOffset(order, stageCount);
    const baseX = 10 + order * stageStep;
    const type = typeForNode(node);
    const preferred = preferredGridPosition(type, node, stageNode, order, baseX, stageY);
    placements.push(solver.place(node, type, preferred.x, preferred.y, stageIndex));
  });

  placements.sort((left, right) => placementSort(left, right));
  return {
    placements,
    designWidth: designGridWidth * GRID_CELL,
    designHeight: designGridHeight * GRID_CELL,
    diagnostics: validateGridLayout(placements, plan.graph.edges),
  };
}

export function gridRectToDesignRect(rect: GridRect): Rect {
  return {
    x: rect.x * GRID_CELL,
    y: rect.y * GRID_CELL,
    w: rect.w * GRID_CELL,
    h: rect.h * GRID_CELL,
  };
}

export function isOperationNodeKind(nodeKind: string) {
  return [
    "compressor",
    "cooler",
    "heater",
    "expansion_valve",
    "condensation_valve",
    "evaporation_heater",
  ].includes(nodeKind);
}

function preferredGridPosition(
  type: GridNodeType,
  node: ProcessGraphNode,
  stageNode: ProcessGraphNode,
  order: number,
  baseX: number,
  stageY: number,
) {
  const size = NODE_SIZES[type];
  if (type === "equipment") {
    return { x: baseX, y: stageY - Math.floor(size.h / 2) };
  }
  if (type === "separator") {
    return { x: baseX + 12, y: stageY - Math.floor(size.h / 2) };
  }
  if (type === "product") {
    const direction = branchForNode(node) === "gas" ? -1 : 1;
    const offset = PRODUCT_OFFSETS[order % PRODUCT_OFFSETS.length] * direction;
    return { x: baseX + 24, y: stageY + offset - Math.floor(size.h / 2) };
  }
  if (type === "risk") {
    return { x: baseX + 24, y: stageY + 9 };
  }
  if (type === "residue") {
    return { x: baseX + 24, y: stageY + 9 };
  }
  if (type === "recycle") {
    const direction = branchForNode(stageNode) === "gas" ? 1 : -1;
    return { x: baseX + 13, y: stageY + direction * 6 };
  }
  return { x: baseX, y: stageY };
}

function validateGridLayout(placements: GridPlacement[], edges: ProcessGraphEdge[]) {
  const violations: string[] = [];
  const byId = new Map(placements.map((placement) => [placement.graphNode.node_id, placement]));
  const sizeByType = new Map<GridNodeType, string>();

  placements.forEach((placement) => {
    if (!Number.isInteger(placement.grid.x) || !Number.isInteger(placement.grid.y)) {
      violations.push(`${placement.graphNode.node_id} is not snapped to grid`);
    }
    const size = `${placement.grid.w}x${placement.grid.h}`;
    const expected = sizeByType.get(placement.type);
    if (expected && expected !== size) {
      violations.push(`${placement.graphNode.node_id} has ${size}, expected ${expected} for ${placement.type}`);
    }
    sizeByType.set(placement.type, size);
  });

  for (let leftIndex = 0; leftIndex < placements.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < placements.length; rightIndex += 1) {
      const left = placements[leftIndex];
      const right = placements[rightIndex];
      if (gridRectsTooClose(left.grid, right.grid, MIN_GRID_GAP)) {
        violations.push(`${left.graphNode.node_id} too close to ${right.graphNode.node_id}`);
      }
    }
  }

  edges.forEach((edge) => {
    const source = byId.get(edge.source_node_id);
    const destination = byId.get(edge.destination_node_id);
    if (!source || !destination) {
      return;
    }
    const isLeaf = ["product", "risk", "residue"].includes(destination.type);
    if (destination.grid.x < source.grid.x && !isLeaf) {
      violations.push(`${edge.source_node_id}->${edge.destination_node_id} does not flow left-to-right`);
    }
    if (destination.type === "product") {
      const gridDistance = Math.abs(destination.grid.x - source.grid.x) + Math.abs(destination.grid.y - source.grid.y);
      if (gridDistance > 38) {
        violations.push(`${destination.graphNode.node_id} is not close to producer ${source.graphNode.node_id}`);
      }
    }
  });

  return {
    violations,
    signature: placements
      .map((placement) => `${placement.graphNode.node_id}@${placement.grid.x},${placement.grid.y}:${placement.grid.w}x${placement.grid.h}`)
      .join("|"),
  };
}

class GridPlacementSolver {
  private placements: GridPlacement[] = [];

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  place(
    graphNode: ProcessGraphNode,
    type: GridNodeType,
    preferredX: number,
    preferredY: number,
    stageIndex?: number,
  ): GridPlacement {
    const size = NODE_SIZES[type];
    const xCandidates = candidateOffsets(8).map((offset) => clamp(preferredX + offset, 0, this.width - size.w));
    const yCandidates = candidateOffsets(Math.ceil(this.height / 2)).map((offset) => clamp(preferredY + offset, 0, this.height - size.h));

    for (const x of unique(xCandidates)) {
      for (const y of unique(yCandidates)) {
        const candidate = { x, y, w: size.w, h: size.h };
        if (!this.placements.some((placement) => gridRectsTooClose(candidate, placement.grid, MIN_GRID_GAP))) {
          const placement = { graphNode, stageIndex, type, grid: candidate };
          this.placements.push(placement);
          return placement;
        }
      }
    }

    const fallback = { x: clamp(preferredX, 0, this.width - size.w), y: clamp(preferredY, 0, this.height - size.h), w: size.w, h: size.h };
    const placement = { graphNode, stageIndex, type, grid: fallback };
    this.placements.push(placement);
    return placement;
  }
}

function typeForNode(node: ProcessGraphNode): GridNodeType {
  if (node.node_kind === "source") {
    return "source";
  }
  if (isOperationNodeKind(node.node_kind)) {
    return "equipment";
  }
  if (node.node_kind === "phase_splitter") {
    return "separator";
  }
  if (node.node_kind === "product_storage") {
    return "product";
  }
  if (node.node_kind === "solid_risk") {
    return "risk";
  }
  if (node.node_kind === "residue") {
    return "residue";
  }
  return "recycle";
}

function sortedStageNodes(nodes: ProcessGraphNode[]) {
  return nodes
    .filter((node) => node.node_kind === "phase_splitter")
    .sort((left, right) => (stageIndexForNode(left) ?? 0) - (stageIndexForNode(right) ?? 0));
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

function stageLaneOffset(index: number, stageCount: number) {
  if (stageCount <= 3) {
    return [0, -10, 10][index] ?? 0;
  }
  const offsets = [0, -8, 8, -16, 16, -24, 24];
  return offsets[index % offsets.length] ?? 0;
}

function gridRectsTooClose(left: GridRect, right: GridRect, gap: number) {
  return (
    left.x < right.x + right.w + gap &&
    left.x + left.w + gap > right.x &&
    left.y < right.y + right.h + gap &&
    left.y + left.h + gap > right.y
  );
}

function candidateOffsets(limit: number) {
  const offsets = [0];
  for (let distance = 1; distance <= limit; distance += 1) {
    offsets.push(-distance, distance);
  }
  return offsets;
}

function unique(values: number[]) {
  return [...new Set(values)];
}

function placementSort(left: GridPlacement, right: GridPlacement) {
  if (left.grid.x !== right.grid.x) {
    return left.grid.x - right.grid.x;
  }
  if (left.grid.y !== right.grid.y) {
    return left.grid.y - right.grid.y;
  }
  return left.graphNode.node_id.localeCompare(right.graphNode.node_id);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
