from __future__ import annotations

import math
import re
from collections.abc import Mapping
from typing import Any, Literal, cast

from stationeers_phase_sort.build_plan.controller_synthesis import controls_for_node
from stationeers_phase_sort.build_plan.equipment import (
    EQUIPMENT_DEFINITIONS,
    concrete_node_kind,
    equipment_label,
)
from stationeers_phase_sort.build_plan.models import (
    BuildEdge,
    BuildHazard,
    BuildNode,
    BuildPlanViewModel,
    BuildStage,
    ControlRule,
    GraphParameter,
    RampAudit,
    RampPathCandidate,
    RampSample,
    SequenceStep,
    Severity,
    StreamState,
)
from stationeers_phase_sort.build_plan.ramp_audit import audit_ramp, stream_state_for
from stationeers_phase_sort.build_plan.stage_synthesis import build_stages
from stationeers_phase_sort.models import (
    ControlNoise,
    MaterialStream,
    PlannerConfig,
    ProcessEdge,
    ProcessGraph,
    ProcessNode,
    SearchPlan,
)
from stationeers_phase_sort.process_graph import plan_to_process_graph
from stationeers_phase_sort.streams import sorted_composition_items


def build_plan_view_model(
    plan: SearchPlan,
    initial_stream: MaterialStream,
    request: Mapping[str, object],
    config: PlannerConfig,
    noise: ControlNoise,
) -> BuildPlanViewModel:
    graph = plan_to_process_graph(plan)
    incoming_by_destination = _incoming_by_destination(graph)
    outgoing_by_source = _outgoing_by_source(graph)
    nodes: list[BuildNode] = []
    node_hazards: list[BuildHazard] = []
    controllers: list[ControlRule] = []

    for process_node in graph.nodes:
        build_kind = concrete_node_kind(process_node)
        stage_index = _stage_index_for_node(process_node)
        network = _node_network(process_node)
        incoming_edge = incoming_by_destination.get(process_node.node_id)
        outgoing_edge = outgoing_by_source.get(process_node.node_id)
        stream_in = incoming_edge.stream if incoming_edge is not None else initial_stream
        if process_node.node_kind == "source":
            stream_in = initial_stream
        stream_out = _output_stream_for_node(process_node, stream_in, outgoing_edge)
        state_in = (
            stream_state_for(stream_in, config, noise, network=network)
            if stream_in is not None
            else None
        )
        state_out = (
            stream_state_for(stream_out, config, noise, network=network)
            if stream_out is not None
            else None
        )
        setpoints = _setpoints_for_node(process_node)
        ramp = _ramp_for_node(
            process_node,
            build_kind,
            stream_in,
            stream_out,
            network,
            stage_index,
            config,
            noise,
        )
        hazards = tuple(
            [
                *_parameter_hazards(process_node, build_kind, stage_index),
                *(ramp.hazards if ramp is not None else tuple()),
            ]
        )
        controls = controls_for_node(
            process_node,
            build_kind,
            sensor_node_id=process_node.node_id,
        )
        controllers.extend(controls)
        node_hazards.extend(hazards)
        nodes.append(
            BuildNode(
                node_id=process_node.node_id,
                node_kind=build_kind,
                label=_label_for_node(process_node, build_kind),
                stage_index=stage_index,
                equipment=equipment_label(build_kind),
                role=_string_parameter(process_node, "role"),
                network=network,
                state_in=state_in,
                state_out=state_out,
                stream_in=stream_in,
                stream_out=stream_out,
                setpoints=setpoints,
                ramp=ramp,
                controls=controls,
                hazards=hazards,
                build_notes=_build_notes_for_node(process_node, build_kind),
                parameters=_build_parameters(process_node, build_kind, hazards),
            )
        )

    edges = tuple(
        _build_edge(edge, index, config, noise) for index, edge in enumerate(graph.edges, start=1)
    )
    all_hazards = tuple([*node_hazards, *[hazard for edge in edges for hazard in edge.hazards]])
    stages = build_stages(plan, nodes, edges)
    startup_sequence = _startup_sequence(nodes)
    shutdown_sequence = _shutdown_sequence(nodes)

    return BuildPlanViewModel(
        request=dict(request),
        assumptions=(
            "Pressure and temperature setpoints are controlled independently.",
            "Ramp safety is audited against sampled pressure/temperature paths.",
            "Python owns topology, equipment semantics, hazards, and controls.",
            "The web UI renders this build plan directly as one process board.",
        ),
        substances=tuple(initial_stream.moles_by_substance_name.keys()),
        nodes=tuple(nodes),
        edges=edges,
        stages=stages,
        controllers=tuple(controllers),
        hazards=all_hazards,
        startup_sequence=startup_sequence,
        shutdown_sequence=shutdown_sequence,
        summary={
            "node_count": len(nodes),
            "edge_count": len(edges),
            "controller_count": len(controllers),
            "hazard_count": len(all_hazards),
            "blocking_hazard_count": sum(
                1 for hazard in all_hazards if hazard.severity == "blocking"
            ),
            "warning_hazard_count": sum(
                1 for hazard in all_hazards if hazard.severity == "warning"
            ),
        },
    )


def build_plan_to_json(build_plan: BuildPlanViewModel) -> dict[str, object]:
    return {
        "request": build_plan.request,
        "assumptions": list(build_plan.assumptions),
        "substances": list(build_plan.substances),
        "nodes": [_node_to_json(node) for node in build_plan.nodes],
        "edges": [_edge_to_json(edge) for edge in build_plan.edges],
        "stages": [_build_stage_to_json(stage) for stage in build_plan.stages],
        "controllers": [_control_to_json(rule) for rule in build_plan.controllers],
        "hazards": [_hazard_to_json(hazard) for hazard in build_plan.hazards],
        "startup_sequence": [_sequence_to_json(step) for step in build_plan.startup_sequence],
        "shutdown_sequence": [_sequence_to_json(step) for step in build_plan.shutdown_sequence],
        "summary": {key: _json_value(value) for key, value in build_plan.summary.items()},
    }


def build_plan_to_process_graph_json(build_plan: BuildPlanViewModel) -> dict[str, object]:
    return {
        "nodes": [
            {
                "node_id": node.node_id,
                "node_kind": node.node_kind,
                "parameters": {key: _json_value(value) for key, value in node.parameters.items()},
            }
            for node in build_plan.nodes
        ],
        "edges": [
            {
                "source_node_id": edge.source_node_id,
                "destination_node_id": edge.target_node_id,
                "parameters": {
                    key: _json_value(value) for key, value in edge.parameters.items()
                },
                "stream": _stream_to_json(edge.stream),
            }
            for edge in build_plan.edges
        ],
    }


def _incoming_by_destination(graph: ProcessGraph) -> dict[str, ProcessEdge]:
    return {edge.destination_node_id: edge for edge in graph.edges}


def _outgoing_by_source(graph: ProcessGraph) -> dict[str, ProcessEdge]:
    outgoing: dict[str, ProcessEdge] = {}
    for edge in graph.edges:
        outgoing.setdefault(edge.source_node_id, edge)
    return outgoing


def _output_stream_for_node(
    node: ProcessNode,
    stream_in: MaterialStream | None,
    outgoing_edge: ProcessEdge | None,
) -> MaterialStream | None:
    if outgoing_edge is not None and outgoing_edge.stream is not None:
        return outgoing_edge.stream
    if stream_in is None:
        return None
    return MaterialStream(
        dict(stream_in.moles_by_substance_name),
        temperature_kelvin=(
            _number_parameter(node, "output_temperature_kelvin")
            or _number_parameter(node, "temperature_kelvin")
            or stream_in.temperature_kelvin
        ),
        pressure_kpa=(
            _number_parameter(node, "output_pressure_kpa")
            or _number_parameter(node, "setpoint_pressure_kpa")
            or _number_parameter(node, "pressure_kpa")
            or stream_in.pressure_kpa
        ),
        volume_liters=stream_in.volume_liters,
        phase_hint=cast(
            Literal["gas", "liquid", "mixed", "unknown", "empty"],
            _phase_hint_for_node(node, stream_in.phase_hint),
        ),
    ).without_tiny_entries()


def _phase_hint_for_node(node: ProcessNode, fallback: str) -> str:
    if node.node_kind == "phase_equilibrator":
        return "mixed"
    if node.node_kind == "gas_buffer":
        return "gas"
    if node.node_kind == "liquid_buffer":
        return "liquid"
    selected_branch = node.parameters.get("selected_branch")
    if node.node_kind == "product_storage" and selected_branch in {"gas", "liquid"}:
        return str(selected_branch)
    return fallback


def _ramp_for_node(
    node: ProcessNode,
    build_kind: str,
    stream_in: MaterialStream | None,
    stream_out: MaterialStream | None,
    network: str | None,
    stage_index: int | None,
    config: PlannerConfig,
    noise: ControlNoise,
) -> RampAudit | None:
    if stream_in is None or stream_out is None:
        return None
    if stream_in.temperature_kelvin is None or stream_in.pressure_kpa is None:
        return None
    if stream_out.temperature_kelvin is None or stream_out.pressure_kpa is None:
        return None
    has_delta = (
        abs(stream_in.temperature_kelvin - stream_out.temperature_kelvin) > 0.25
        or abs(stream_in.pressure_kpa - stream_out.pressure_kpa) > 0.25
    )
    phase_device = build_kind in {
        "condensation_chamber",
        "evaporation_chamber",
        "phase_separator",
    }
    if not has_delta and not phase_device:
        return None
    return audit_ramp(
        f"ramp:{node.node_id}",
        stream_in,
        config,
        noise,
        target_temperature_kelvin=stream_out.temperature_kelvin,
        target_pressure_kpa=stream_out.pressure_kpa,
        network=network,
        stage_index=stage_index,
        node_id=node.node_id,
        allow_phase_change=phase_device,
        chamber_capable=phase_device,
    )


def _build_edge(
    edge: ProcessEdge,
    index: int,
    config: PlannerConfig,
    noise: ControlNoise,
) -> BuildEdge:
    edge_id = f"edge:{index}:{edge.source_node_id}->{edge.destination_node_id}"
    network = _string_parameter_from_mapping(edge.parameters, "pipe_network")
    hazards = _edge_hazards(edge, edge_id)
    stream_state = (
        stream_state_for(edge.stream, config, noise, network=network)
        if edge.stream is not None
        else None
    )
    edge_kind = _edge_kind(edge, stream_state)
    parameters = {
        **edge.parameters,
        "edge_kind": edge_kind,
        "network": network,
        "hazard_count": len(hazards),
        "blocking_hazard_count": sum(1 for hazard in hazards if hazard.severity == "blocking"),
    }
    return BuildEdge(
        edge_id=edge_id,
        edge_kind=edge_kind,
        source_node_id=edge.source_node_id,
        target_node_id=edge.destination_node_id,
        stream=edge.stream,
        network=network,
        direction="forward",
        controlled_by=tuple(
            item
            for item in (
                _string_parameter_from_mapping(edge.parameters, "phase_transfer_device"),
            )
            if item is not None
        ),
        hazards=hazards,
        parameters=parameters,
    )


def _edge_kind(edge: ProcessEdge, state: StreamState | None) -> str:
    transfer_device = _string_parameter_from_mapping(edge.parameters, "phase_transfer_device")
    if transfer_device == "condensation_valve":
        return "drain"
    if transfer_device == "purge_valve":
        return "purge"
    if edge.parameters.get("controlled_phase_transfer") is True:
        return "mixed_stream"
    if edge.destination_node_id.startswith("polishing") or "recycle" in edge.destination_node_id:
        return "recycle"
    phase_hint = state.phase_hint if state is not None else edge.stream.phase_hint if edge.stream else None
    if phase_hint == "gas":
        return "gas_stream"
    if phase_hint == "liquid":
        return "liquid_stream"
    return "mixed_stream"


def _edge_hazards(edge: ProcessEdge, edge_id: str) -> tuple[BuildHazard, ...]:
    safety = _string_parameter_from_mapping(edge.parameters, "safety_warning")
    if not safety:
        return tuple()
    hazards: list[BuildHazard] = []
    for index, warning in enumerate(safety.split("|")):
        if not warning:
            continue
        severity: Severity = (
            "blocking" if "damage" in warning or "overpressure" in warning else "warning"
        )
        hazards.append(
            BuildHazard(
                f"{edge_id}:safety:{index}",
                warning,
                severity,
                warning.replace("_", " "),
                edge_id=edge_id,
            )
        )
    return tuple(hazards)


def _parameter_hazards(
    node: ProcessNode,
    build_kind: str,
    stage_index: int | None,
) -> tuple[BuildHazard, ...]:
    hazards: list[BuildHazard] = []
    if node.parameters.get("pressure_warning") is True:
        hazards.append(
            BuildHazard(
                f"{node.node_id}:pressure_warning",
                "overpressure",
                "blocking",
                "The planned output exceeds the normal safe pressure for this network.",
                stage_index,
                node.node_id,
            )
        )
    if build_kind not in EQUIPMENT_DEFINITIONS:
        hazards.append(
            BuildHazard(
                f"{node.node_id}:unresolved_equipment",
                "unresolved_equipment",
                "blocking",
                "This abstract operation does not yet have a buildable equipment mapping.",
                stage_index,
                node.node_id,
            )
        )
    if node.node_kind == "solid_risk":
        hazards.append(
            BuildHazard(
                f"{node.node_id}:solid_risk",
                "solid_risk",
                "blocking",
                "The plan predicts material can enter a solid-risk state here.",
                stage_index,
                node.node_id,
            )
        )
    return tuple(hazards)


def _build_parameters(
    node: ProcessNode,
    build_kind: str,
    hazards: tuple[BuildHazard, ...],
) -> dict[str, GraphParameter]:
    parameters: dict[str, GraphParameter] = dict(node.parameters)
    parameters["legacy_node_kind"] = node.node_kind
    parameters["equipment"] = equipment_label(build_kind)
    parameters["role"] = parameters.get("role") or _default_role_for_kind(build_kind)
    parameters["pipe_network"] = parameters.get("pipe_network") or _network_for_kind(build_kind)
    parameters["hazard_count"] = len(hazards)
    parameters["blocking_hazard_count"] = sum(
        1 for hazard in hazards if hazard.severity == "blocking"
    )
    return parameters


def _setpoints_for_node(node: ProcessNode) -> dict[str, GraphParameter]:
    keys = (
        "input_temperature_kelvin",
        "output_temperature_kelvin",
        "temperature_kelvin",
        "input_pressure_kpa",
        "output_pressure_kpa",
        "setpoint_pressure_kpa",
        "pressure_kpa",
        "external_heat_kj",
    )
    return {
        key: value
        for key in keys
        if (value := node.parameters.get(key)) is not None
    }


def _build_notes_for_node(node: ProcessNode, build_kind: str) -> tuple[str, ...]:
    notes: list[str] = []
    if build_kind == "heat_exchanger":
        notes.append("Use a recirculating thermal loop or bypass valve for stable trim.")
    if build_kind == "condensation_chamber":
        notes.append("Keep condensate drain enabled before feeding mixed gas.")
    if build_kind == "evaporation_chamber":
        notes.append("Keep gas purge path open to recovery while flashing liquid.")
    possible = node.parameters.get("possible_implementations")
    if isinstance(possible, str):
        notes.append(f"Acceptable implementation options: {possible}.")
    return tuple(notes)


def _startup_sequence(nodes: list[BuildNode]) -> tuple[SequenceStep, ...]:
    steps = [
        "Isolate product storage and recovery buffers.",
        "Verify all pressure and temperature sensors are reading.",
        "Pressurize any liquid coolant or liquid product networks before opening feed.",
        "Enable condensate drains and gas purge paths for phase chambers.",
        "Bring feed buffers into the planned safe pressure range.",
        "Enable thermal trim loops and confirm setpoint deadbands.",
        "Open feed regulation to the first active stage.",
        "Enable product storage trim and recovery overpressure paths.",
    ]
    return tuple(
        SequenceStep(f"startup:{index}", index, text)
        for index, text in enumerate(steps, start=1)
    )


def _shutdown_sequence(nodes: list[BuildNode]) -> tuple[SequenceStep, ...]:
    steps = [
        "Close feed source and isolate upstream buffers.",
        "Let active phase chambers finish draining and purging to recovery.",
        "Recover overpressure from product tanks into recovery buffers.",
        "Purge gas out of liquid networks where purge valves are present.",
        "Isolate product storage.",
        "Leave phase chambers at a non-blocking safe pressure and temperature.",
    ]
    return tuple(
        SequenceStep(f"shutdown:{index}", index, text)
        for index, text in enumerate(steps, start=1)
    )


def _node_to_json(node: BuildNode) -> dict[str, object]:
    return {
        "id": node.node_id,
        "kind": node.node_kind,
        "node_id": node.node_id,
        "node_kind": node.node_kind,
        "label": node.label,
        "stage_index": node.stage_index,
        "equipment": node.equipment,
        "role": node.role,
        "network": node.network,
        "state_in": _stream_state_to_json(node.state_in),
        "state_out": _stream_state_to_json(node.state_out),
        "stream_in": _stream_to_json(node.stream_in),
        "stream_out": _stream_to_json(node.stream_out),
        "setpoints": {key: _json_value(value) for key, value in node.setpoints.items()},
        "ramp": _ramp_to_json(node.ramp),
        "controls": [_control_to_json(rule) for rule in node.controls],
        "hazards": [_hazard_to_json(hazard) for hazard in node.hazards],
        "build_notes": list(node.build_notes),
        "parameters": {key: _json_value(value) for key, value in node.parameters.items()},
    }


def _edge_to_json(edge: BuildEdge) -> dict[str, object]:
    return {
        "id": edge.edge_id,
        "kind": edge.edge_kind,
        "edge_id": edge.edge_id,
        "edge_kind": edge.edge_kind,
        "source_node_id": edge.source_node_id,
        "target_node_id": edge.target_node_id,
        "destination_node_id": edge.target_node_id,
        "stream": _stream_to_json(edge.stream),
        "network": edge.network,
        "direction": edge.direction,
        "controlled_by": list(edge.controlled_by),
        "hazards": [_hazard_to_json(hazard) for hazard in edge.hazards],
        "parameters": {key: _json_value(value) for key, value in edge.parameters.items()},
    }


def _build_stage_to_json(stage: BuildStage) -> dict[str, object]:
    return {
        "stage_index": stage.stage_index,
        "target_name": stage.target_name,
        "operation_kind": stage.operation_kind,
        "product_branch": stage.product_branch,
        "endpoint_temperature_kelvin": _json_float(stage.endpoint_temperature_kelvin),
        "endpoint_pressure_kpa": _json_float(stage.endpoint_pressure_kpa),
        "node_ids": list(stage.node_ids),
        "edge_ids": list(stage.edge_ids),
        "hazards": [_hazard_to_json(hazard) for hazard in stage.hazards],
    }


def _ramp_to_json(ramp: RampAudit | None) -> dict[str, object] | None:
    if ramp is None:
        return None
    return {
        "audit_id": ramp.audit_id,
        "selected_path": ramp.selected_path,
        "candidate_paths": [_candidate_to_json(candidate) for candidate in ramp.candidate_paths],
        "samples": [_sample_to_json(sample) for sample in ramp.samples],
        "hazards": [_hazard_to_json(hazard) for hazard in ramp.hazards],
        "required_equipment": list(ramp.required_equipment),
        "required_controls": list(ramp.required_controls),
        "blocking": ramp.blocking,
    }


def _candidate_to_json(candidate: RampPathCandidate) -> dict[str, object]:
    return {
        "path_id": candidate.path_id,
        "label": candidate.label,
        "required_equipment": list(candidate.required_equipment),
        "warning_count": candidate.warning_count,
        "blocking_count": candidate.blocking_count,
        "max_liquid_fraction": _json_float(candidate.max_liquid_fraction),
        "max_gas_fraction": _json_float(candidate.max_gas_fraction),
        "max_solid_fraction": _json_float(candidate.max_solid_fraction),
        "score": _json_float(candidate.score),
    }


def _sample_to_json(sample: RampSample) -> dict[str, object]:
    return {
        "path_id": sample.path_id,
        "sample_index": sample.sample_index,
        "temperature_kelvin": _json_float(sample.temperature_kelvin),
        "pressure_kpa": _json_float(sample.pressure_kpa),
        "state": _stream_state_to_json(sample.state),
        "hazards": [_hazard_to_json(hazard) for hazard in sample.hazards],
    }


def _stream_state_to_json(state: StreamState | None) -> dict[str, object] | None:
    if state is None:
        return None
    return {
        "temperature_kelvin": _json_float(state.temperature_kelvin),
        "pressure_kpa": _json_float(state.pressure_kpa),
        "total_moles": _json_float(state.total_moles),
        "volume_liters": _json_float(state.volume_liters),
        "phase_hint": state.phase_hint,
        "network": state.network,
        "composition": {
            name: _json_float(fraction) for name, fraction in state.composition.items()
        },
        "liquid_fraction_by_name": {
            name: _json_float(value) for name, value in state.liquid_fraction_by_name.items()
        },
        "gas_fraction_by_name": {
            name: _json_float(value) for name, value in state.gas_fraction_by_name.items()
        },
        "solid_fraction_by_name": {
            name: _json_float(value) for name, value in state.solid_fraction_by_name.items()
        },
        "vapor_pressure_by_name": {
            name: _json_float(value) for name, value in state.vapor_pressure_by_name.items()
        },
        "phase_margin_by_name": {
            name: _json_float(value) for name, value in state.phase_margin_by_name.items()
        },
    }


def _control_to_json(rule: ControlRule) -> dict[str, object]:
    return {
        "id": rule.rule_id,
        "rule_id": rule.rule_id,
        "controlled_device_id": rule.controlled_device_id,
        "sensor_node_id": rule.sensor_node_id,
        "variable": rule.variable,
        "target": _json_value(rule.target),
        "deadband": _json_float(rule.deadband),
        "action": rule.action,
        "priority": rule.priority,
        "fail_safe_state": rule.fail_safe_state,
    }


def _hazard_to_json(hazard: BuildHazard) -> dict[str, object]:
    return {
        "id": hazard.hazard_id,
        "hazard_id": hazard.hazard_id,
        "kind": hazard.kind,
        "severity": hazard.severity,
        "message": hazard.message,
        "stage_index": hazard.stage_index,
        "node_id": hazard.node_id,
        "edge_id": hazard.edge_id,
        "substance_name": hazard.substance_name,
    }


def _sequence_to_json(step: SequenceStep) -> dict[str, object]:
    return {
        "id": step.step_id,
        "step_id": step.step_id,
        "order": step.order,
        "text": step.text,
        "node_id": step.node_id,
        "stage_index": step.stage_index,
    }


def _stream_to_json(stream: MaterialStream | None) -> dict[str, object] | None:
    if stream is None:
        return None
    return {
        "phase_hint": stream.phase_hint,
        "temperature_kelvin": _json_float(stream.temperature_kelvin),
        "pressure_kpa": _json_float(stream.pressure_kpa),
        "volume_liters": _json_float(stream.volume_liters),
        "total_moles": _json_float(stream.total_moles),
        "composition": [
            {
                "name": name,
                "moles": _json_float(moles),
                "fraction": _json_float(fraction),
            }
            for name, moles, fraction in sorted_composition_items(stream)
        ],
        "moles_by_substance_name": {
            name: _json_float(moles) for name, moles in stream.moles_by_substance_name.items()
        },
    }


def _json_value(value: Any) -> object:
    if isinstance(value, float):
        return _json_float(value)
    return value


def _json_float(value: float | None) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return value


def _label_for_node(node: ProcessNode, build_kind: str) -> str:
    if build_kind == "source":
        return "Feed source"
    if build_kind == "product_storage":
        return f"{node.parameters.get('substance', 'Product')} storage"
    if build_kind == "recovery_buffer":
        return "Recovery buffer"
    if build_kind == "alarm":
        return "Solid risk alarm"
    return equipment_label(build_kind)


def _node_network(node: ProcessNode) -> str | None:
    return (
        _string_parameter(node, "pipe_network")
        or _string_parameter(node, "selected_branch")
        or _network_for_kind(concrete_node_kind(node))
    )


def _network_for_kind(build_kind: str) -> str | None:
    if build_kind in {"gas_buffer", "pressure_regulator", "back_pressure_regulator"}:
        return "gas"
    if build_kind == "liquid_buffer":
        return "liquid"
    return None


def _default_role_for_kind(build_kind: str) -> str | None:
    if build_kind.endswith("_buffer"):
        return "buffer"
    if build_kind in {"condensation_valve", "purge_valve", "expansion_valve"}:
        return "phase_transfer"
    return None


def _number_parameter(node: ProcessNode, key: str) -> float | None:
    value = node.parameters.get(key)
    if isinstance(value, int | float):
        return float(value)
    return None


def _string_parameter(node: ProcessNode, key: str) -> str | None:
    return _string_parameter_from_mapping(node.parameters, key)


def _string_parameter_from_mapping(
    parameters: Mapping[str, GraphParameter],
    key: str,
) -> str | None:
    value = parameters.get(key)
    return value if isinstance(value, str) else None


def _stage_index_for_node(node: ProcessNode) -> int | None:
    value = node.parameters.get("stage_index")
    if isinstance(value, int):
        return value
    match = re.search(r"_(\d+)(?:_|$)", node.node_id)
    return int(match.group(1)) if match else None
