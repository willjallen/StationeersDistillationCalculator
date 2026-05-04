import type { PlanPayload, ProcessGraphEdge, ProcessGraphNode } from "../types";
import type { Rect } from "./types";

export const GRID_CELL = 12;
export const MIN_GRID_GAP = 2;

type GridNodeType = "source" | "equipment" | "separator" | "buffer" | "product" | "recycle" | "residue" | "risk";

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
  equipment: { w: 13, h: 6 },
  separator: { w: 12, h: 7 },
  buffer: { w: 11, h: 5 },
  product: { w: 12, h: 6 },
  recycle: { w: 9, h: 4 },
  residue: { w: 12, h: 5 },
  risk: { w: 12, h: 5 },
};

type StageSlot = {
  order: number;
  column: number;
  row: number;
  baseX: number;
  centerY: number;
  leafDirection: -1 | 1;
  verticalBundle: boolean;
};

export function layoutProcessGraph(plan: PlanPayload): GridLayoutResult {
  const stageNodes = sortedStageNodes(plan.graph.nodes);
  const stageCount = stageNodes.length;
  const stageGrid = stageGridForCount(stageCount);
  const designGridWidth = stageGrid.width;
  const designGridHeight = stageGrid.height;
  const centerY = Math.floor(designGridHeight / 2);
  const solver = new GridPlacementSolver(designGridWidth, designGridHeight);
  const placements: GridPlacement[] = [];
  const placementById = new Map<string, GridPlacement>();
  const incomingByDestination = new Map(plan.graph.edges.map((edge) => [edge.destination_node_id, edge]));

  const source = plan.graph.nodes.find((node) => node.node_id === "source");
  if (source) {
    placeAndTrack(
      placements,
      placementById,
      solver.place(source, "source", 2, centerY - Math.floor(NODE_SIZES.source.h / 2)),
    );
  }

  const stageOrder = new Map(stageNodes.map((node, index) => [stageIndexForNode(node) ?? index + 1, index]));
  const stageSlots = stageNodes.map((_, order) => stageSlotForOrder(order, stageCount, centerY));
  const deferredNodes: ProcessGraphNode[] = [];

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
    const slot = stageSlots[order];
    const type = typeForNode(node);
    if (type !== "equipment" && type !== "separator" && !(type === "buffer" && node.parameters.role === "feed")) {
      deferredNodes.push(node);
      return;
    }
    const preferred = preferredGridPosition(type, node, stageNode, slot);
    placeAndTrack(
      placements,
      placementById,
      solver.place(node, type, preferred.x, preferred.y, stageIndex),
    );
  });

  deferredNodes.sort(deferredNodeSort).forEach((node) => {
    const stageIndex = stageIndexForNode(node);
    if (stageIndex === undefined) {
      return;
    }
    const order = stageOrder.get(stageIndex);
    if (order === undefined) {
      return;
    }
    const stageNode = stageNodes[order];
    const slot = stageSlots[order];
    const type = typeForNode(node);
    const incoming = incomingByDestination.get(node.node_id);
    const sourcePlacement = incoming ? placementById.get(incoming.source_node_id) : undefined;
    const preferred = sourcePlacement
      ? preferredConnectedGridPosition(type, node, stageNode, slot, sourcePlacement.grid)
      : preferredGridPosition(type, node, stageNode, slot);
    placeAndTrack(
      placements,
      placementById,
      solver.place(node, type, preferred.x, preferred.y, stageIndex, searchOptionsForType(type)),
    );
  });

  placements.sort((left, right) => placementSort(left, right));
  return {
    placements,
    designWidth: designGridWidth * GRID_CELL,
    designHeight: designGridHeight * GRID_CELL,
    diagnostics: validateGridLayout(placements, plan.graph.edges),
  };
}

function placeAndTrack(
  placements: GridPlacement[],
  placementById: Map<string, GridPlacement>,
  placement: GridPlacement,
) {
  placements.push(placement);
  placementById.set(placement.graphNode.node_id, placement);
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
    "pressure_increaser",
    "pressure_decreaser",
    "cooler",
    "heater",
    "expansion_valve",
    "condensation_valve",
    "purge_valve",
    "pressurant_valve",
    "evaporation_heater",
  ].includes(nodeKind);
}

function equipmentOffset(node: ProcessGraphNode) {
  if (node.node_kind === "pressure_increaser" || node.node_kind === "pressure_decreaser") {
    return 14;
  }
  if (node.parameters.role === "setpoint_delta") {
    return 30;
  }
  if (node.node_kind === "expansion_valve") {
    return 45;
  }
  if (node.parameters.role === "phase_hold_delta") {
    return 65;
  }
  if (node.node_kind === "condensation_valve" || node.node_kind === "purge_valve" || node.node_kind === "pressurant_valve") {
    return node.parameters.role ? 65 : 30;
  }
  return 12;
}

function equipmentDirection(node: ProcessGraphNode, stageNode: ProcessGraphNode, slot: StageSlot): -1 | 0 | 1 {
  if (node.node_kind === "condensation_valve") {
    return leafDirectionForSlot(slot, "liquid");
  }
  if (node.node_kind === "purge_valve" || node.node_kind === "expansion_valve") {
    return leafDirectionForSlot(slot, "gas");
  }
  if (node.parameters.role === "phase_hold_delta") {
    return leafDirectionForSlot(slot, branchForNode(stageNode)) === 1 ? -1 : 1;
  }
  return 0;
}

function equipmentVerticalDistance(node: ProcessGraphNode) {
  if (node.node_kind === "condensation_valve" || node.node_kind === "purge_valve") {
    return 8;
  }
  if (node.parameters.role === "phase_hold_delta") {
    return 8;
  }
  return 0;
}

function preferredGridPosition(
  type: GridNodeType,
  node: ProcessGraphNode,
  stageNode: ProcessGraphNode,
  slot: StageSlot,
) {
  const size = NODE_SIZES[type];
  if (type === "equipment") {
    const offset = equipmentOffset(node);
    const direction = equipmentDirection(node, stageNode, slot);
    if (slot.verticalBundle) {
      return {
        x: slot.baseX + offset,
        y: slot.centerY + direction * equipmentVerticalDistance(node) - Math.floor(size.h / 2),
      };
    }
    return { x: slot.baseX + offset, y: slot.centerY + direction * equipmentVerticalDistance(node) - Math.floor(size.h / 2) };
  }
  if (type === "separator") {
    return {
      x: slot.baseX + (slot.verticalBundle ? 50 : 50),
      y: slot.centerY - Math.floor(size.h / 2),
    };
  }
  if (type === "buffer") {
    if (node.parameters.role === "feed") {
      return {
        x: slot.baseX,
        y: slot.centerY - Math.floor(size.h / 2),
      };
    }
    const branch = bufferBranchForNode(node);
    const direction = leafDirectionForSlot(slot, branch);
    return {
      x: slot.baseX + (slot.verticalBundle ? 82 : 82),
      y: slot.centerY + direction * 10 - Math.floor(size.h / 2),
    };
  }
  if (type === "product") {
    const direction = leafDirectionForSlot(slot, branchForNode(node));
    return {
      x: slot.baseX + (slot.verticalBundle ? 98 : 98),
      y: slot.centerY + direction * 13 - Math.floor(size.h / 2),
    };
  }
  if (type === "risk") {
    const direction = leafDirectionForSlot(slot, branchForNode(stageNode));
    return {
      x: slot.baseX + (slot.verticalBundle ? 98 : 98),
      y: slot.centerY + direction * 20 - Math.floor(size.h / 2),
    };
  }
  if (type === "residue") {
    const direction = leafDirectionForSlot(slot, branchForNode(stageNode));
    return {
      x: slot.baseX + (slot.verticalBundle ? 98 : 98),
      y: slot.centerY + direction * 20 - Math.floor(size.h / 2),
    };
  }
  if (type === "recycle") {
    const direction = node.node_kind === "polishing_recycle"
      ? leafDirectionForSlot(slot, branchForNode(stageNode))
      : -leafDirectionForSlot(slot, branchForNode(stageNode));
    return {
      x: slot.baseX + (node.node_kind === "polishing_recycle" ? 94 : 78),
      y: slot.centerY + direction * 8 - Math.floor(size.h / 2),
    };
  }
  return { x: slot.baseX, y: slot.centerY };
}

function preferredConnectedGridPosition(
  type: GridNodeType,
  node: ProcessGraphNode,
  stageNode: ProcessGraphNode,
  slot: StageSlot,
  source: GridRect,
) {
  const size = NODE_SIZES[type];
  const sourceCenterY = source.y + Math.floor(source.h / 2);
  const direction = leafDirectionForSlot(slot, branchForNode(node));
  if (type === "buffer") {
    const bufferDirection = leafDirectionForSlot(slot, bufferBranchForNode(node));
    return {
      x: source.x + source.w + 4,
      y: sourceCenterY + bufferDirection * 8 - Math.floor(size.h / 2),
    };
  }
  if (type === "product") {
    return {
      x: slot.verticalBundle ? source.x : source.x + source.w + 4,
      y: sourceCenterY + direction * 10 - Math.floor(size.h / 2),
    };
  }
  if (type === "risk" || type === "residue") {
    return {
      x: slot.verticalBundle ? source.x : source.x + source.w + 4,
      y: sourceCenterY + direction * 18 - Math.floor(size.h / 2),
    };
  }
  if (type === "recycle") {
    const recycleDirection = node.node_kind === "polishing_recycle"
      ? direction
      : -leafDirectionForSlot(slot, branchForNode(stageNode));
    return {
      x: source.x + Math.max(4, Math.floor(source.w / 2)),
      y: sourceCenterY + recycleDirection * 8 - Math.floor(size.h / 2),
    };
  }
  return preferredGridPosition(type, node, stageNode, slot);
}

function searchOptionsForType(type: GridNodeType) {
  if (type === "buffer") {
    return { xLimit: 22, yLimit: 24, verticalPenalty: 3 };
  }
  if (type === "product" || type === "risk" || type === "residue") {
    return { xLimit: 30, yLimit: 28, verticalPenalty: 4 };
  }
  if (type === "recycle") {
    return { xLimit: 18, yLimit: 24, verticalPenalty: 3 };
  }
  return undefined;
}

function validateGridLayout(placements: GridPlacement[], edges: ProcessGraphEdge[]) {
  const violations: string[] = [];
  const byId = new Map(placements.map((placement) => [placement.graphNode.node_id, placement]));
  const sizeByType = new Map<GridNodeType, string>();
  const productDistanceLimit = placements.length > 40 ? 72 : 46;

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
    const isCarryoverPath = (
      (source.type === "separator" && destination.type === "equipment")
      || (source.graphNode.parameters.role === "carryover" && (destination.type === "equipment" || destination.type === "separator"))
    );
    const isRecyclePath = source.type === "recycle" || destination.type === "recycle" || isCarryoverPath;
    if (destination.grid.x < source.grid.x && !isLeaf) {
      if (!isRecyclePath) {
        violations.push(`${edge.source_node_id}->${edge.destination_node_id} does not flow left-to-right`);
      }
    }
    if (destination.type === "product") {
      const gridDistance = Math.abs(destination.grid.x - source.grid.x) + Math.abs(destination.grid.y - source.grid.y);
      if (gridDistance > productDistanceLimit) {
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
    search: { xLimit?: number; yLimit?: number; verticalPenalty?: number } = {},
  ): GridPlacement {
    const size = NODE_SIZES[type];
    const xCandidates = unique(candidateOffsets(search.xLimit ?? 8).map((offset) => clamp(preferredX + offset, 0, this.width - size.w)));
    const yCandidates = unique(candidateOffsets(search.yLimit ?? Math.ceil(this.height / 2)).map((offset) => clamp(preferredY + offset, 0, this.height - size.h)));
    const candidates = candidatePairs(xCandidates, yCandidates, preferredX, preferredY, search.verticalPenalty ?? 1);

    for (const candidate of candidates) {
      const rect = { x: candidate.x, y: candidate.y, w: size.w, h: size.h };
      if (!this.placements.some((placement) => gridRectsTooClose(rect, placement.grid, MIN_GRID_GAP))) {
        const placement = { graphNode, stageIndex, type, grid: rect };
        this.placements.push(placement);
        return placement;
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
  if (node.node_kind === "phase_equilibrator" || node.node_kind === "phase_splitter") {
    return "separator";
  }
  if (node.node_kind === "gas_buffer" || node.node_kind === "liquid_buffer") {
    return "buffer";
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
    .filter((node) => node.node_kind === "phase_equilibrator" || node.node_kind === "phase_splitter")
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

function bufferBranchForNode(node: ProcessGraphNode): "gas" | "liquid" {
  if (node.node_kind === "gas_buffer" || node.parameters.pipe_network === "gas") {
    return "gas";
  }
  return "liquid";
}

function stageGridForCount(stageCount: number) {
  const lanes = laneCountForStageCount(stageCount);
  const columnStep = columnStepForStageCount(stageCount);
  const columns = Math.ceil(Math.max(1, stageCount) / lanes);
  return {
    width: Math.max(166, 12 + (columns - 1) * columnStep + 126),
    height: lanes === 1 ? 62 : lanes === 2 ? 96 : 118,
  };
}

function stageSlotForOrder(order: number, stageCount: number, centerY: number): StageSlot {
  const lanes = laneCountForStageCount(stageCount);
  const stagesPerLane = Math.ceil(Math.max(1, stageCount) / lanes);
  const row = lanes === 1 ? 0 : Math.min(lanes - 1, Math.floor(order / stagesPerLane));
  const column = order % stagesPerLane;
  const columnStep = columnStepForStageCount(stageCount);
  const rowOffsets = rowOffsetsForLanes(lanes);
  const verticalBundle = stageCount > 3;
  return {
    order,
    column,
    row,
    baseX: 10 + column * columnStep + row * 2,
    centerY: centerY + rowOffsets[row],
    leafDirection: leafDirectionForRow(row, lanes),
    verticalBundle,
  };
}

function laneCountForStageCount(stageCount: number) {
  if (stageCount <= 3) {
    return 1;
  }
  return stageCount <= 8 ? 2 : 3;
}

function columnStepForStageCount(stageCount: number) {
  return stageCount <= 3 ? 84 : 68;
}

function rowOffsetsForLanes(lanes: number) {
  if (lanes === 1) {
    return [0, -12, 12];
  }
  if (lanes === 2) {
    return [-22, 22];
  }
  return [-34, 0, 34];
}

function leafDirectionForRow(row: number, lanes: number): -1 | 1 {
  if (lanes === 1) {
    return -1;
  }
  if (row === 0) {
    return -1;
  }
  if (row === lanes - 1) {
    return 1;
  }
  return row % 2 === 0 ? -1 : 1;
}

function leafDirectionForSlot(slot: StageSlot, branch: "gas" | "liquid") {
  if (slot.verticalBundle) {
    return slot.leafDirection;
  }
  if (slot.row === 0) {
    return branch === "gas" ? -1 : 1;
  }
  if (slot.row === 1) {
    return branch === "gas" ? 1 : -1;
  }
  return branch === "gas" ? -1 : 1;
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

function candidatePairs(
  xCandidates: number[],
  yCandidates: number[],
  preferredX: number,
  preferredY: number,
  verticalPenalty: number,
) {
  return xCandidates
    .flatMap((x) => yCandidates.map((y) => ({ x, y })))
    .sort((left, right) =>
      candidateScore(left.x, left.y, preferredX, preferredY, verticalPenalty)
      - candidateScore(right.x, right.y, preferredX, preferredY, verticalPenalty)
      || left.x - right.x
      || left.y - right.y,
    );
}

function candidateScore(
  x: number,
  y: number,
  preferredX: number,
  preferredY: number,
  verticalPenalty: number,
) {
  return Math.abs(x - preferredX) + Math.abs(y - preferredY) * verticalPenalty;
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

function deferredNodeSort(left: ProcessGraphNode, right: ProcessGraphNode) {
  const leftRank = deferredRank(typeForNode(left));
  const rightRank = deferredRank(typeForNode(right));
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return (stageIndexForNode(left) ?? 0) - (stageIndexForNode(right) ?? 0)
    || left.node_id.localeCompare(right.node_id);
}

function deferredRank(type: GridNodeType) {
  if (type === "recycle") {
    return 0;
  }
  if (type === "product") {
    return 1;
  }
  if (type === "risk") {
    return 2;
  }
  if (type === "residue") {
    return 3;
  }
  return 4;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
