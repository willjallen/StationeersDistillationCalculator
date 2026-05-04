from __future__ import annotations

from stationeers_phase_sort.models import (
    MaterialStream,
    ProcessEdge,
    ProcessGraph,
    ProcessNode,
    ProductBranch,
    SearchPlan,
    StageEvaluation,
)
from stationeers_phase_sort.optimizer.polishing import polishing_streams_after_repeated_passes
from stationeers_phase_sort.process_graph_equipment import (
    append_expansion_transfer_if_needed,
    append_phase_equilibrator,
    append_phase_hold_operation,
    append_pressure_operation,
    append_setpoint_thermal_operation,
    append_valve_to_buffer,
    branch_streams,
    buffer_node,
    connect,
    network_for_stream,
    slug,
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

    previous_feed_node = "source"
    previous_feed_network: str | None = None
    unit_index = 1
    for record_position, record in enumerate(plan.product_records):
        stage = record.stage
        stage_index = record.stage_index
        is_final_record = record_position == len(plan.product_records) - 1
        product_node_id = f"product_{slug(stage.target_name)}"
        polishing_node_id = f"polishing_recycle_{stage_index:02d}"
        polishing_residue_node_id = f"polishing_residue_{stage_index:02d}"
        residue_node_id = f"residue_{stage_index:02d}"
        solid_risk_node_id = f"solid_risk_{stage_index:02d}"
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

        feed_network = network_for_stream(stage.feed_stream)
        current_node_id = previous_feed_node
        current_network = previous_feed_network or feed_network
        current_stream = stage.feed_stream

        if current_node_id == "source":
            feed_buffer_id = f"feed_{feed_network}_buffer_{stage_index:02d}"
            nodes.append(buffer_node(feed_buffer_id, feed_network, stage, stage.feed_stream, "feed"))
            connect(edges, "source", feed_buffer_id, stage.feed_stream, feed_network)
            current_node_id = feed_buffer_id
            current_network = feed_network

        current_node_id, current_stream, unit_index = append_pressure_operation(
            nodes,
            edges,
            current_node_id,
            current_stream,
            current_network,
            stage,
            stage_index,
            unit_index,
        )
        current_node_id, current_stream, unit_index = append_setpoint_thermal_operation(
            nodes,
            edges,
            current_node_id,
            current_stream,
            current_network,
            stage,
            stage_index,
            unit_index,
        )
        current_node_id, current_stream, current_network, unit_index = (
            append_expansion_transfer_if_needed(
                nodes,
                edges,
                current_node_id,
                current_stream,
                current_network,
                stage,
                stage_index,
                unit_index,
            )
        )

        phase_node_id, phase_stream, unit_index = append_phase_equilibrator(
            nodes,
            edges,
            current_node_id,
            current_stream,
            current_network,
            stage,
            stage_index,
            unit_index,
            record.polishing_passes_needed is not None,
            record.polishing_passes_needed,
            record.polishing_final_purity,
            record.polishing_final_yield_fraction,
        )
        branch_source_node_id, unit_index = append_phase_hold_operation(
            nodes,
            edges,
            phase_node_id,
            phase_stream,
            current_network,
            stage,
            stage_index,
            unit_index,
        )

        gas_stream, liquid_stream = branch_streams(stage)
        gas_buffer_node_id: str | None = None
        liquid_buffer_node_id: str | None = None

        if gas_stream.total_moles > 0.0:
            gas_role = "product" if stage.product_branch == ProductBranch.GAS else "carryover"
            gas_buffer_node_id, unit_index = append_valve_to_buffer(
                nodes,
                edges,
                branch_source_node_id,
                current_network,
                gas_stream,
                "gas",
                stage,
                stage_index,
                gas_role,
                unit_index,
            )

        if liquid_stream.total_moles > 0.0:
            liquid_role = "product" if stage.product_branch == ProductBranch.LIQUID else "carryover"
            liquid_buffer_node_id, unit_index = append_valve_to_buffer(
                nodes,
                edges,
                branch_source_node_id,
                current_network,
                liquid_stream,
                "liquid",
                stage,
                stage_index,
                liquid_role,
                unit_index,
            )

        product_source_node_id = (
            gas_buffer_node_id if stage.product_branch == ProductBranch.GAS else liquid_buffer_node_id
        )
        if product_source_node_id is None:
            product_source_node_id = branch_source_node_id

        if has_polishing_loop:
            nodes.append(
                ProcessNode(
                    polishing_node_id,
                    "polishing_recycle",
                    {
                        "unit_index": unit_index,
                        "stage_index": stage_index,
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
            connect(
                edges,
                product_source_node_id,
                polishing_node_id,
                stage.product_stream,
                stage.product_branch.value,
            )
            product_source_node_id = polishing_node_id

        nodes.append(
            ProcessNode(
                product_node_id,
                "product_storage",
                {
                    "stage_index": stage_index,
                    "substance": stage.target_name,
                    "selected_branch": stage.product_branch.value,
                    "product_total_moles": polished_stream.total_moles,
                    "product_purity": product_purity,
                    "pipe_network": stage.product_branch.value,
                },
            )
        )
        connect(
            edges,
            product_source_node_id,
            product_node_id,
            polished_stream,
            stage.product_branch.value,
        )

        if polishing_residue_stream.total_moles > 0.0:
            nodes.append(
                ProcessNode(
                    polishing_residue_node_id,
                    "residue",
                    {
                        "unit_index": unit_index,
                        "stage_index": stage_index,
                        "source": "polishing",
                        "target_substance": stage.target_name,
                        "residue_total_moles": polishing_residue_stream.total_moles,
                        "temperature_kelvin": polishing_residue_stream.temperature_kelvin,
                        "pressure_kpa": polishing_residue_stream.pressure_kpa,
                    },
                )
            )
            unit_index += 1
            connect(
                edges,
                polishing_node_id,
                polishing_residue_node_id,
                polishing_residue_stream,
                stage.product_branch.value,
            )

        if solid_risk_stream is not None and solid_risk_stream.total_moles > 0.0:
            nodes.append(
                ProcessNode(
                    solid_risk_node_id,
                    "solid_risk",
                    {
                        "stage_index": stage_index,
                        "total_moles": solid_risk_stream.total_moles,
                    },
                )
            )
            connect(edges, branch_source_node_id, solid_risk_node_id, solid_risk_stream, None)

        residue_source_node_id = (
            liquid_buffer_node_id if stage.product_branch == ProductBranch.GAS else gas_buffer_node_id
        )
        residue_network = "liquid" if stage.product_branch == ProductBranch.GAS else "gas"
        if stage.residue_stream.total_moles > 0.0 and is_final_record:
            nodes.append(
                ProcessNode(
                    residue_node_id,
                    "residue",
                    {
                        "unit_index": unit_index,
                        "stage_index": stage_index,
                        "residue_total_moles": stage.residue_stream.total_moles,
                        "temperature_kelvin": stage.residue_stream.temperature_kelvin,
                        "pressure_kpa": stage.residue_stream.pressure_kpa,
                        "pipe_network": residue_network,
                    },
                )
            )
            unit_index += 1
            connect(
                edges,
                residue_source_node_id or branch_source_node_id,
                residue_node_id,
                stage.residue_stream,
                residue_network,
            )

        previous_feed_node = residue_source_node_id or branch_source_node_id
        previous_feed_network = residue_network if stage.residue_stream.total_moles > 0.0 else current_network

    return ProcessGraph(nodes=tuple(nodes), edges=tuple(edges))
