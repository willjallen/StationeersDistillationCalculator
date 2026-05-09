import type { PlanPayload, ProcessGraph } from "./types";

export function canonicalGraph(plan: PlanPayload): ProcessGraph {
  if (!plan.build_plan?.nodes?.length) {
    return plan.graph;
  }
  return {
    nodes: plan.build_plan.nodes.map((node) => ({
      node_id: node.node_id,
      node_kind: node.node_kind,
      parameters: {
        ...node.parameters,
        stage_index: node.stage_index,
        role: node.role ?? node.parameters.role,
        pipe_network: node.network ?? node.parameters.pipe_network,
        equipment: node.equipment,
        label: node.label,
        ramp_blocking: node.ramp?.blocking ?? false,
        hazard_count: node.hazards.length,
        blocking_hazard_count: node.hazards.filter((hazard) => hazard.severity === "blocking").length,
        controller_count: node.controls.length,
      },
    })),
    edges: plan.build_plan.edges.map((edge) => ({
      source_node_id: edge.source_node_id,
      destination_node_id: edge.target_node_id,
      stream: edge.stream,
      parameters: {
        ...edge.parameters,
        edge_id: edge.edge_id,
        edge_kind: edge.edge_kind,
        pipe_network: edge.network ?? edge.parameters.pipe_network,
        hazard_count: edge.hazards.length,
      },
    })),
  };
}

export function canonicalNodeCount(plan: PlanPayload | null) {
  return plan ? canonicalGraph(plan).nodes.length : 0;
}

export function canonicalEdgeCount(plan: PlanPayload | null) {
  return plan ? canonicalGraph(plan).edges.length : 0;
}
