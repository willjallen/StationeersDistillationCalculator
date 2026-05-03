from __future__ import annotations

from stationeers_phase_sort.models import (
    MaterialStream,
    ProcessEdge,
    ProcessGraph,
    ProcessNode,
    SearchPlan,
    StageEvaluation,
)


def _solid_risk_stream_for_stage(stage: StageEvaluation) -> MaterialStream | None:
    solid_moles_by_name: dict[str, float] = {}
    for name, feed_moles in stage.feed_stream.moles_by_substance_name.items():
        probability = stage.phase_probabilities_by_name.get(name)
        if probability is None or probability.solid_probability <= 0.0:
            continue
        solid_moles = max(0.0, feed_moles) * probability.solid_probability
        if solid_moles > 0.0:
            solid_moles_by_name[name] = solid_moles

    if not solid_moles_by_name:
        return None

    return MaterialStream(
        solid_moles_by_name,
        temperature_kelvin=stage.temperature_kelvin,
        pressure_kpa=stage.pressure_kpa,
        phase_hint="unknown",
    ).without_tiny_entries()


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
        solid_risk_node_id = f"solid_risk_{record.stage_index:02d}"
        solid_risk_stream = _solid_risk_stream_for_stage(stage)

        operation_kind = (
            "condensation_valve"
            if stage.operation_kind == "condense"
            else "evaporation_heater"
            if stage.operation_kind == "evaporate"
            else "conditioning_valve"
        )
        operation_node_id = f"{operation_kind}_{record.stage_index:02d}"
        nodes.append(
            ProcessNode(
                operation_node_id,
                operation_kind,
                {
                    "stage_index": record.stage_index,
                    "target_substance": stage.target_name,
                    "operation_kind": stage.operation_kind,
                    "selected_branch": stage.product_branch.value,
                    "input_temperature_kelvin": stage.feed_stream.temperature_kelvin,
                    "input_pressure_kpa": stage.feed_stream.pressure_kpa,
                    "output_temperature_kelvin": stage.temperature_kelvin,
                    "output_pressure_kpa": stage.pressure_kpa,
                },
            )
        )

        nodes.append(
            ProcessNode(
                stage_node_id,
                "phase_splitter",
                {
                    "stage_index": record.stage_index,
                    "target_substance": stage.target_name,
                    "selected_branch": stage.product_branch.value,
                    "operation_kind": stage.operation_kind,
                    "temperature_kelvin": stage.temperature_kelvin,
                    "pressure_kpa": stage.pressure_kpa,
                    "product_purity": stage.product_purity,
                    "target_recovery": stage.target_recovery,
                    "product_total_moles": stage.product_total_moles,
                    "residue_total_moles": stage.residue_total_moles,
                    "solid_risk_total_moles": stage.solid_risk_total_moles,
                    "estimated_heat_kj": (
                        stage.estimated_sensible_heat_kj + stage.estimated_latent_heat_kj
                    ),
                    "polishing_reached_target": record.polishing_passes_needed is not None,
                    "polishing_passes_needed": record.polishing_passes_needed,
                    "polishing_final_purity": record.polishing_final_purity,
                    "polishing_final_yield": record.polishing_final_yield_fraction,
                },
            )
        )
        nodes.append(
            ProcessNode(
                product_node_id,
                "product_storage",
                {
                    "stage_index": record.stage_index,
                    "substance": stage.target_name,
                    "selected_branch": stage.product_branch.value,
                    "product_total_moles": stage.product_total_moles,
                    "product_purity": stage.product_purity,
                },
            )
        )
        edges.append(ProcessEdge(previous_residue_node, operation_node_id, stage.feed_stream))
        edges.append(ProcessEdge(operation_node_id, stage_node_id, stage.feed_stream))
        edges.append(ProcessEdge(stage_node_id, product_node_id, stage.product_stream))

        if solid_risk_stream is not None and solid_risk_stream.total_moles > 0.0:
            nodes.append(
                ProcessNode(
                    solid_risk_node_id,
                    "solid_risk",
                    {
                        "stage_index": record.stage_index,
                        "total_moles": solid_risk_stream.total_moles,
                    },
                )
            )
            edges.append(ProcessEdge(stage_node_id, solid_risk_node_id, solid_risk_stream))

        if stage.residue_stream.total_moles > 0.0:
            nodes.append(
                ProcessNode(
                    residue_node_id,
                    "residue",
                    {
                        "stage_index": record.stage_index,
                        "residue_total_moles": stage.residue_stream.total_moles,
                        "temperature_kelvin": stage.residue_stream.temperature_kelvin,
                        "pressure_kpa": stage.residue_stream.pressure_kpa,
                    },
                )
            )
            edges.append(ProcessEdge(stage_node_id, residue_node_id, stage.residue_stream))
            previous_residue_node = residue_node_id

    return ProcessGraph(nodes=tuple(nodes), edges=tuple(edges))
