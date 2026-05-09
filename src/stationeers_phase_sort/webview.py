from __future__ import annotations

import json
import math
import mimetypes
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from typing import Any
from urllib.parse import urlparse

from stationeers_phase_sort.build_plan import build_plan_to_json, build_plan_view_model
from stationeers_phase_sort.models import (
    ControlNoise,
    MaterialStream,
    PlannerConfig,
    PressureModel,
    ProcessGraph,
    SearchPlan,
    StageEvaluation,
)
from stationeers_phase_sort.optimizer.beam_search import search_phase_chain_beam
from stationeers_phase_sort.optimizer.greedy import search_phase_chain_greedy
from stationeers_phase_sort.presets import preset_substances
from stationeers_phase_sort.process_graph import plan_to_process_graph
from stationeers_phase_sort.streams import make_initial_stream, sorted_composition_items
from stationeers_phase_sort.substances import SUBSTANCES_BY_NAME

PRESET_NAMES = ("all-gases", "base-air", "mars-atmosphere")


def build_meta_payload() -> dict[str, object]:
    return {
        "presets": [
            {
                "name": preset_name,
                "substances": list(preset_substances(preset_name)),
            }
            for preset_name in PRESET_NAMES
        ],
        "substances": [
            {
                "name": substance.name,
                "formula": substance.formula,
                "phase_change_enabled": substance.phase_change_enabled,
                "melting_temperature_kelvin": substance.melting_temperature_kelvin,
                "maximum_liquid_temperature_kelvin": substance.maximum_liquid_temperature_kelvin,
                "maximum_liquid_pressure_kpa": substance.maximum_liquid_pressure_kpa,
                "hazard_tags": list(substance.hazard_tags),
            }
            for substance in sorted(SUBSTANCES_BY_NAME.values(), key=lambda item: item.name)
        ],
        "defaults": default_plan_request(),
    }


def default_plan_request() -> dict[str, object]:
    return {
        "preset": "base-air",
        "substances": None,
        "exclude": [],
        "composition": {},
        "total_moles": 100.0,
        "initial_temperature_kelvin": 293.15,
        "initial_pressure_kpa": 100.0,
        "pressure_model": PressureModel.TOTAL.value,
        "maximum_pressure_kpa": 6000.0,
        "temperature_error_kelvin": 0.50,
        "pressure_error_fraction": 0.01,
        "model_error_log_pressure": 0.02,
        "target_purity": 0.9999,
        "minimum_stage_purity": 0.25,
        "maximum_polishing_passes": 80,
        "temperature_grid": 16,
        "pressure_grid": 16,
        "beam_width": 16,
        "local_refinement_rounds": 0,
        "keep_per_target": 2,
        "search_mode": "greedy",
    }


def build_plan_payload(request: dict[str, Any]) -> dict[str, object]:
    selected_names = _selected_substance_names(request)
    composition_by_name = _composition_by_name(request)
    initial_stream = make_initial_stream(
        selected_names,
        total_moles_value=_positive_float(request, "total_moles", 100.0),
        temperature_kelvin=_float(request, "initial_temperature_kelvin", 293.15),
        pressure_kpa=_positive_float(request, "initial_pressure_kpa", 100.0),
        composition_by_name=composition_by_name,
    )
    config = PlannerConfig(
        pressure_model=PressureModel(str(request.get("pressure_model", PressureModel.TOTAL.value))),
        maximum_process_pressure_kpa=_positive_float(request, "maximum_pressure_kpa", 6000.0),
        target_final_purity=_bounded_float(request, "target_purity", 0.9999, 0.0, 0.999999),
        maximum_polishing_passes=_bounded_int(request, "maximum_polishing_passes", 80, 1, 400),
        temperature_grid_count=_bounded_int(request, "temperature_grid", 16, 2, 96),
        pressure_grid_count=_bounded_int(request, "pressure_grid", 16, 2, 96),
        beam_width=_bounded_int(request, "beam_width", 16, 1, 128),
        candidate_keep_per_target=_bounded_int(request, "keep_per_target", 2, 1, 12),
        minimum_product_purity_for_stage=_bounded_float(
            request,
            "minimum_stage_purity",
            0.25,
            0.0,
            0.999,
        ),
        local_refinement_rounds=_bounded_int(request, "local_refinement_rounds", 0, 0, 12),
    )
    noise = ControlNoise(
        temperature_sigma_kelvin=_bounded_float(
            request,
            "temperature_error_kelvin",
            0.50,
            0.0,
            50.0,
        ),
        pressure_sigma_fraction=_bounded_float(
            request,
            "pressure_error_fraction",
            0.01,
            0.0,
            1.0,
        ),
        pressure_sigma_kpa=0.0,
        extra_model_sigma_log_pressure=_bounded_float(
            request,
            "model_error_log_pressure",
            0.02,
            0.0,
            1.0,
        ),
    )

    search_mode = str(request.get("search_mode", "greedy"))
    if search_mode not in {"greedy", "beam"}:
        raise ValueError("search_mode must be 'greedy' or 'beam'")

    plan = (
        search_phase_chain_greedy(initial_stream, selected_names, noise, config)
        if search_mode == "greedy"
        else search_phase_chain_beam(initial_stream, selected_names, noise, config)
    )

    build_plan = build_plan_view_model(
        plan,
        initial_stream,
        {
            **default_plan_request(),
            **{key: value for key, value in request.items() if key in default_plan_request()},
            "substances": selected_names,
        },
        config,
        noise,
    )
    return {
        "request": {
            **default_plan_request(),
            **{key: value for key, value in request.items() if key in default_plan_request()},
            "substances": selected_names,
        },
        "initial_stream": _stream_to_json(initial_stream),
        "summary": _plan_summary(plan, initial_stream),
        "stages": [
            _stage_to_json(record.stage, record.stage_index, record.polishing_passes_needed)
            | {
                "polishing_final_purity": _json_float(record.polishing_final_purity),
                "polishing_final_yield": _json_float(record.polishing_final_yield_fraction),
            }
            for record in plan.product_records
        ],
        "graph": _graph_to_json(plan_to_process_graph(plan)),
        "build_plan": build_plan_to_json(build_plan),
    }


def serve_webview(host: str = "127.0.0.1", port: int = 8765, open_browser: bool = False) -> None:
    server = ThreadingHTTPServer((host, port), _WebviewRequestHandler)
    address_host, address_port = server.server_address[:2]
    display_host = "127.0.0.1" if address_host in {"0.0.0.0", ""} else str(address_host)
    url = f"http://{display_host}:{address_port}/"
    print(f"Stationeers Phase Sort webview listening on {url}", flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.server_close()


class _WebviewRequestHandler(BaseHTTPRequestHandler):
    server_version = "StationeersPhaseSortWebview/0.1"

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/meta":
            self._send_json(build_meta_payload())
            return
        if path == "/":
            path = "/index.html"
        self._send_static(path)

    def do_HEAD(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            path = "/index.html"
        resource_name = path.removeprefix("/")
        if "/" in resource_name or resource_name.startswith("."):
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        resource = files("stationeers_phase_sort.web_static").joinpath(resource_name)
        if not resource.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_type = mimetypes.guess_type(resource_name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(resource.read_bytes())))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/api/plan":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length)
            loaded = json.loads(raw_body.decode("utf-8") or "{}")
            if not isinstance(loaded, dict):
                raise ValueError("Request body must be a JSON object")
            self._send_json(build_plan_payload(loaded))
        except Exception as error:
            self._send_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:
        if self.path.startswith("/api/"):
            super().log_message(format, *args)

    def _send_json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, path: str) -> None:
        resource_name = path.removeprefix("/")
        if "/" in resource_name or resource_name.startswith("."):
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        resource = files("stationeers_phase_sort.web_static").joinpath(resource_name)
        if not resource.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        body = resource.read_bytes()
        content_type = mimetypes.guess_type(resource_name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def _selected_substance_names(request: dict[str, Any]) -> list[str]:
    raw_substances = request.get("substances")
    if isinstance(raw_substances, list) and raw_substances:
        selected_names = [str(name) for name in raw_substances]
    else:
        preset = str(request.get("preset", "base-air"))
        if preset not in PRESET_NAMES:
            raise ValueError(f"Unknown preset: {preset}")
        selected_names = list(preset_substances(preset))

    raw_excludes = request.get("exclude", [])
    if not isinstance(raw_excludes, list):
        raise ValueError("exclude must be a list")
    excluded_names = {str(name) for name in raw_excludes}
    selected_names = [name for name in selected_names if name not in excluded_names]

    unknown_names = [name for name in selected_names if name not in SUBSTANCES_BY_NAME]
    if unknown_names:
        raise ValueError(f"Unknown substances: {unknown_names}")
    if not selected_names:
        raise ValueError("At least one substance must be selected")
    return selected_names


def _composition_by_name(request: dict[str, Any]) -> dict[str, float] | None:
    raw_composition = request.get("composition")
    if raw_composition in (None, {}):
        return None
    if not isinstance(raw_composition, dict):
        raise ValueError("composition must be a mapping from substance name to amount")
    return {
        str(name): max(0.0, float(amount))
        for name, amount in raw_composition.items()
        if float(amount) > 0.0
    }


def _float(request: dict[str, Any], key: str, default: float) -> float:
    value = request.get(key, default)
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{key} must be finite")
    return number


def _positive_float(request: dict[str, Any], key: str, default: float) -> float:
    number = _float(request, key, default)
    if number <= 0.0:
        raise ValueError(f"{key} must be positive")
    return number


def _bounded_float(
    request: dict[str, Any],
    key: str,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    return min(max(_float(request, key, default), minimum), maximum)


def _bounded_int(
    request: dict[str, Any],
    key: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    return min(max(int(request.get(key, default)), minimum), maximum)


def _plan_summary(plan: SearchPlan, initial_stream: MaterialStream) -> dict[str, object]:
    product_moles = sum(record.stage.product_total_moles for record in plan.product_records)
    solid_risk_by_name: dict[str, float] = {}
    for record in plan.product_records:
        for name, solid_moles in _solid_risk_by_name(record.stage).items():
            solid_risk_by_name[name] = solid_risk_by_name.get(name, 0.0) + solid_moles
    solid_risk_total = sum(solid_risk_by_name.values())

    return {
        "product_count": len(plan.product_records),
        "worst_product_purity": _json_float(plan.worst_product_purity),
        "cumulative_score": _json_float(plan.cumulative_score),
        "cumulative_energy_kj": _json_float(plan.cumulative_energy_kj),
        "cumulative_setpoint_cost": _json_float(plan.cumulative_setpoint_cost),
        "input_total_moles": _json_float(initial_stream.total_moles),
        "product_total_moles": _json_float(product_moles),
        "solid_risk_total_moles": _json_float(solid_risk_total),
        "solid_risk_fraction": _json_float(
            solid_risk_total / initial_stream.total_moles if initial_stream.total_moles > 0 else 0.0
        ),
        "solid_risk_by_name": [
            {"name": name, "moles": _json_float(moles)}
            for name, moles in sorted(solid_risk_by_name.items())
        ],
        "products_below_target": [
            {
                "name": record.stage.target_name,
                "final_purity": _json_float(record.polishing_final_purity),
            }
            for record in plan.product_records
            if record.polishing_passes_needed is None
        ],
        "remaining_targets": list(plan.remaining_target_names),
    }


def _stage_to_json(
    stage: StageEvaluation,
    stage_index: int,
    polishing_passes_needed: int | None,
) -> dict[str, object]:
    return {
        "stage_index": stage_index,
        "target_name": stage.target_name,
        "product_branch": stage.product_branch.value,
        "operation_kind": stage.operation_kind,
        "temperature_kelvin": _json_float(stage.temperature_kelvin),
        "temperature_celsius": _json_float(stage.temperature_celsius),
        "pressure_kpa": _json_float(stage.pressure_kpa),
        "product_purity": _json_float(stage.product_purity),
        "target_recovery": _json_float(stage.target_recovery),
        "target_loss_to_residue": _json_float(stage.target_loss_to_residue),
        "feed_total_moles": _json_float(stage.feed_stream.total_moles),
        "product_total_moles": _json_float(stage.product_total_moles),
        "residue_total_moles": _json_float(stage.residue_total_moles),
        "solid_risk_total_moles": _json_float(stage.solid_risk_total_moles),
        "estimated_heat_kj": _json_float(
            stage.estimated_sensible_heat_kj + stage.estimated_latent_heat_kj
        ),
        "setpoint_cost": _json_float(stage.setpoint_cost),
        "limiting_impurity_name": stage.limiting_impurity_name,
        "polishing_passes_needed": polishing_passes_needed,
        "hazards": [
            {
                "name": warning.name,
                "threshold_temperature_kelvin": _json_float(warning.threshold_temperature_kelvin),
                "reactants": list(warning.reactants),
                "severity": warning.severity,
            }
            for warning in stage.hazard_warnings
        ],
        "product_stream": _stream_to_json(stage.product_stream),
        "residue_stream": _stream_to_json(stage.residue_stream),
        "solid_risk_by_name": [
            {"name": name, "moles": _json_float(moles)}
            for name, moles in sorted(_solid_risk_by_name(stage).items())
        ],
        "phase_probabilities": [
            {
                "name": name,
                "liquid_probability": _json_float(probability.liquid_probability),
                "gas_probability": _json_float(probability.gas_probability),
                "solid_probability": _json_float(probability.solid_probability),
                "phase_margin_log_pressure": _json_float(
                    probability.phase_margin_log_pressure
                ),
                "phase_sigma_log_pressure": _json_float(probability.phase_sigma_log_pressure),
                "effective_pressure_kpa": _json_float(probability.effective_pressure_kpa),
                "vapor_pressure_kpa": _json_float(probability.vapor_pressure_kpa),
            }
            for name, probability in sorted(stage.phase_probabilities_by_name.items())
        ],
    }


def _solid_risk_by_name(stage: StageEvaluation) -> dict[str, float]:
    solid_risk_by_name: dict[str, float] = {}
    for name, feed_moles in stage.feed_stream.moles_by_substance_name.items():
        probability = stage.phase_probabilities_by_name.get(name)
        if probability is None or probability.solid_probability <= 0.0:
            continue
        solid_moles = max(0.0, feed_moles) * probability.solid_probability
        if solid_moles > 0.0:
            solid_risk_by_name[name] = solid_moles
    return solid_risk_by_name


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


def _graph_to_json(graph: ProcessGraph) -> dict[str, object]:
    return {
        "nodes": [
            {
                "node_id": node.node_id,
                "node_kind": node.node_kind,
                "parameters": {
                    key: _json_value(value) for key, value in node.parameters.items()
                },
            }
            for node in graph.nodes
        ],
        "edges": [
            {
                "source_node_id": edge.source_node_id,
                "destination_node_id": edge.destination_node_id,
                "parameters": {
                    key: _json_value(value) for key, value in edge.parameters.items()
                },
                "stream": _stream_to_json(edge.stream),
            }
            for edge in graph.edges
        ],
    }


def _json_value(value: float | int | str | bool | None) -> float | int | str | bool | None:
    if isinstance(value, float):
        return _json_float(value)
    return value


def _json_float(value: float | None) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return value
