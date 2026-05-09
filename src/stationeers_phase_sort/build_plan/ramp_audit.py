from __future__ import annotations

import math

from stationeers_phase_sort.build_plan.equipment import max_safe_pressure_for_network
from stationeers_phase_sort.build_plan.models import (
    BuildHazard,
    RampAudit,
    RampPathCandidate,
    RampSample,
    StreamState,
)
from stationeers_phase_sort.models import ControlNoise, MaterialStream, PlannerConfig
from stationeers_phase_sort.partition_models import phase_probability
from stationeers_phase_sort.substances import SUBSTANCES_BY_NAME

SOLID_WARNING_FRACTION = 1.0e-3
PHASE_LEAK_WARNING_FRACTION = 0.05


def stream_state_for(
    stream: MaterialStream,
    config: PlannerConfig,
    noise: ControlNoise,
    *,
    temperature_kelvin: float | None = None,
    pressure_kpa: float | None = None,
    network: str | None = None,
    phase_hint: str | None = None,
) -> StreamState:
    state_temperature = (
        stream.temperature_kelvin if temperature_kelvin is None else temperature_kelvin
    )
    state_pressure = stream.pressure_kpa if pressure_kpa is None else pressure_kpa
    composition = stream.normalized_composition()
    liquid_fraction_by_name: dict[str, float] = {}
    gas_fraction_by_name: dict[str, float] = {}
    solid_fraction_by_name: dict[str, float] = {}
    vapor_pressure_by_name: dict[str, float | None] = {}
    phase_margin_by_name: dict[str, float | None] = {}

    if state_temperature is not None and state_pressure is not None:
        for name, mole_fraction in composition.items():
            substance = SUBSTANCES_BY_NAME.get(name)
            if substance is None:
                continue
            probability = phase_probability(
                substance,
                state_temperature,
                state_pressure,
                mole_fraction,
                noise,
                config,
            )
            liquid_fraction_by_name[name] = probability.liquid_probability
            gas_fraction_by_name[name] = probability.gas_probability
            solid_fraction_by_name[name] = probability.solid_probability
            vapor_pressure_by_name[name] = probability.vapor_pressure_kpa
            phase_margin_by_name[name] = (
                probability.phase_margin_log_pressure
                if math.isfinite(probability.phase_margin_log_pressure)
                else None
            )

    return StreamState(
        temperature_kelvin=state_temperature,
        pressure_kpa=state_pressure,
        total_moles=stream.total_moles,
        volume_liters=stream.volume_liters,
        phase_hint=phase_hint or stream.phase_hint,
        network=network,
        composition=composition,
        liquid_fraction_by_name=liquid_fraction_by_name,
        gas_fraction_by_name=gas_fraction_by_name,
        solid_fraction_by_name=solid_fraction_by_name,
        vapor_pressure_by_name=vapor_pressure_by_name,
        phase_margin_by_name=phase_margin_by_name,
    )


def audit_ramp(
    audit_id: str,
    stream: MaterialStream,
    config: PlannerConfig,
    noise: ControlNoise,
    *,
    target_temperature_kelvin: float | None,
    target_pressure_kpa: float | None,
    network: str | None,
    stage_index: int | None,
    node_id: str,
    allow_phase_change: bool,
    chamber_capable: bool,
    sample_count: int = 8,
) -> RampAudit:
    start_temperature = stream.temperature_kelvin
    start_pressure = stream.pressure_kpa
    if (
        start_temperature is None
        or start_pressure is None
        or target_temperature_kelvin is None
        or target_pressure_kpa is None
    ):
        return RampAudit(
            audit_id=audit_id,
            selected_path="not_auditable",
            candidate_paths=tuple(),
            samples=tuple(),
            hazards=(
                BuildHazard(
                    f"{audit_id}:missing_state",
                    "missing_state",
                    "warning",
                    "Ramp could not be fully audited because the input or target state is incomplete.",
                    stage_index,
                    node_id,
                ),
            ),
            required_equipment=tuple(),
            required_controls=("temperature_sensor", "pressure_sensor"),
            blocking=False,
        )

    candidate_specs = [
        ("pressure_then_temperature", "Pressure first, then temperature", tuple(), False, False),
        ("temperature_then_pressure", "Temperature first, then pressure", tuple(), False, False),
        ("linear", "Simultaneous pressure/temperature ramp", tuple(), False, False),
        (
            "chamber_contained",
            "Chamber-contained ramp",
            ("phase_chamber",),
            True,
            chamber_capable,
        ),
        (
            "active_condensate_drain",
            "Ramp with active condensate drain",
            ("condensation_valve",),
            True,
            False,
        ),
        ("active_gas_purge", "Ramp with active gas purge", ("purge_valve",), True, False),
    ]
    candidate_paths: list[RampPathCandidate] = []
    samples_by_path: dict[str, tuple[RampSample, ...]] = {}
    hazards_by_path: dict[str, tuple[BuildHazard, ...]] = {}

    for path_id, label, required_equipment, local_allow_phase, chamber_path in candidate_specs:
        path_samples: list[RampSample] = []
        path_hazards: list[BuildHazard] = []
        max_liquid = 0.0
        max_gas = 0.0
        max_solid = 0.0
        for sample_index, (temperature, pressure) in enumerate(
            _path_points(
                path_id,
                start_temperature,
                start_pressure,
                target_temperature_kelvin,
                target_pressure_kpa,
                sample_count,
            )
        ):
            state = stream_state_for(
                stream,
                config,
                noise,
                temperature_kelvin=temperature,
                pressure_kpa=pressure,
                network=network,
            )
            sample_hazards = _sample_hazards(
                audit_id,
                path_id,
                sample_index,
                state,
                stream.phase_hint,
                network,
                stage_index,
                node_id,
                allow_phase_change=allow_phase_change or local_allow_phase,
                chamber_contained=chamber_path,
            )
            max_liquid = max(max_liquid, max(state.liquid_fraction_by_name.values(), default=0.0))
            max_gas = max(max_gas, max(state.gas_fraction_by_name.values(), default=0.0))
            max_solid = max(max_solid, max(state.solid_fraction_by_name.values(), default=0.0))
            path_hazards.extend(sample_hazards)
            path_samples.append(
                RampSample(path_id, sample_index, temperature, pressure, state, sample_hazards)
            )

        warning_count = sum(1 for hazard in path_hazards if hazard.severity == "warning")
        blocking_count = sum(1 for hazard in path_hazards if hazard.severity == "blocking")
        score = (
            blocking_count * 1000.0
            + warning_count * 50.0
            + max_solid * 500.0
            + max_liquid * (0.0 if allow_phase_change or local_allow_phase else 25.0)
        )
        candidate_paths.append(
            RampPathCandidate(
                path_id=path_id,
                label=label,
                required_equipment=required_equipment,
                warning_count=warning_count,
                blocking_count=blocking_count,
                max_liquid_fraction=max_liquid,
                max_gas_fraction=max_gas,
                max_solid_fraction=max_solid,
                score=score,
            )
        )
        samples_by_path[path_id] = tuple(path_samples)
        hazards_by_path[path_id] = tuple(path_hazards)

    selected = min(candidate_paths, key=lambda candidate: candidate.score)
    selected_hazards = hazards_by_path[selected.path_id]
    required_controls = ("temperature_sensor", "pressure_sensor")
    return RampAudit(
        audit_id=audit_id,
        selected_path=selected.path_id,
        candidate_paths=tuple(candidate_paths),
        samples=samples_by_path[selected.path_id],
        hazards=selected_hazards,
        required_equipment=selected.required_equipment,
        required_controls=required_controls,
        blocking=any(hazard.severity == "blocking" for hazard in selected_hazards),
    )


def _path_points(
    path_id: str,
    start_temperature: float,
    start_pressure: float,
    target_temperature: float,
    target_pressure: float,
    sample_count: int,
) -> list[tuple[float, float]]:
    count = max(2, sample_count)
    points: list[tuple[float, float]] = []
    for sample_index in range(count + 1):
        fraction = sample_index / count
        if path_id == "pressure_then_temperature":
            if fraction <= 0.5:
                local_fraction = fraction / 0.5
                points.append(
                    (
                        start_temperature,
                        _lerp(start_pressure, target_pressure, local_fraction),
                    )
                )
            else:
                local_fraction = (fraction - 0.5) / 0.5
                points.append(
                    (
                        _lerp(start_temperature, target_temperature, local_fraction),
                        target_pressure,
                    )
                )
        elif path_id == "temperature_then_pressure":
            if fraction <= 0.5:
                local_fraction = fraction / 0.5
                points.append(
                    (
                        _lerp(start_temperature, target_temperature, local_fraction),
                        start_pressure,
                    )
                )
            else:
                local_fraction = (fraction - 0.5) / 0.5
                points.append(
                    (
                        target_temperature,
                        _lerp(start_pressure, target_pressure, local_fraction),
                    )
                )
        else:
            points.append(
                (
                    _lerp(start_temperature, target_temperature, fraction),
                    _lerp(start_pressure, target_pressure, fraction),
                )
            )
    return points


def _sample_hazards(
    audit_id: str,
    path_id: str,
    sample_index: int,
    state: StreamState,
    input_phase_hint: str,
    network: str | None,
    stage_index: int | None,
    node_id: str,
    *,
    allow_phase_change: bool,
    chamber_contained: bool,
) -> tuple[BuildHazard, ...]:
    hazards: list[BuildHazard] = []
    for substance_name, solid_fraction in state.solid_fraction_by_name.items():
        if solid_fraction >= SOLID_WARNING_FRACTION:
            hazards.append(
                BuildHazard(
                    f"{audit_id}:{path_id}:{sample_index}:solid:{substance_name}",
                    "solid_risk",
                    "warning" if chamber_contained else "blocking",
                    (
                        f"{substance_name} has solid risk during ramp "
                        f"({solid_fraction:.3f} fraction)."
                    ),
                    stage_index,
                    node_id,
                    substance_name=substance_name,
                )
            )

    if network == "gas" and not allow_phase_change:
        for substance_name, liquid_fraction in state.liquid_fraction_by_name.items():
            if liquid_fraction >= PHASE_LEAK_WARNING_FRACTION:
                hazards.append(
                    BuildHazard(
                        f"{audit_id}:{path_id}:{sample_index}:liquid:{substance_name}",
                        "unintended_condensation",
                        "blocking",
                        f"{substance_name} can condense in a gas network during ramp.",
                        stage_index,
                        node_id,
                        substance_name=substance_name,
                    )
                )
    if network == "liquid" and not allow_phase_change:
        for substance_name, gas_fraction in state.gas_fraction_by_name.items():
            if input_phase_hint == "liquid" and gas_fraction >= PHASE_LEAK_WARNING_FRACTION:
                hazards.append(
                    BuildHazard(
                        f"{audit_id}:{path_id}:{sample_index}:gas:{substance_name}",
                        "unintended_evaporation",
                        "blocking",
                        f"{substance_name} can evaporate in a liquid network during ramp.",
                        stage_index,
                        node_id,
                        substance_name=substance_name,
                    )
                )

    max_pressure = max_safe_pressure_for_network(network)
    if (
        max_pressure is not None
        and state.pressure_kpa is not None
        and state.pressure_kpa > max_pressure
    ):
        hazards.append(
            BuildHazard(
                f"{audit_id}:{path_id}:{sample_index}:overpressure",
                "overpressure",
                "blocking",
                f"Ramp pressure {state.pressure_kpa:.1f} kPa exceeds {network} limit.",
                stage_index,
                node_id,
            )
        )
    return tuple(hazards)


def _lerp(start: float, end: float, fraction: float) -> float:
    return start + (end - start) * max(0.0, min(1.0, fraction))
