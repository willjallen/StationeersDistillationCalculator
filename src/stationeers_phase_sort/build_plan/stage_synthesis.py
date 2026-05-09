from __future__ import annotations

from stationeers_phase_sort.build_plan.models import BuildEdge, BuildNode, BuildStage
from stationeers_phase_sort.models import SearchPlan


def build_stages(
    plan: SearchPlan,
    nodes: tuple[BuildNode, ...] | list[BuildNode],
    edges: tuple[BuildEdge, ...],
) -> tuple[BuildStage, ...]:
    stages: list[BuildStage] = []
    for record in plan.product_records:
        stage_nodes = [node for node in nodes if node.stage_index == record.stage_index]
        stage_edges = [
            edge
            for edge in edges
            if _node_stage(edge.source_node_id, nodes) == record.stage_index
            or _node_stage(edge.target_node_id, nodes) == record.stage_index
        ]
        hazards = tuple(hazard for node in stage_nodes for hazard in node.hazards)
        stages.append(
            BuildStage(
                stage_index=record.stage_index,
                target_name=record.stage.target_name,
                operation_kind=record.stage.operation_kind,
                product_branch=record.stage.product_branch.value,
                endpoint_temperature_kelvin=record.stage.temperature_kelvin,
                endpoint_pressure_kpa=record.stage.pressure_kpa,
                node_ids=tuple(node.node_id for node in stage_nodes),
                edge_ids=tuple(edge.edge_id for edge in stage_edges),
                hazards=hazards,
            )
        )
    return tuple(stages)


def _node_stage(node_id: str, nodes: tuple[BuildNode, ...] | list[BuildNode]) -> int | None:
    for node in nodes:
        if node.node_id == node_id:
            return node.stage_index
    return None
