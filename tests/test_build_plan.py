from __future__ import annotations

import json

from stationeers_phase_sort.webview import build_plan_payload


def test_plan_payload_exposes_canonical_build_plan() -> None:
    payload = build_plan_payload(
        {
            "substances": ["Oxygen", "Nitrogen", "Carbon Dioxide", "Helium"],
            "temperature_grid": 4,
            "pressure_grid": 4,
            "maximum_polishing_passes": 5,
        }
    )

    json.dumps(payload["build_plan"], allow_nan=False)  # type: ignore[index]
    build_plan = payload["build_plan"]  # type: ignore[assignment]
    nodes = build_plan["nodes"]  # type: ignore[index]
    node_kinds = {node["node_kind"] for node in nodes}

    assert build_plan["assumptions"]  # type: ignore[index]
    assert build_plan["controllers"]  # type: ignore[index]
    assert build_plan["startup_sequence"]  # type: ignore[index]
    assert build_plan["shutdown_sequence"]  # type: ignore[index]
    assert "pressure_increaser" not in node_kinds
    assert "pressure_decreaser" not in node_kinds
    assert "cooler" not in node_kinds
    assert "heater" not in node_kinds
    assert "pressure_regulator" in node_kinds
    assert "heat_exchanger" in node_kinds
    assert "condensation_chamber" in node_kinds
    assert any(node["ramp"] is not None for node in nodes)
    product_controls = [
        control
        for control in build_plan["controllers"]  # type: ignore[index]
        if str(control["controlled_device_id"]).startswith("product_")
    ]
    assert {control["variable"] for control in product_controls} >= {
        "pressure_kpa",
        "temperature_kelvin",
    }


def test_build_plan_marks_unsafe_mars_co2_ramps() -> None:
    payload = build_plan_payload(
        {
            "preset": "mars-atmosphere",
            "substances": ["Carbon Dioxide", "Nitrogen", "Oxygen"],
            "composition": {"Carbon Dioxide": 96, "Nitrogen": 2, "Oxygen": 2},
            "initial_temperature_kelvin": 220.0,
            "initial_pressure_kpa": 2.0,
            "temperature_grid": 4,
            "pressure_grid": 4,
            "maximum_polishing_passes": 5,
        }
    )

    hazards = payload["build_plan"]["hazards"]  # type: ignore[index]

    assert any(hazard["kind"] in {"solid_risk", "unintended_condensation"} for hazard in hazards)
