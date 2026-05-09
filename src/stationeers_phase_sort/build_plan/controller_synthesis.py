from __future__ import annotations

from stationeers_phase_sort.build_plan.models import ControlRule
from stationeers_phase_sort.models import ProcessNode


def controls_for_node(
    node: ProcessNode,
    build_kind: str,
    *,
    sensor_node_id: str,
) -> tuple[ControlRule, ...]:
    stage_index = _stage_index(node)
    prefix = f"{node.node_id}:control"
    rules: list[ControlRule] = []

    output_pressure = _number_parameter(node, "output_pressure_kpa") or _number_parameter(
        node, "setpoint_pressure_kpa"
    )
    if build_kind in {
        "pressure_regulator",
        "back_pressure_regulator",
        "volume_pump",
        "expansion_valve",
        "pressurant_valve",
    } and output_pressure is not None:
        rules.append(
            ControlRule(
                rule_id=f"{prefix}:pressure",
                controlled_device_id=node.node_id,
                sensor_node_id=sensor_node_id,
                variable="pressure_kpa",
                target=output_pressure,
                deadband=max(5.0, output_pressure * 0.01),
                action="hold downstream pressure at setpoint; recover excess to buffer",
                priority=10,
                fail_safe_state="closed",
            )
        )

    output_temperature = _number_parameter(node, "output_temperature_kelvin") or _number_parameter(
        node, "temperature_kelvin"
    )
    if build_kind in {
        "heat_exchanger",
        "radiator_bank",
        "wall_heater",
        "wall_cooler",
        "condensation_chamber",
        "evaporation_chamber",
        "phase_separator",
    } and output_temperature is not None:
        rules.append(
            ControlRule(
                rule_id=f"{prefix}:temperature",
                controlled_device_id=node.node_id,
                sensor_node_id=sensor_node_id,
                variable="temperature_kelvin",
                target=output_temperature,
                deadband=1.0,
                action="run thermal loop until output temperature is within deadband",
                priority=20,
                fail_safe_state="isolated",
            )
        )

    if build_kind == "condensation_valve":
        rules.append(
            ControlRule(
                rule_id=f"{prefix}:drain",
                controlled_device_id=node.node_id,
                sensor_node_id=sensor_node_id,
                variable="liquid_fraction",
                target="detected",
                deadband=None,
                action="open only when condensate is present and liquid output pressure is safe",
                priority=30,
                fail_safe_state="closed",
            )
        )
    if build_kind == "purge_valve":
        rules.append(
            ControlRule(
                rule_id=f"{prefix}:purge",
                controlled_device_id=node.node_id,
                sensor_node_id=sensor_node_id,
                variable="gas_fraction",
                target="detected",
                deadband=None,
                action="purge gas to recovery buffer until liquid network is stable",
                priority=30,
                fail_safe_state="closed",
            )
        )

    if build_kind == "product_storage":
        product_pressure = _number_parameter(node, "pressure_kpa")
        if product_pressure is not None:
            rules.append(
                ControlRule(
                    rule_id=f"{prefix}:product_pressure_trim",
                    controlled_device_id=node.node_id,
                    sensor_node_id=node.node_id,
                    variable="pressure_kpa",
                    target=product_pressure,
                    deadband=max(5.0, product_pressure * 0.01),
                    action="fill only inside temperature band; bleed overpressure to recovery",
                    priority=40,
                    fail_safe_state="isolated",
                )
            )
        product_temperature = _number_parameter(node, "temperature_kelvin")
        if product_temperature is not None:
            rules.append(
                ControlRule(
                    rule_id=f"{prefix}:product_temperature_trim",
                    controlled_device_id=node.node_id,
                    sensor_node_id=node.node_id,
                    variable="temperature_kelvin",
                    target=product_temperature,
                    deadband=1.0,
                    action="recirculate through heat exchanger loop without adding product mass",
                    priority=41,
                    fail_safe_state="isolated",
                )
            )

    if stage_index is not None and build_kind in {"gas_buffer", "liquid_buffer", "feed_buffer"}:
        rules.append(
            ControlRule(
                rule_id=f"{prefix}:buffer_alarm",
                controlled_device_id=node.node_id,
                sensor_node_id=node.node_id,
                variable="phase_integrity",
                target="expected_network",
                deadband=None,
                action="alarm and isolate buffer if wrong phase appears",
                priority=50,
                fail_safe_state="isolated",
            )
        )

    return tuple(rules)


def _number_parameter(node: ProcessNode, key: str) -> float | None:
    value = node.parameters.get(key)
    return value if isinstance(value, float | int) else None


def _stage_index(node: ProcessNode) -> int | None:
    value = node.parameters.get("stage_index")
    return value if isinstance(value, int) else None
