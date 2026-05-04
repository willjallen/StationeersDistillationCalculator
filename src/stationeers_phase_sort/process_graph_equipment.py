from __future__ import annotations

from stationeers_phase_sort.models import (
    MaterialStream,
    ProcessEdge,
    ProcessNode,
    ProductBranch,
    StageEvaluation,
)
from stationeers_phase_sort.substances import SUBSTANCES_BY_NAME

SETPOINT_TEMPERATURE_EPSILON_KELVIN = 0.25
SETPOINT_PRESSURE_EPSILON_KPA = 0.25
THERMAL_DUTY_EPSILON_KJ = 1.0e-6
LIQUID_PIPE_MAX_PRESSURE_KPA = 6000.0
GAS_PIPE_MAX_PRESSURE_KPA = 60000.0

GraphParameter = float | int | str | bool | None
GraphParameters = dict[str, GraphParameter]


def slug(value: str) -> str:
    return value.lower().replace(" ", "_")


def stream_with_state(
    stream: MaterialStream,
    *,
    temperature_kelvin: float | None = None,
    pressure_kpa: float | None = None,
    phase_hint: str | None = None,
) -> MaterialStream:
    return MaterialStream(
        dict(stream.moles_by_substance_name),
        temperature_kelvin=(
            stream.temperature_kelvin if temperature_kelvin is None else temperature_kelvin
        ),
        pressure_kpa=stream.pressure_kpa if pressure_kpa is None else pressure_kpa,
        volume_liters=stream.volume_liters,
        phase_hint=phase_hint or stream.phase_hint,
    ).without_tiny_entries()


def network_for_stream(stream: MaterialStream) -> str:
    return "liquid" if stream.phase_hint == "liquid" else "gas"


def branch_streams(stage: StageEvaluation) -> tuple[MaterialStream, MaterialStream]:
    if stage.product_branch == ProductBranch.GAS:
        return stage.product_stream, stage.residue_stream
    return stage.residue_stream, stage.product_stream


def connect(
    edges: list[ProcessEdge],
    source_node_id: str,
    destination_node_id: str,
    stream: MaterialStream | None,
    pipe_network: str | None = None,
    *,
    controlled_phase_transfer: bool = False,
    transfer_device: str | None = None,
) -> None:
    edges.append(
        ProcessEdge(
            source_node_id,
            destination_node_id,
            stream,
            _edge_parameters(
                stream,
                pipe_network,
                controlled_phase_transfer=controlled_phase_transfer,
                transfer_device=transfer_device,
            ),
        )
    )


def buffer_node(
    node_id: str,
    pipe_network: str,
    stage: StageEvaluation,
    stream: MaterialStream,
    role: str,
) -> ProcessNode:
    return ProcessNode(
        node_id,
        f"{pipe_network}_buffer",
        {
            "stage_index": _stage_index_from_node_id(node_id),
            "role": role,
            "pipe_network": pipe_network,
            "phase_hint": stream.phase_hint,
            "total_moles": stream.total_moles,
            "temperature_kelvin": stream.temperature_kelvin,
            "pressure_kpa": stream.pressure_kpa,
            "max_safe_pressure_kpa": _max_safe_pressure_kpa(pipe_network),
            "pressure_warning": (
                pipe_network == "liquid"
                and stream.pressure_kpa is not None
                and stream.pressure_kpa > LIQUID_PIPE_MAX_PRESSURE_KPA
            ),
            "target_substance": stage.target_name,
        },
    )


def append_pressure_operation(
    nodes: list[ProcessNode],
    edges: list[ProcessEdge],
    current_node_id: str,
    current_stream: MaterialStream,
    current_network: str,
    stage: StageEvaluation,
    stage_index: int,
    unit_index: int,
) -> tuple[str, MaterialStream, int]:
    input_pressure = current_stream.pressure_kpa
    output_pressure = stage.pressure_kpa
    if input_pressure is None or abs(output_pressure - input_pressure) <= SETPOINT_PRESSURE_EPSILON_KPA:
        return current_node_id, current_stream, unit_index

    pressure_delta = output_pressure - input_pressure
    node_kind = "pressure_increaser" if pressure_delta > 0.0 else "pressure_decreaser"
    operation_node_id = f"{node_kind}_{stage_index:02d}"
    output_stream = stream_with_state(current_stream, pressure_kpa=output_pressure)
    nodes.append(
        ProcessNode(
            operation_node_id,
            node_kind,
            {
                "unit_index": unit_index,
                "stage_index": stage_index,
                "target_substance": stage.target_name,
                "operation_kind": stage.operation_kind,
                "selected_branch": stage.product_branch.value,
                "abstract_operation": True,
                "input_pressure_kpa": input_pressure,
                "output_pressure_kpa": output_pressure,
                "delta_pressure_kpa": pressure_delta,
                "native_temperature_delta_kelvin": 0.0,
                "pipe_network": current_network,
                "possible_implementations": (
                    "Volume Pump; Pressure Regulator; Pressurant Valve"
                    if pressure_delta > 0.0
                    else "Back Pressure Regulator; Pressure Regulator; Volume Pump"
                ),
            },
        )
    )
    connect(edges, current_node_id, operation_node_id, current_stream, current_network)
    return operation_node_id, output_stream, unit_index + 1


def append_setpoint_thermal_operation(
    nodes: list[ProcessNode],
    edges: list[ProcessEdge],
    current_node_id: str,
    current_stream: MaterialStream,
    current_network: str,
    stage: StageEvaluation,
    stage_index: int,
    unit_index: int,
) -> tuple[str, MaterialStream, int]:
    input_temperature = current_stream.temperature_kelvin
    output_temperature = stage.temperature_kelvin
    if (
        input_temperature is None
        or abs(output_temperature - input_temperature) <= SETPOINT_TEMPERATURE_EPSILON_KELVIN
    ):
        return current_node_id, current_stream, unit_index

    temperature_delta = output_temperature - input_temperature
    node_kind = "heater" if temperature_delta > 0.0 else "cooler"
    operation_node_id = f"setpoint_{node_kind}_{stage_index:02d}"
    output_stream = stream_with_state(current_stream, temperature_kelvin=output_temperature)
    nodes.append(
        ProcessNode(
            operation_node_id,
            node_kind,
            {
                "unit_index": unit_index,
                "stage_index": stage_index,
                "role": "setpoint_delta",
                "target_substance": stage.target_name,
                "operation_kind": stage.operation_kind,
                "selected_branch": stage.product_branch.value,
                "abstract_operation": True,
                "input_temperature_kelvin": input_temperature,
                "output_temperature_kelvin": output_temperature,
                "delta_temperature_kelvin": temperature_delta,
                "external_heat_kj": signed_sensible_heat_kj(stage),
                "pipe_network": current_network,
                "possible_implementations": "Heat Exchanger; Pipe Radiator; Pipe Heater",
            },
        )
    )
    connect(edges, current_node_id, operation_node_id, current_stream, current_network)
    return operation_node_id, output_stream, unit_index + 1


def append_expansion_transfer_if_needed(
    nodes: list[ProcessNode],
    edges: list[ProcessEdge],
    current_node_id: str,
    current_stream: MaterialStream,
    current_network: str,
    stage: StageEvaluation,
    stage_index: int,
    unit_index: int,
) -> tuple[str, MaterialStream, str, int]:
    if current_network != "liquid" or stage.operation_kind != "evaporate":
        return current_node_id, current_stream, current_network, unit_index

    operation_node_id = f"expansion_valve_{stage_index:02d}"
    output_stream = stream_with_state(current_stream, phase_hint="mixed")
    nodes.append(
        ProcessNode(
            operation_node_id,
            "expansion_valve",
            {
                "unit_index": unit_index,
                "stage_index": stage_index,
                "role": "liquid_to_gas_transfer",
                "target_substance": stage.target_name,
                "operation_kind": stage.operation_kind,
                "selected_branch": stage.product_branch.value,
                "input_pressure_kpa": current_stream.pressure_kpa,
                "output_pressure_kpa": stage.pressure_kpa,
                "setpoint_pressure_kpa": stage.pressure_kpa,
                "direction": "liquid_network_to_gas_network",
                "native_temperature_delta_kelvin": 0.0,
            },
        )
    )
    connect(
        edges,
        current_node_id,
        operation_node_id,
        current_stream,
        "liquid",
        controlled_phase_transfer=True,
        transfer_device="expansion_valve",
    )
    return operation_node_id, output_stream, "gas", unit_index + 1


def append_phase_equilibrator(
    nodes: list[ProcessNode],
    edges: list[ProcessEdge],
    current_node_id: str,
    current_stream: MaterialStream,
    current_network: str,
    stage: StageEvaluation,
    stage_index: int,
    unit_index: int,
    polishing_reached_target: bool,
    polishing_passes_needed: int | None,
    polishing_final_purity: float,
    polishing_final_yield_fraction: float,
) -> tuple[str, MaterialStream, int]:
    node_id = f"phase_equilibrator_{stage_index:02d}"
    phase_stream = stream_with_state(
        current_stream,
        temperature_kelvin=stage.temperature_kelvin,
        pressure_kpa=stage.pressure_kpa,
        phase_hint="mixed",
    )
    native_heat = signed_native_phase_heat_kj(stage)
    nodes.append(
        ProcessNode(
            node_id,
            "phase_equilibrator",
            {
                "unit_index": unit_index,
                "stage_index": stage_index,
                "target_substance": stage.target_name,
                "selected_branch": stage.product_branch.value,
                "operation_kind": stage.operation_kind,
                "temperature_kelvin": stage.temperature_kelvin,
                "pressure_kpa": stage.pressure_kpa,
                "pipe_network": current_network,
                "product_purity": stage.product_purity,
                "target_recovery": stage.target_recovery,
                "product_total_moles": stage.product_total_moles,
                "residue_total_moles": stage.residue_total_moles,
                "solid_risk_total_moles": stage.solid_risk_total_moles,
                "estimated_sensible_heat_kj": stage.estimated_sensible_heat_kj,
                "native_phase_heat_kj": native_heat,
                "native_temperature_delta_kelvin": native_temperature_delta_kelvin(stage),
                "hold_temperature_heat_kj": -native_heat,
                "estimated_heat_kj": (
                    stage.estimated_sensible_heat_kj + stage.estimated_latent_heat_kj
                ),
                "polishing_reached_target": polishing_reached_target,
                "polishing_passes_needed": polishing_passes_needed,
                "polishing_final_purity": polishing_final_purity,
                "polishing_final_yield": polishing_final_yield_fraction,
            },
        )
    )
    connect(edges, current_node_id, node_id, phase_stream, current_network)
    return node_id, phase_stream, unit_index + 1


def append_phase_hold_operation(
    nodes: list[ProcessNode],
    edges: list[ProcessEdge],
    current_node_id: str,
    current_stream: MaterialStream,
    current_network: str,
    stage: StageEvaluation,
    stage_index: int,
    unit_index: int,
) -> tuple[str, int]:
    native_heat = signed_native_phase_heat_kj(stage)
    hold_heat = -native_heat
    if abs(hold_heat) <= THERMAL_DUTY_EPSILON_KJ:
        return current_node_id, unit_index

    node_kind = "heater" if hold_heat > 0.0 else "cooler"
    operation_node_id = f"phase_hold_{node_kind}_{stage_index:02d}"
    nodes.append(
        ProcessNode(
            operation_node_id,
            node_kind,
            {
                "unit_index": unit_index,
                "stage_index": stage_index,
                "role": "phase_hold_delta",
                "target_substance": stage.target_name,
                "operation_kind": stage.operation_kind,
                "selected_branch": stage.product_branch.value,
                "abstract_operation": True,
                "native_phase_heat_kj": native_heat,
                "native_temperature_delta_kelvin": native_temperature_delta_kelvin(stage),
                "external_heat_kj": hold_heat,
                "pipe_network": current_network,
                "possible_implementations": "Heat Exchanger; Phase Change Chamber heat-exchange port",
            },
        )
    )
    connect(edges, current_node_id, operation_node_id, current_stream, current_network)
    return operation_node_id, unit_index + 1


def append_valve_to_buffer(
    nodes: list[ProcessNode],
    edges: list[ProcessEdge],
    source_node_id: str,
    source_network: str,
    stream: MaterialStream,
    buffer_network: str,
    stage: StageEvaluation,
    stage_index: int,
    role: str,
    unit_index: int,
) -> tuple[str, int]:
    buffer_node_id = f"{role}_{buffer_network}_buffer_{stage_index:02d}"

    if source_network == "gas" and buffer_network == "liquid":
        valve_node_id = f"condensation_valve_{stage_index:02d}_{role}"
        nodes.append(
            ProcessNode(
                valve_node_id,
                "condensation_valve",
                {
                    "unit_index": unit_index,
                    "stage_index": stage_index,
                    "role": role,
                    "target_substance": stage.target_name,
                    "selected_branch": stage.product_branch.value,
                    "setpoint_pressure_kpa": stage.pressure_kpa,
                    "input_pressure_kpa": stage.pressure_kpa,
                    "output_pressure_kpa": stream.pressure_kpa,
                    "direction": "gas_network_liquid_to_liquid_network",
                    "max_safe_output_pressure_kpa": LIQUID_PIPE_MAX_PRESSURE_KPA,
                },
            )
        )
        connect(
            edges,
            source_node_id,
            valve_node_id,
            stream,
            "gas",
            controlled_phase_transfer=True,
            transfer_device="condensation_valve",
        )
        source_node_id = valve_node_id
        unit_index += 1
    elif source_network == "liquid" and buffer_network == "gas":
        valve_node_id = f"purge_valve_{stage_index:02d}_{role}"
        nodes.append(
            ProcessNode(
                valve_node_id,
                "purge_valve",
                {
                    "unit_index": unit_index,
                    "stage_index": stage_index,
                    "role": role,
                    "target_substance": stage.target_name,
                    "selected_branch": stage.product_branch.value,
                    "setpoint_pressure_kpa": stage.pressure_kpa,
                    "input_pressure_kpa": stage.pressure_kpa,
                    "output_pressure_kpa": stream.pressure_kpa,
                    "direction": "liquid_network_gas_to_gas_network",
                    "possible_implementations": "Purge Valve; Evaporation Chamber gas output",
                },
            )
        )
        connect(
            edges,
            source_node_id,
            valve_node_id,
            stream,
            "liquid",
            controlled_phase_transfer=True,
            transfer_device="purge_valve",
        )
        source_node_id = valve_node_id
        unit_index += 1

    nodes.append(buffer_node(buffer_node_id, buffer_network, stage, stream, role))
    connect(edges, source_node_id, buffer_node_id, stream, buffer_network)
    return buffer_node_id, unit_index


def signed_native_phase_heat_kj(stage: StageEvaluation) -> float:
    native_heat = 0.0
    feed_is_liquid = stage.feed_stream.phase_hint == "liquid"
    for name, moles in stage.feed_stream.moles_by_substance_name.items():
        substance = SUBSTANCES_BY_NAME[name]
        if substance.molar_latent_heat_kj_per_mol is None:
            continue
        probability = stage.phase_probabilities_by_name.get(name)
        if probability is None:
            continue
        if feed_is_liquid:
            transition_fraction = probability.gas_probability
            native_heat -= (
                max(0.0, moles)
                * transition_fraction
                * substance.molar_latent_heat_kj_per_mol
            )
        else:
            transition_fraction = probability.liquid_probability
            native_heat += (
                max(0.0, moles)
                * transition_fraction
                * substance.molar_latent_heat_kj_per_mol
            )
    return native_heat


def signed_sensible_heat_kj(stage: StageEvaluation) -> float:
    if stage.feed_stream.temperature_kelvin is None:
        return 0.0
    return _heat_capacity_kj_per_kelvin(stage.feed_stream) * (
        stage.temperature_kelvin - stage.feed_stream.temperature_kelvin
    )


def native_temperature_delta_kelvin(stage: StageEvaluation) -> float:
    heat_capacity = _heat_capacity_kj_per_kelvin(stage.feed_stream)
    if heat_capacity <= 0.0:
        return 0.0
    return signed_native_phase_heat_kj(stage) / heat_capacity


def _edge_parameters(
    stream: MaterialStream | None,
    pipe_network: str | None,
    *,
    controlled_phase_transfer: bool = False,
    transfer_device: str | None = None,
) -> GraphParameters:
    if pipe_network is None:
        return {}

    parameters: GraphParameters = {
        "pipe_network": pipe_network,
        "max_safe_pressure_kpa": _max_safe_pressure_kpa(pipe_network),
        "controlled_phase_transfer": controlled_phase_transfer,
        "phase_transfer_device": transfer_device,
    }
    if stream is None:
        return parameters

    pressure = stream.pressure_kpa
    warnings: list[str] = []
    if (
        pipe_network == "liquid"
        and pressure is not None
        and pressure > LIQUID_PIPE_MAX_PRESSURE_KPA + SETPOINT_PRESSURE_EPSILON_KPA
    ):
        warnings.append("liquid_pipe_overpressure")
    if pipe_network == "gas" and stream.phase_hint == "liquid":
        parameters["liquid_in_gas_pipe"] = True
        if controlled_phase_transfer:
            warnings.append("liquid_must_be_drained_by_condensation_valve")
        else:
            warnings.append("liquid_in_gas_pipe_damage_risk")
    if pipe_network == "liquid" and stream.phase_hint == "gas":
        parameters["gas_in_liquid_pipe"] = True
        if controlled_phase_transfer:
            warnings.append("gas_must_be_purged_from_liquid_pipe")
        else:
            warnings.append("gas_in_liquid_pipe_requires_purge")
    parameters["safety_warning"] = "|".join(warnings) if warnings else None
    return parameters


def _heat_capacity_kj_per_kelvin(stream: MaterialStream) -> float:
    heat_capacity_j_per_kelvin = 0.0
    for name, moles in stream.moles_by_substance_name.items():
        substance = SUBSTANCES_BY_NAME[name]
        if substance.molar_heat_capacity_j_per_mol_kelvin is None:
            continue
        heat_capacity_j_per_kelvin += (
            max(0.0, moles) * substance.molar_heat_capacity_j_per_mol_kelvin
        )
    return heat_capacity_j_per_kelvin / 1000.0


def _max_safe_pressure_kpa(pipe_network: str) -> float:
    return LIQUID_PIPE_MAX_PRESSURE_KPA if pipe_network == "liquid" else GAS_PIPE_MAX_PRESSURE_KPA


def _stage_index_from_node_id(node_id: str) -> int | None:
    try:
        return int(node_id.rsplit("_", 1)[1])
    except (IndexError, ValueError):
        return None
