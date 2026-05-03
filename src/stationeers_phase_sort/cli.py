from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import yaml

from stationeers_phase_sort.data_loader import validate_database
from stationeers_phase_sort.models import ControlNoise, PlannerConfig, PressureModel
from stationeers_phase_sort.optimizer.beam_search import search_phase_chain_beam
from stationeers_phase_sort.optimizer.greedy import search_phase_chain_greedy
from stationeers_phase_sort.phase_curve import PhaseCurve, build_curve_points
from stationeers_phase_sort.presets import preset_substances
from stationeers_phase_sort.reporting import (
    print_initial_stream,
    print_plan,
    print_polishing_sensitivity,
    write_process_graph_json,
    write_products_csv,
    write_report_markdown,
    write_stages_csv,
)
from stationeers_phase_sort.streams import make_initial_stream
from stationeers_phase_sort.substances import SUBSTANCES_BY_NAME


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="stationeers-phase-sort",
        description="Search Stationeers phase-change gas/liquid sorting systems.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    plan_parser = subparsers.add_parser(
        "plan",
        help="Build a phase-change sorting plan.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    plan_parser.add_argument("--preset", default="all-gases", help="Packaged feed preset.")
    plan_parser.add_argument(
        "--substances",
        nargs="*",
        default=None,
        help="Explicit substance list. Overrides --preset.",
    )
    plan_parser.add_argument(
        "--exclude",
        nargs="*",
        default=[],
        help="Substances to remove after preset/substance selection.",
    )
    plan_parser.add_argument(
        "--composition",
        default=None,
        help="YAML/JSON mapping from substance name to fraction or moles.",
    )
    plan_parser.add_argument("--total-moles", type=float, default=100.0)
    plan_parser.add_argument("--initial-temperature-kelvin", type=float, default=293.15)
    plan_parser.add_argument("--initial-pressure-kpa", type=float, default=100.0)
    plan_parser.add_argument(
        "--pressure-model",
        choices=[model.value for model in PressureModel],
        default=PressureModel.TOTAL.value,
    )
    plan_parser.add_argument("--maximum-pressure-kpa", type=float, default=6000.0)
    plan_parser.add_argument("--temperature-error-kelvin", type=float, default=0.50)
    plan_parser.add_argument("--pressure-error-fraction", type=float, default=0.01)
    plan_parser.add_argument("--model-error-log-pressure", type=float, default=0.02)
    plan_parser.add_argument("--target-purity", type=float, default=0.9999)
    plan_parser.add_argument("--minimum-stage-purity", type=float, default=0.25)
    plan_parser.add_argument("--maximum-polishing-passes", type=int, default=80)
    plan_parser.add_argument("--temperature-grid", type=int, default=24)
    plan_parser.add_argument("--pressure-grid", type=int, default=24)
    plan_parser.add_argument("--beam-width", type=int, default=16)
    plan_parser.add_argument("--local-refinement-rounds", type=int, default=0)
    plan_parser.add_argument("--keep-per-target", type=int, default=2)
    plan_parser.add_argument(
        "--search-mode",
        choices=["greedy", "beam"],
        default="greedy",
    )
    plan_parser.add_argument("--show-probabilities", action="store_true")
    plan_parser.add_argument("--sensitivity", action="store_true")
    plan_parser.add_argument(
        "--sensitivity-temperatures-kelvin",
        nargs="*",
        type=float,
        default=[0.0, 0.10, 0.25, 0.50, 1.0, 2.0, 5.0],
    )
    plan_parser.add_argument("--output", default=None, help="Markdown report path.")
    plan_parser.add_argument("--output-csv", default=None, help="Stage CSV path.")
    plan_parser.add_argument("--output-products-csv", default=None, help="Product CSV path.")
    plan_parser.add_argument("--output-graph", default=None, help="Process graph JSON path.")
    plan_parser.set_defaults(handler=run_plan)

    validate_parser = subparsers.add_parser("validate-data", help="Validate packaged YAML data.")
    validate_parser.set_defaults(handler=run_validate_data)

    inspect_parser = subparsers.add_parser(
        "inspect-substance",
        help="Print phase-curve data for one substance.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    inspect_parser.add_argument("name")
    inspect_parser.add_argument("--temperature-kelvin", type=float, default=None)
    inspect_parser.set_defaults(handler=run_inspect_substance)

    return parser


def run_plan(arguments: argparse.Namespace) -> int:
    selected_names = _select_substances(arguments)
    composition_by_name = (
        _load_composition(arguments.composition) if arguments.composition else None
    )

    initial_stream = make_initial_stream(
        selected_names,
        total_moles_value=arguments.total_moles,
        temperature_kelvin=arguments.initial_temperature_kelvin,
        pressure_kpa=arguments.initial_pressure_kpa,
        composition_by_name=composition_by_name,
    )

    config = PlannerConfig(
        pressure_model=PressureModel(arguments.pressure_model),
        maximum_process_pressure_kpa=arguments.maximum_pressure_kpa,
        target_final_purity=arguments.target_purity,
        maximum_polishing_passes=arguments.maximum_polishing_passes,
        temperature_grid_count=arguments.temperature_grid,
        pressure_grid_count=arguments.pressure_grid,
        beam_width=arguments.beam_width,
        candidate_keep_per_target=arguments.keep_per_target,
        minimum_product_purity_for_stage=arguments.minimum_stage_purity,
        local_refinement_rounds=arguments.local_refinement_rounds,
    )
    noise = ControlNoise(
        temperature_sigma_kelvin=arguments.temperature_error_kelvin,
        pressure_sigma_fraction=arguments.pressure_error_fraction,
        pressure_sigma_kpa=0.0,
        extra_model_sigma_log_pressure=arguments.model_error_log_pressure,
    )

    print_initial_stream(initial_stream, config.pressure_model.value)
    plan = (
        search_phase_chain_greedy(initial_stream, selected_names, noise, config)
        if arguments.search_mode == "greedy"
        else search_phase_chain_beam(initial_stream, selected_names, noise, config)
    )
    print_plan(plan, show_probabilities=arguments.show_probabilities)

    if arguments.sensitivity:
        for record in plan.product_records:
            print_polishing_sensitivity(
                record.stage,
                target_purity=arguments.target_purity,
                maximum_passes=arguments.maximum_polishing_passes,
                temperature_sigmas_kelvin=arguments.sensitivity_temperatures_kelvin,
                pressure_sigma_fraction=arguments.pressure_error_fraction,
                config=config,
            )

    if arguments.output:
        write_report_markdown(plan, arguments.output)
        print(f"Wrote report: {arguments.output}")
    if arguments.output_csv:
        write_stages_csv(plan, arguments.output_csv)
        print(f"Wrote stage CSV: {arguments.output_csv}")
    if arguments.output_products_csv:
        write_products_csv(plan, arguments.output_products_csv)
        print(f"Wrote product CSV: {arguments.output_products_csv}")
    if arguments.output_graph:
        write_process_graph_json(plan, arguments.output_graph)
        print(f"Wrote process graph: {arguments.output_graph}")

    return 0


def run_validate_data(_arguments: argparse.Namespace) -> int:
    validate_database()
    print("Data validation passed.")
    return 0


def run_inspect_substance(arguments: argparse.Namespace) -> int:
    substance = SUBSTANCES_BY_NAME.get(arguments.name)
    if substance is None:
        raise SystemExit(f"Unknown substance: {arguments.name}")

    print(f"{substance.name} ({substance.formula})")
    print(f"phase-change enabled: {substance.can_phase_change}")
    if substance.hazard_tags:
        print(f"hazard tags: {', '.join(substance.hazard_tags)}")

    curve_points = build_curve_points(substance)
    if curve_points:
        print("curve points:")
        for point in curve_points:
            print(f"  {point.temperature_kelvin:.3f} K -> {point.pressure_kpa:.3f} kPa")

    if arguments.temperature_kelvin is not None:
        result = PhaseCurve(substance).vapor_pressure_kpa(arguments.temperature_kelvin)
        vapor_pressure = (
            "n/a"
            if result.vapor_pressure_kpa is None
            else (
                "inf"
                if result.vapor_pressure_kpa == float("inf")
                else f"{result.vapor_pressure_kpa:.6f} kPa"
            )
        )
        print(
            f"at {arguments.temperature_kelvin:.3f} K: "
            f"status={result.status.value}, vapor_pressure={vapor_pressure}"
        )

    return 0


def _select_substances(arguments: argparse.Namespace) -> list[str]:
    selected_names = (
        list(arguments.substances)
        if arguments.substances is not None and len(arguments.substances) > 0
        else list(preset_substances(arguments.preset))
    )
    excluded_names = set(arguments.exclude)
    selected_names = [name for name in selected_names if name not in excluded_names]
    unknown_names = [name for name in selected_names if name not in SUBSTANCES_BY_NAME]
    if unknown_names:
        raise SystemExit(f"Unknown substances: {unknown_names}")
    if not selected_names:
        raise SystemExit("No substances selected.")
    return selected_names


def _load_composition(path: str) -> dict[str, float]:
    with Path(path).open("r", encoding="utf-8") as file:
        loaded: Any = yaml.safe_load(file)
    if not isinstance(loaded, dict):
        raise ValueError(
            "Composition file must be a mapping from substance name to fraction or moles"
        )
    return {str(name): float(amount) for name, amount in loaded.items()}


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    arguments = parser.parse_args(argv)
    handler = arguments.handler
    return int(handler(arguments))


if __name__ == "__main__":
    raise SystemExit(main())
