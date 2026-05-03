from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import TextIO

from stationeers_phase_sort.models import (
    ControlNoise,
    MaterialStream,
    PlannerConfig,
    ProcessGraph,
    SearchPlan,
    StageEvaluation,
)
from stationeers_phase_sort.optimizer.polishing import required_polishing_passes
from stationeers_phase_sort.partition_models import branch_fraction
from stationeers_phase_sort.process_graph import plan_to_process_graph
from stationeers_phase_sort.stage_models import evaluate_stage
from stationeers_phase_sort.streams import sorted_composition_items
from stationeers_phase_sort.units import format_temperature, safe_log


def print_stream_composition(
    stream: MaterialStream,
    indent: str = "    ",
    maximum_rows: int = 8,
    file: TextIO | None = None,
) -> None:
    output = file
    rows = sorted_composition_items(stream)
    for name, moles, fraction in rows[:maximum_rows]:
        print(f"{indent}{name:<20} {moles:12.6g} mol  {fraction * 100.0:10.6f}%", file=output)
    if len(rows) > maximum_rows:
        print(f"{indent}... {len(rows) - maximum_rows} more", file=output)


def print_initial_stream(
    stream: MaterialStream,
    pressure_model: str,
    file: TextIO | None = None,
) -> None:
    print("Initial stream:", file=file)
    print(f"    pressure model: {pressure_model}", file=file)
    print(f"    initial T: {format_temperature(stream.temperature_kelvin or 293.15)}", file=file)
    print(f"    initial P: {stream.pressure_kpa or 100.0:.3f} kPa", file=file)
    print(f"    total: {stream.total_moles:.6g} mol", file=file)
    print_stream_composition(stream, file=file)


def print_stage(
    stage: StageEvaluation,
    stage_index: int,
    polishing_passes_needed: int | None,
    polishing_final_purity: float,
    polishing_final_yield_fraction: float,
    show_probabilities: bool = False,
    file: TextIO | None = None,
) -> None:
    print(
        f"{stage_index:02d}. {stage.target_name} as {stage.product_branch.value.upper()} | "
        f"T={stage.temperature_kelvin:.3f} K ({stage.temperature_celsius:.3f} C), "
        f"P={stage.pressure_kpa:.3f} kPa | "
        f"purity={stage.product_purity * 100.0:.6f}%, "
        f"target recovery={stage.target_recovery * 100.0:.6f}%",
        file=file,
    )
    print(
        f"    product={stage.product_total_moles:.6g} mol, residue={stage.residue_total_moles:.6g} mol, "
        f"solid-risk={stage.solid_risk_total_moles:.6g} mol, "
        f"heat~={stage.estimated_sensible_heat_kj + stage.estimated_latent_heat_kj:.3f} kJ, "
        f"setpoint-cost={stage.setpoint_cost:.4f}",
        file=file,
    )
    if stage.limiting_impurity_name:
        print(f"    limiting impurity: {stage.limiting_impurity_name}", file=file)
    for warning in stage.hazard_warnings:
        print(
            f"    HAZARD: {warning.name}; threshold {warning.threshold_temperature_kelvin:.2f} K; "
            f"severity={warning.severity}",
            file=file,
        )

    if polishing_passes_needed is None:
        print(
            f"    polishing: did not reach target purity; best within pass limit = "
            f"{polishing_final_purity * 100.0:.6f}% at target yield "
            f"{polishing_final_yield_fraction * 100.0:.6f}%",
            file=file,
        )
    else:
        print(
            f"    polishing: {polishing_passes_needed} pass(es) to target purity; "
            f"final purity={polishing_final_purity * 100.0:.6f}%, "
            f"target yield={polishing_final_yield_fraction * 100.0:.6f}%",
            file=file,
        )

    print("    product composition:", file=file)
    print_stream_composition(stage.product_stream, indent="        ", file=file)

    if show_probabilities:
        print("    branch probabilities:", file=file)
        for name, probability in sorted(stage.phase_probabilities_by_name.items()):
            product_retention = branch_fraction(probability, stage.product_branch)
            vapor_pressure_text = (
                "n/a"
                if probability.vapor_pressure_kpa is None
                else (
                    "inf"
                    if math.isinf(probability.vapor_pressure_kpa)
                    else f"{probability.vapor_pressure_kpa:.3f}"
                )
            )
            print(
                f"        {name:<20} product={product_retention:9.6f} "
                f"liq={probability.liquid_probability:9.6f} "
                f"gas={probability.gas_probability:9.6f} "
                f"solid={probability.solid_probability:9.6f} "
                f"Pvap={vapor_pressure_text:>10} kPa "
                f"margin={probability.phase_margin_log_pressure:9.4f}",
                file=file,
            )


def print_plan(
    plan: SearchPlan,
    show_probabilities: bool = False,
    file: TextIO | None = None,
) -> None:
    print(file=file)
    print("=== BEST PLAN FOUND ===", file=file)
    print(f"products: {len(plan.product_records)}", file=file)
    print(f"worst one-pass product purity: {plan.worst_product_purity * 100.0:.6f}%", file=file)
    print(f"cumulative score: {plan.cumulative_score:.4f}", file=file)
    print(f"approx cumulative heat moved/released: {plan.cumulative_energy_kj:.3f} kJ", file=file)
    print(f"cumulative setpoint cost: {plan.cumulative_setpoint_cost:.4f}", file=file)
    print(file=file)

    previous_temperature: float | None = None
    previous_pressure: float | None = None
    for record in plan.product_records:
        stage = record.stage
        print_stage(
            stage,
            record.stage_index,
            record.polishing_passes_needed,
            record.polishing_final_purity,
            record.polishing_final_yield_fraction,
            show_probabilities=show_probabilities,
            file=file,
        )
        if previous_temperature is not None and previous_pressure is not None:
            print(
                f"    delta from previous stage: "
                f"dT={stage.temperature_kelvin - previous_temperature:+.3f} K, "
                f"dP={stage.pressure_kpa - previous_pressure:+.3f} kPa, "
                f"dlogP={safe_log(stage.pressure_kpa) - safe_log(previous_pressure):+.4f}",
                file=file,
            )
        previous_temperature = stage.temperature_kelvin
        previous_pressure = stage.pressure_kpa
        print(file=file)


def print_polishing_sensitivity(
    stage: StageEvaluation,
    target_purity: float,
    maximum_passes: int,
    temperature_sigmas_kelvin: list[float],
    pressure_sigma_fraction: float,
    config: PlannerConfig,
    file: TextIO | None = None,
) -> None:
    print(file=file)
    print(
        f"=== POLISHING SENSITIVITY: {stage.target_name} as {stage.product_branch.value.upper()} ===",
        file=file,
    )
    print(
        f"{'sigma_T K':>10} {'passes':>8} {'final purity %':>16} {'target yield %':>16} "
        f"{'one-pass purity %':>18} {'one-pass recovery %':>20}",
        file=file,
    )
    print("-" * 96, file=file)

    for sigma_temperature in temperature_sigmas_kelvin:
        noise = ControlNoise(
            temperature_sigma_kelvin=sigma_temperature,
            pressure_sigma_fraction=pressure_sigma_fraction,
            pressure_sigma_kpa=0.0,
            extra_model_sigma_log_pressure=0.0,
        )
        reevaluated_stage = evaluate_stage(
            stage.feed_stream,
            stage.target_name,
            stage.product_branch,
            stage.temperature_kelvin,
            stage.pressure_kpa,
            noise,
            config,
        )
        passes, final_purity, final_yield = required_polishing_passes(
            reevaluated_stage.product_stream,
            reevaluated_stage,
            stage.target_name,
            target_purity,
            maximum_passes,
        )
        passes_text = str(passes) if passes is not None else f">{maximum_passes}"
        print(
            f"{sigma_temperature:10.3f} {passes_text:>8} "
            f"{final_purity * 100.0:16.8f} {final_yield * 100.0:16.8f} "
            f"{reevaluated_stage.product_purity * 100.0:18.8f} "
            f"{reevaluated_stage.target_recovery * 100.0:20.8f}",
            file=file,
        )


def write_stages_csv(plan: SearchPlan, path: str | Path) -> None:
    with Path(path).open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(
            [
                "stage_index",
                "operation_kind",
                "target_substance",
                "selected_branch",
                "temperature_kelvin",
                "temperature_celsius",
                "pressure_kpa",
                "target_purity",
                "target_recovery",
                "product_moles",
                "residue_moles",
                "solid_risk_moles",
                "estimated_heat_kj",
                "setpoint_cost",
                "polishing_passes_needed",
                "polishing_final_purity",
                "polishing_final_yield",
                "limiting_impurity",
                "hazards",
            ]
        )
        for record in plan.product_records:
            stage = record.stage
            writer.writerow(
                [
                    record.stage_index,
                    stage.operation_kind,
                    stage.target_name,
                    stage.product_branch.value,
                    stage.temperature_kelvin,
                    stage.temperature_celsius,
                    stage.pressure_kpa,
                    stage.product_purity,
                    stage.target_recovery,
                    stage.product_total_moles,
                    stage.residue_total_moles,
                    stage.solid_risk_total_moles,
                    stage.estimated_sensible_heat_kj + stage.estimated_latent_heat_kj,
                    stage.setpoint_cost,
                    record.polishing_passes_needed
                    if record.polishing_passes_needed is not None
                    else "",
                    record.polishing_final_purity,
                    record.polishing_final_yield_fraction,
                    stage.limiting_impurity_name or "",
                    "; ".join(warning.name for warning in stage.hazard_warnings),
                ]
            )


def write_products_csv(plan: SearchPlan, path: str | Path) -> None:
    with Path(path).open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(
            [
                "product_substance",
                "capture_stage",
                "selected_branch",
                "raw_product_purity",
                "raw_product_recovery",
                "recommended_polishing_passes",
                "expected_final_purity",
                "expected_final_recovery",
                "main_contaminants",
                "limiting_impurity",
            ]
        )
        for record in plan.product_records:
            stage = record.stage
            contaminants = [
                f"{name}:{fraction:.6g}"
                for name, _, fraction in sorted_composition_items(stage.product_stream)
                if name != stage.target_name
            ][:5]
            writer.writerow(
                [
                    stage.target_name,
                    record.stage_index,
                    stage.product_branch.value,
                    stage.product_purity,
                    stage.target_recovery,
                    record.polishing_passes_needed
                    if record.polishing_passes_needed is not None
                    else "",
                    record.polishing_final_purity,
                    record.polishing_final_yield_fraction,
                    "; ".join(contaminants),
                    stage.limiting_impurity_name or "",
                ]
            )


def write_report_markdown(plan: SearchPlan, path: str | Path) -> None:
    with Path(path).open("w", encoding="utf-8") as file:
        file.write("# Stationeers Phase Sort Plan\n\n")
        file.write(f"- Products: {len(plan.product_records)}\n")
        file.write(f"- Worst one-pass purity: {plan.worst_product_purity * 100.0:.6f}%\n")
        file.write(f"- Cumulative score: {plan.cumulative_score:.4f}\n")
        file.write(f"- Approx heat moved/released: {plan.cumulative_energy_kj:.3f} kJ\n\n")

        for record in plan.product_records:
            stage = record.stage
            file.write(f"## {record.stage_index:02d}. {stage.target_name}\n\n")
            file.write(f"- Branch: {stage.product_branch.value}\n")
            file.write(
                f"- Temperature: {stage.temperature_kelvin:.3f} K / {stage.temperature_celsius:.3f} C\n"
            )
            file.write(f"- Pressure: {stage.pressure_kpa:.3f} kPa\n")
            file.write(f"- Purity: {stage.product_purity * 100.0:.6f}%\n")
            file.write(f"- Recovery: {stage.target_recovery * 100.0:.6f}%\n")
            file.write(f"- Polishing passes: {record.polishing_passes_needed or 'not reached'}\n")
            if stage.limiting_impurity_name:
                file.write(f"- Limiting impurity: {stage.limiting_impurity_name}\n")
            if stage.hazard_warnings:
                file.write(
                    "- Hazards: "
                    + "; ".join(warning.name for warning in stage.hazard_warnings)
                    + "\n"
                )
            file.write("\n")


def write_process_graph_json(plan: SearchPlan, path: str | Path) -> None:
    graph = plan_to_process_graph(plan)
    with Path(path).open("w", encoding="utf-8") as file:
        json.dump(_process_graph_to_jsonable(graph), file, indent=2)
        file.write("\n")


def _process_graph_to_jsonable(graph: ProcessGraph) -> dict[str, object]:
    return {
        "nodes": [
            {
                "node_id": node.node_id,
                "node_kind": node.node_kind,
                "parameters": node.parameters,
            }
            for node in graph.nodes
        ],
        "edges": [
            {
                "source_node_id": edge.source_node_id,
                "destination_node_id": edge.destination_node_id,
                "stream": None
                if edge.stream is None
                else {
                    "phase_hint": edge.stream.phase_hint,
                    "temperature_kelvin": edge.stream.temperature_kelvin,
                    "pressure_kpa": edge.stream.pressure_kpa,
                    "volume_liters": edge.stream.volume_liters,
                    "total_moles": edge.stream.total_moles,
                    "moles_by_substance_name": edge.stream.moles_by_substance_name,
                },
            }
            for edge in graph.edges
        ],
    }
