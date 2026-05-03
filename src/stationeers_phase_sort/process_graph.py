from __future__ import annotations

from stationeers_phase_sort.models import (
    MaterialStream,
    ProcessEdge,
    ProcessGraph,
    ProcessNode,
    SearchPlan,
    StageEvaluation,
)
from stationeers_phase_sort.optimizer.polishing import polishing_streams_after_repeated_passes

SETPOINT_TEMPERATURE_EPSILON_KELVIN = 0.25
SETPOINT_PRESSURE_EPSILON_KPA = 0.25


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


def _equipment_kind_for_stage(stage: StageEvaluation) -> str | None:
    input_pressure = stage.feed_stream.pressure_kpa
    output_pressure = stage.pressure_kpa
    if input_pressure is not None and output_pressure is not None:
        pressure_delta = output_pressure - input_pressure
        if pressure_delta > SETPOINT_PRESSURE_EPSILON_KPA:
            return "compressor"
        if pressure_delta < -SETPOINT_PRESSURE_EPSILON_KPA:
            return (
                "condensation_valve"
                if stage.operation_kind == "condense"
                else "expansion_valve"
            )

    input_temperature = stage.feed_stream.temperature_kelvin
    output_temperature = stage.temperature_kelvin
    if input_temperature is not None and output_temperature is not None:
        temperature_delta = output_temperature - input_temperature
        if temperature_delta < -SETPOINT_TEMPERATURE_EPSILON_KELVIN:
            return "cooler"
        if temperature_delta > SETPOINT_TEMPERATURE_EPSILON_KELVIN:
            return "heater"

    return (
        "condensation_valve"
        if stage.operation_kind == "condense"
        else "expansion_valve"
        if stage.operation_kind == "evaporate"
        else None
    )


def _polishing_passes_for_graph(record_passes: int | None) -> int:
    return max(1, record_passes or 1)


def _empty_like(stream: MaterialStream) -> MaterialStream:
    return MaterialStream(
        {},
        temperature_kelvin=stream.temperature_kelvin,
        pressure_kpa=stream.pressure_kpa,
        phase_hint="empty",
    )


def plan_to_process_graph(plan: SearchPlan) -> ProcessGraph:
    nodes: list[ProcessNode] = [
        ProcessNode("source", "source"),
    ]
    edges: list[ProcessEdge] = []

    previous_residue_node = "source"
    unit_index = 1
    for record in plan.product_records:
        stage = record.stage
        stage_node_id = f"stage_{record.stage_index:02d}"
        product_node_id = f"product_{stage.target_name.lower().replace(' ', '_')}"
        polishing_node_id = f"polishing_recycle_{record.stage_index:02d}"
        polishing_residue_node_id = f"polishing_residue_{record.stage_index:02d}"
        residue_node_id = f"residue_{record.stage_index:02d}"
        solid_risk_node_id = f"solid_risk_{record.stage_index:02d}"
        solid_risk_stream = _solid_risk_stream_for_stage(stage)
        polishing_passes = _polishing_passes_for_graph(record.polishing_passes_needed)
        has_polishing_loop = polishing_passes > 1
        if has_polishing_loop:
            polished_stream, polishing_residue_stream = polishing_streams_after_repeated_passes(
                stage.product_stream,
                stage,
                polishing_passes,
            )
            product_purity = record.polishing_final_purity
        else:
            polished_stream = stage.product_stream
            polishing_residue_stream = _empty_like(stage.product_stream)
            product_purity = stage.product_purity

        equipment_kind = _equipment_kind_for_stage(stage)
        stage_input_node_id = previous_residue_node
        if equipment_kind is not None:
            operation_node_id = f"{equipment_kind}_{record.stage_index:02d}"
            nodes.append(
                ProcessNode(
                    operation_node_id,
                    equipment_kind,
                    {
                        "unit_index": unit_index,
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
            unit_index += 1
            edges.append(ProcessEdge(previous_residue_node, operation_node_id, stage.feed_stream))
            stage_input_node_id = operation_node_id

        nodes.append(
            ProcessNode(
                stage_node_id,
                "phase_splitter",
                {
                    "unit_index": unit_index,
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
        unit_index += 1
        edges.append(ProcessEdge(stage_input_node_id, stage_node_id, stage.feed_stream))

        product_source_node_id = stage_node_id
        if has_polishing_loop:
            nodes.append(
                ProcessNode(
                    polishing_node_id,
                    "polishing_recycle",
                    {
                        "unit_index": unit_index,
                        "stage_index": record.stage_index,
                        "target_substance": stage.target_name,
                        "selected_branch": stage.product_branch.value,
                        "passes": polishing_passes,
                        "input_total_moles": stage.product_stream.total_moles,
                        "output_total_moles": polished_stream.total_moles,
                        "residue_total_moles": polishing_residue_stream.total_moles,
                        "final_purity": record.polishing_final_purity,
                        "final_yield": record.polishing_final_yield_fraction,
                    },
                )
            )
            unit_index += 1
            edges.append(ProcessEdge(stage_node_id, polishing_node_id, stage.product_stream))
            product_source_node_id = polishing_node_id

        nodes.append(
            ProcessNode(
                product_node_id,
                "product_storage",
                {
                    "stage_index": record.stage_index,
                    "substance": stage.target_name,
                    "selected_branch": stage.product_branch.value,
                    "product_total_moles": polished_stream.total_moles,
                    "product_purity": product_purity,
                },
            )
        )
        edges.append(ProcessEdge(product_source_node_id, product_node_id, polished_stream))

        if polishing_residue_stream.total_moles > 0.0:
            nodes.append(
                ProcessNode(
                    polishing_residue_node_id,
                    "residue",
                    {
                        "unit_index": unit_index,
                        "stage_index": record.stage_index,
                        "source": "polishing",
                        "target_substance": stage.target_name,
                        "residue_total_moles": polishing_residue_stream.total_moles,
                        "temperature_kelvin": polishing_residue_stream.temperature_kelvin,
                        "pressure_kpa": polishing_residue_stream.pressure_kpa,
                    },
                )
            )
            unit_index += 1
            edges.append(
                ProcessEdge(
                    polishing_node_id,
                    polishing_residue_node_id,
                    polishing_residue_stream,
                )
            )

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
            residue_kind = (
                "recycle"
                if record.stage_index < len(plan.product_records)
                else "residue"
            )
            nodes.append(
                ProcessNode(
                    residue_node_id,
                    residue_kind,
                    {
                        "unit_index": unit_index,
                        "stage_index": record.stage_index,
                        "residue_total_moles": stage.residue_stream.total_moles,
                        "temperature_kelvin": stage.residue_stream.temperature_kelvin,
                        "pressure_kpa": stage.residue_stream.pressure_kpa,
                    },
                )
            )
            unit_index += 1
            edges.append(ProcessEdge(stage_node_id, residue_node_id, stage.residue_stream))
            previous_residue_node = residue_node_id

    return ProcessGraph(nodes=tuple(nodes), edges=tuple(edges))
