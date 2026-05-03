from __future__ import annotations

import json
from importlib.resources import files

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
        if node["node_kind"] == "phase_splitter"
    ]
    assert "polishing_reached_target" in stage_nodes[0]["parameters"]
