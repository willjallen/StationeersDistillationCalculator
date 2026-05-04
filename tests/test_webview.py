from __future__ import annotations

import json
from importlib.resources import files
from pathlib import Path

from stationeers_phase_sort.cli import build_parser
from stationeers_phase_sort.webview import build_meta_payload, build_plan_payload


def test_webview_command_is_registered() -> None:
    arguments = build_parser().parse_args(["webview", "--port", "0"])

    assert arguments.command == "webview"
    assert arguments.handler.__name__ == "run_webview"


def test_webview_static_assets_are_packaged() -> None:
    static_files = files("stationeers_phase_sort.web_static")

    assert static_files.joinpath("index.html").is_file()
    assert static_files.joinpath("app.css").is_file()
    assert static_files.joinpath("app.js").is_file()


def test_webview_uses_canvas_and_fixed_viewport_layout() -> None:
    assert Path("web_src/src/PlanCanvas.tsx").read_text(encoding="utf-8").count("<canvas") == 1
    css = files("stationeers_phase_sort.web_static").joinpath("app.css").read_text()

    assert "overflow:hidden" in css
    assert "plan-canvas" in css


def test_webview_meta_payload_lists_presets_and_substances() -> None:
    payload = build_meta_payload()

    assert payload["presets"]
    assert payload["substances"]
    assert payload["defaults"]


def test_webview_plan_payload_is_strict_json_and_diagram_ready() -> None:
    payload = build_plan_payload(
        {
            "substances": ["Oxygen", "Nitrogen", "Carbon Dioxide", "Helium"],
            "temperature_grid": 4,
            "pressure_grid": 4,
            "maximum_polishing_passes": 5,
        }
    )

    json.dumps(payload, allow_nan=False)
    assert payload["summary"]["product_count"] == 4  # type: ignore[index]
    assert payload["stages"]  # type: ignore[truthy-function]
    graph = payload["graph"]  # type: ignore[assignment]
    assert graph["nodes"]  # type: ignore[index]
    assert graph["edges"]  # type: ignore[index]
    stage_nodes = [
        node
        for node in graph["nodes"]  # type: ignore[index]
        if node["node_kind"] == "phase_equilibrator"
    ]
    assert "polishing_reached_target" in stage_nodes[0]["parameters"]
    equipment_nodes = [
        node
        for node in graph["nodes"]  # type: ignore[index]
        if node["node_kind"]
        in {
            "pressure_increaser",
            "pressure_decreaser",
            "cooler",
            "heater",
            "expansion_valve",
            "condensation_valve",
            "purge_valve",
        }
    ]
    assert equipment_nodes
    assert "unit_index" in equipment_nodes[0]["parameters"]
    assert any(node["node_kind"] == "pressure_increaser" for node in equipment_nodes)
    assert any(node["node_kind"] == "condensation_valve" for node in equipment_nodes)
    assert any(
        node["node_kind"] in {"gas_buffer", "liquid_buffer"}
        for node in graph["nodes"]  # type: ignore[index]
    )
    assert not any(
        node["node_kind"] == "conditioning_valve"
        for node in graph["nodes"]  # type: ignore[index]
    )
    assert not any(
        node["node_kind"] == "recycle"
        for node in graph["nodes"]  # type: ignore[index]
    )
    assert any(
        edge["parameters"].get("pipe_network") in {"gas", "liquid"}
        for edge in graph["edges"]  # type: ignore[index]
    )
    assert any(
        edge["parameters"].get("phase_transfer_device") == "condensation_valve"
        for edge in graph["edges"]  # type: ignore[index]
    )
