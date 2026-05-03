from __future__ import annotations

from stationeers_phase_sort.models import ProcessEdge, ProcessGraph, ProcessNode, SearchPlan


def plan_to_process_graph(plan: SearchPlan) -> ProcessGraph:
    nodes: list[ProcessNode] = [
        ProcessNode("source", "source"),
    ]
    edges: list[ProcessEdge] = []

    previous_residue_node = "source"
    for record in plan.product_records:
        stage = record.stage
        stage_node_id = f"stage_{record.stage_index:02d}"
        product_node_id = f"product_{stage.target_name.lower().replace(' ', '_')}"
        residue_node_id = f"residue_{record.stage_index:02d}"

        nodes.append(
            ProcessNode(
                stage_node_id,
                "phase_splitter",
                {
                    "target_substance": stage.target_name,
                    "selected_branch": stage.product_branch.value,
                    "temperature_kelvin": stage.temperature_kelvin,
                    "pressure_kpa": stage.pressure_kpa,
                    "product_purity": stage.product_purity,
                    "target_recovery": stage.target_recovery,
                },
            )
        )
        nodes.append(
            ProcessNode(product_node_id, "product_storage", {"substance": stage.target_name})
        )
        edges.append(ProcessEdge(previous_residue_node, stage_node_id, stage.feed_stream))
        edges.append(ProcessEdge(stage_node_id, product_node_id, stage.product_stream))

        if stage.residue_stream.total_moles > 0.0:
            nodes.append(ProcessNode(residue_node_id, "residue"))
            edges.append(ProcessEdge(stage_node_id, residue_node_id, stage.residue_stream))
            previous_residue_node = residue_node_id

    return ProcessGraph(nodes=tuple(nodes), edges=tuple(edges))
