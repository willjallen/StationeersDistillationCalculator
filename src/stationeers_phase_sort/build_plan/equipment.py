from __future__ import annotations

from dataclasses import dataclass

from stationeers_phase_sort.models import ProcessNode


@dataclass(frozen=True)
class EquipmentDefinition:
    kind: str
    buildable_name: str
    input_networks: tuple[str, ...]
    output_networks: tuple[str, ...]
    allowed_phase_states: tuple[str, ...]
    pressure_limit_kpa: float | None
    temperature_limit_kelvin: float | None
    active_power_watts: float | None
    passive: bool
    can_change_pressure: bool
    can_change_temperature: bool
    can_transfer_heat: bool
    can_separate_phase: bool
    can_hold_mixed_phase: bool
    required_controls: tuple[str, ...]
    failure_modes: tuple[str, ...]


GAS_PIPE_MAX_PRESSURE_KPA = 60000.0
LIQUID_PIPE_MAX_PRESSURE_KPA = 6000.0


EQUIPMENT_DEFINITIONS: dict[str, EquipmentDefinition] = {
    "source": EquipmentDefinition(
        "source",
        "Feed source",
        tuple(),
        ("gas", "liquid", "mixed"),
        ("gas", "liquid", "mixed"),
        None,
        None,
        None,
        True,
        False,
        False,
        False,
        False,
        False,
        tuple(),
        tuple(),
    ),
    "feed_buffer": EquipmentDefinition(
        "feed_buffer",
        "Feed buffer tank",
        ("gas", "liquid", "mixed"),
        ("gas", "liquid", "mixed"),
        ("gas", "liquid", "mixed"),
        GAS_PIPE_MAX_PRESSURE_KPA,
        None,
        None,
        True,
        False,
        False,
        False,
        False,
        False,
        ("pressure_sensor", "temperature_sensor"),
        ("overpressure", "unintended_phase_change"),
    ),
    "gas_buffer": EquipmentDefinition(
        "gas_buffer",
        "Gas buffer tank",
        ("gas",),
        ("gas",),
        ("gas",),
        GAS_PIPE_MAX_PRESSURE_KPA,
        None,
        None,
        True,
        False,
        False,
        False,
        False,
        False,
        ("pressure_sensor", "temperature_sensor"),
        ("liquid_in_gas_storage", "overpressure"),
    ),
    "liquid_buffer": EquipmentDefinition(
        "liquid_buffer",
        "Liquid buffer tank",
        ("liquid",),
        ("liquid",),
        ("liquid",),
        LIQUID_PIPE_MAX_PRESSURE_KPA,
        None,
        None,
        True,
        False,
        False,
        False,
        False,
        False,
        ("pressure_sensor", "temperature_sensor"),
        ("gas_in_liquid_storage", "liquid_overpressure"),
    ),
    "recovery_buffer": EquipmentDefinition(
        "recovery_buffer",
        "Recovery buffer tank",
        ("gas", "liquid", "mixed"),
        ("gas", "liquid", "mixed"),
        ("gas", "liquid", "mixed"),
        GAS_PIPE_MAX_PRESSURE_KPA,
        None,
        None,
        True,
        False,
        False,
        False,
        False,
        True,
        ("pressure_sensor",),
        ("wrong_phase_storage", "overpressure"),
    ),
    "pressure_regulator": EquipmentDefinition(
        "pressure_regulator",
        "Pressure regulator",
        ("gas",),
        ("gas",),
        ("gas",),
        GAS_PIPE_MAX_PRESSURE_KPA,
        None,
        100.0,
        False,
        True,
        False,
        False,
        False,
        False,
        ("output_pressure_sensor",),
        ("unintended_condensation", "overpressure"),
    ),
    "back_pressure_regulator": EquipmentDefinition(
        "back_pressure_regulator",
        "Back pressure regulator",
        ("gas",),
        ("gas",),
        ("gas",),
        GAS_PIPE_MAX_PRESSURE_KPA,
        None,
        100.0,
        False,
        True,
        False,
        False,
        False,
        False,
        ("input_pressure_sensor",),
        ("uncontrolled_dump", "unintended_evaporation"),
    ),
    "volume_pump": EquipmentDefinition(
        "volume_pump",
        "Volume pump",
        ("gas",),
        ("gas",),
        ("gas",),
        GAS_PIPE_MAX_PRESSURE_KPA,
        None,
        100.0,
        False,
        True,
        False,
        False,
        False,
        False,
        ("pressure_sensor",),
        ("overpressure", "unintended_condensation"),
    ),
    "heat_exchanger": EquipmentDefinition(
        "heat_exchanger",
        "Heat exchanger",
        ("gas", "liquid"),
        ("gas", "liquid"),
        ("gas", "liquid"),
        GAS_PIPE_MAX_PRESSURE_KPA,
        None,
        None,
        True,
        False,
        True,
        True,
        False,
        False,
        ("temperature_sensor", "bypass_valve"),
        ("overshoot", "unintended_phase_change"),
    ),
    "radiator_bank": EquipmentDefinition(
        "radiator_bank",
        "Radiator bank",
        ("gas", "liquid"),
        ("gas", "liquid"),
        ("gas", "liquid"),
        GAS_PIPE_MAX_PRESSURE_KPA,
        None,
        None,
        True,
        False,
        True,
        True,
        False,
        False,
        ("temperature_sensor", "isolation_valve"),
        ("environmental_overcooling",),
    ),
    "condensation_chamber": EquipmentDefinition(
        "condensation_chamber",
        "Condensation chamber",
        ("gas", "mixed"),
        ("gas", "liquid", "mixed"),
        ("gas", "liquid", "mixed"),
        GAS_PIPE_MAX_PRESSURE_KPA,
        None,
        100.0,
        False,
        False,
        True,
        True,
        True,
        True,
        ("temperature_sensor", "pressure_sensor", "liquid_drain"),
        ("solid_formation", "blocked_drain", "overpressure"),
    ),
    "evaporation_chamber": EquipmentDefinition(
        "evaporation_chamber",
        "Evaporation chamber",
        ("liquid", "mixed"),
        ("gas", "liquid", "mixed"),
        ("gas", "liquid", "mixed"),
        GAS_PIPE_MAX_PRESSURE_KPA,
        None,
        100.0,
        False,
        True,
        True,
        True,
        True,
        True,
        ("temperature_sensor", "pressure_sensor", "gas_purge"),
        ("solid_formation", "blocked_purge", "overpressure"),
    ),
    "phase_separator": EquipmentDefinition(
        "phase_separator",
        "Phase separator",
        ("gas", "liquid", "mixed"),
        ("gas", "liquid", "mixed"),
        ("gas", "liquid", "mixed"),
        GAS_PIPE_MAX_PRESSURE_KPA,
        None,
        100.0,
        False,
        False,
        True,
        True,
        True,
        True,
        ("temperature_sensor", "pressure_sensor", "drain", "purge"),
        ("solid_formation", "wrong_phase_output"),
    ),
    "condensation_valve": EquipmentDefinition(
        "condensation_valve",
        "Condensation valve",
        ("gas",),
        ("liquid",),
        ("liquid", "mixed"),
        LIQUID_PIPE_MAX_PRESSURE_KPA,
        None,
        None,
        True,
        False,
        False,
        False,
        True,
        False,
        ("liquid_pipe_pressure_sensor",),
        ("liquid_overpressure", "blocked_liquid_output"),
    ),
    "expansion_valve": EquipmentDefinition(
        "expansion_valve",
        "Expansion valve",
        ("liquid",),
        ("gas", "mixed"),
        ("gas", "mixed"),
        GAS_PIPE_MAX_PRESSURE_KPA,
        None,
        None,
        True,
        True,
        False,
        False,
        True,
        False,
        ("downstream_pressure_sensor",),
        ("uncontrolled_flash",),
    ),
    "purge_valve": EquipmentDefinition(
        "purge_valve",
        "Purge valve",
        ("liquid", "mixed"),
        ("gas",),
        ("gas", "mixed"),
        GAS_PIPE_MAX_PRESSURE_KPA,
        None,
        None,
        True,
        True,
        False,
        False,
        True,
        False,
        ("gas_pipe_pressure_sensor",),
        ("valuable_gas_loss",),
    ),
    "pressurant_valve": EquipmentDefinition(
        "pressurant_valve",
        "Pressurant valve",
        ("gas",),
        ("liquid",),
        ("gas", "liquid"),
        LIQUID_PIPE_MAX_PRESSURE_KPA,
        None,
        None,
        True,
        True,
        False,
        False,
        False,
        False,
        ("liquid_pipe_pressure_sensor",),
        ("liquid_overpressure",),
    ),
    "product_storage": EquipmentDefinition(
        "product_storage",
        "Product storage",
        ("gas", "liquid"),
        ("gas", "liquid"),
        ("gas", "liquid"),
        GAS_PIPE_MAX_PRESSURE_KPA,
        None,
        None,
        True,
        False,
        False,
        False,
        False,
        False,
        ("pressure_sensor", "temperature_sensor"),
        ("wrong_phase_storage", "overpressure"),
    ),
    "waste_dump": EquipmentDefinition(
        "waste_dump",
        "Waste dump",
        ("gas", "liquid"),
        tuple(),
        ("gas", "liquid"),
        None,
        None,
        None,
        True,
        False,
        False,
        False,
        False,
        False,
        ("manual_confirm",),
        ("valuable_material_loss",),
    ),
    "alarm": EquipmentDefinition(
        "alarm",
        "Alarm",
        tuple(),
        tuple(),
        tuple(),
        None,
        None,
        None,
        True,
        False,
        False,
        False,
        False,
        False,
        tuple(),
        tuple(),
    ),
}


def concrete_node_kind(node: ProcessNode) -> str:
    if node.node_kind == "source":
        return "source"
    if node.node_kind == "pressure_increaser":
        return "pressure_regulator"
    if node.node_kind == "pressure_decreaser":
        return "back_pressure_regulator"
    if node.node_kind == "cooler" or node.node_kind == "heater":
        return "heat_exchanger"
    if node.node_kind == "phase_equilibrator" or node.node_kind == "phase_splitter":
        operation = str(node.parameters.get("operation_kind") or "")
        if operation == "evaporate":
            return "evaporation_chamber"
        if operation == "condense":
            return "condensation_chamber"
        return "phase_separator"
    if node.node_kind == "gas_buffer":
        return "feed_buffer" if node.parameters.get("role") == "feed" else "gas_buffer"
    if node.node_kind == "liquid_buffer":
        return "feed_buffer" if node.parameters.get("role") == "feed" else "liquid_buffer"
    if node.node_kind in {
        "condensation_valve",
        "expansion_valve",
        "purge_valve",
        "pressurant_valve",
        "product_storage",
    }:
        return node.node_kind
    if node.node_kind in {"polishing_recycle", "recycle", "residue"}:
        return "recovery_buffer"
    if node.node_kind == "solid_risk":
        return "alarm"
    return "alarm"


def equipment_label(kind: str) -> str:
    definition = EQUIPMENT_DEFINITIONS.get(kind)
    return definition.buildable_name if definition is not None else kind.replace("_", " ").title()


def max_safe_pressure_for_network(network: str | None) -> float | None:
    if network == "liquid":
        return LIQUID_PIPE_MAX_PRESSURE_KPA
    if network == "gas":
        return GAS_PIPE_MAX_PRESSURE_KPA
    return None
