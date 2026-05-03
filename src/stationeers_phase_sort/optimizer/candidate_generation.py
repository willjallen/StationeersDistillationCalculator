from __future__ import annotations

import math
from collections.abc import Sequence

from stationeers_phase_sort.models import (
    ControlNoise,
    MaterialStream,
    PlannerConfig,
    ProductBranch,
    StageEvaluation,
)
from stationeers_phase_sort.phase_curve import build_curve_points, vapor_pressure_kpa
from stationeers_phase_sort.stage_models import evaluate_branch, evaluate_stage, stage_from_branch
from stationeers_phase_sort.substances import SUBSTANCES_BY_NAME
from stationeers_phase_sort.units import clamp, safe_log


def get_temperature_search_bounds(
    feed_stream: MaterialStream,
    config: PlannerConfig,
) -> tuple[float, float]:
    feed_total_moles = max(feed_stream.total_moles, 1.0e-300)
    present_substances = [
        SUBSTANCES_BY_NAME[name]
        for name, moles in feed_stream.moles_by_substance_name.items()
        if moles > 1.0e-12
        and (moles / feed_total_moles) >= config.trace_mole_fraction_ignore_for_temperature_bounds
    ]

    lower_bound = 1.0
    upper_bound = 900.0

    phase_capable_substances = [
        substance for substance in present_substances if substance.can_phase_change
    ]
    if phase_capable_substances:
        melting_bounds: list[float] = []
        maximum_liquid_bounds: list[float] = []
        for substance in phase_capable_substances:
            assert substance.melting_temperature_kelvin is not None
            assert substance.maximum_liquid_temperature_kelvin is not None
            melting_bounds.append(
                substance.melting_temperature_kelvin + config.freezing_margin_kelvin
            )
            maximum_liquid_bounds.append(substance.maximum_liquid_temperature_kelvin)
        lower_bound = max(melting_bounds)
        upper_bound = max(maximum_liquid_bounds)

    upper_bound = max(upper_bound, lower_bound + 1.0)
    return lower_bound, upper_bound


def candidate_temperatures_for_stream(
    feed_stream: MaterialStream,
    config: PlannerConfig,
) -> list[float]:
    lower_bound, upper_bound = get_temperature_search_bounds(feed_stream, config)
    temperatures: set[float] = set()

    for sample_index in range(config.temperature_grid_count + 1):
        fraction = sample_index / max(1, config.temperature_grid_count)
        temperatures.add(lower_bound + fraction * (upper_bound - lower_bound))

    feed_total_moles = max(feed_stream.total_moles, 1.0e-300)
    for name, moles in feed_stream.moles_by_substance_name.items():
        if (
            moles <= 1.0e-12
            or (moles / feed_total_moles) < config.trace_mole_fraction_ignore_for_temperature_bounds
        ):
            continue
        substance = SUBSTANCES_BY_NAME[name]
        if not substance.can_phase_change:
            continue
        assert substance.melting_temperature_kelvin is not None
        assert substance.maximum_liquid_temperature_kelvin is not None

        for offset in (config.freezing_margin_kelvin, 5.0, 10.0):
            temperatures.add(substance.melting_temperature_kelvin + offset)
        if substance.boiling_temperature_kelvin_at_100_kpa is not None:
            for offset in (-5.0, 0.0, 5.0):
                temperatures.add(substance.boiling_temperature_kelvin_at_100_kpa + offset)
        for offset in (-20.0, -10.0, -5.0, -1.0):
            temperatures.add(substance.maximum_liquid_temperature_kelvin + offset)
        for curve_point in build_curve_points(substance):
            for offset in (-5.0, 0.0, 5.0):
                temperatures.add(curve_point.temperature_kelvin + offset)

    return sorted(
        temperature for temperature in temperatures if lower_bound <= temperature <= upper_bound
    )


def candidate_pressures_for_temperature(
    feed_stream: MaterialStream,
    temperature_kelvin: float,
    config: PlannerConfig,
) -> list[float]:
    log_minimum_pressure = safe_log(config.minimum_process_pressure_kpa)
    log_maximum_pressure = safe_log(config.maximum_process_pressure_kpa)
    pressures: set[float] = set()

    for sample_index in range(config.pressure_grid_count + 1):
        fraction = sample_index / max(1, config.pressure_grid_count)
        pressures.add(
            math.exp(
                log_minimum_pressure + fraction * (log_maximum_pressure - log_minimum_pressure)
            )
        )

    feed_total_moles = max(feed_stream.total_moles, 1.0e-300)
    for name, moles in feed_stream.moles_by_substance_name.items():
        if (
            moles <= 1.0e-12
            or (moles / feed_total_moles) < config.trace_mole_fraction_ignore_for_temperature_bounds
        ):
            continue
        substance = SUBSTANCES_BY_NAME[name]
        vapor_pressure = vapor_pressure_kpa(substance, temperature_kelvin)
        if vapor_pressure is None or not math.isfinite(vapor_pressure) or vapor_pressure <= 0.0:
            continue
        for multiplier in (0.25, 0.5, 0.75, 0.90, 0.98, 1.02, 1.10, 1.333, 2.0, 4.0):
            pressures.add(vapor_pressure * multiplier)

    if feed_stream.pressure_kpa is not None:
        for multiplier in (0.25, 0.5, 1.0, 2.0, 4.0):
            pressures.add(feed_stream.pressure_kpa * multiplier)

    pressures.update((100.0, 1000.0, 2000.0, 6000.0))

    return sorted(
        pressure
        for pressure in pressures
        if config.minimum_process_pressure_kpa <= pressure <= config.maximum_process_pressure_kpa
    )


def local_refine_stage(
    initial_stage: StageEvaluation,
    feed_stream: MaterialStream,
    target_name: str,
    product_branch: ProductBranch,
    noise: ControlNoise,
    config: PlannerConfig,
) -> StageEvaluation:
    lower_temperature, upper_temperature = get_temperature_search_bounds(feed_stream, config)
    lower_log_pressure = safe_log(config.minimum_process_pressure_kpa)
    upper_log_pressure = safe_log(config.maximum_process_pressure_kpa)

    best_stage = initial_stage
    temperature_step = max(
        1.0,
        (upper_temperature - lower_temperature) / max(4.0, config.temperature_grid_count / 2.0),
    )
    log_pressure_step = max(
        0.05,
        (upper_log_pressure - lower_log_pressure) / max(4.0, config.pressure_grid_count / 2.0),
    )

    for _ in range(config.local_refinement_rounds):
        improved = False
        candidate_offsets = [
            (-temperature_step, -log_pressure_step),
            (-temperature_step, 0.0),
            (-temperature_step, log_pressure_step),
            (0.0, -log_pressure_step),
            (0.0, log_pressure_step),
            (temperature_step, -log_pressure_step),
            (temperature_step, 0.0),
            (temperature_step, log_pressure_step),
        ]

        for temperature_offset, log_pressure_offset in candidate_offsets:
            candidate_temperature = clamp(
                best_stage.temperature_kelvin + temperature_offset,
                lower_temperature,
                upper_temperature,
            )
            candidate_pressure = math.exp(
                clamp(
                    safe_log(best_stage.pressure_kpa) + log_pressure_offset,
                    lower_log_pressure,
                    upper_log_pressure,
                )
            )
            candidate_stage = evaluate_stage(
                feed_stream,
                target_name,
                product_branch,
                candidate_temperature,
                candidate_pressure,
                noise,
                config,
            )
            if candidate_stage.score > best_stage.score:
                best_stage = candidate_stage
                improved = True

        if not improved:
            temperature_step *= 0.5
            log_pressure_step *= 0.5

    return best_stage


def top_stage_candidates(
    feed_stream: MaterialStream,
    target_name: str,
    product_branch: ProductBranch,
    noise: ControlNoise,
    config: PlannerConfig,
    keep_count: int,
) -> list[StageEvaluation]:
    temperatures = candidate_temperatures_for_stream(feed_stream, config)
    best_by_bin: dict[tuple[int, int], StageEvaluation] = {}

    for temperature in temperatures:
        pressures = candidate_pressures_for_temperature(feed_stream, temperature, config)
        for pressure in pressures:
            stage = evaluate_stage(
                feed_stream,
                target_name,
                product_branch,
                temperature,
                pressure,
                noise,
                config,
            )
            if not _is_useful_stage(stage, config):
                continue

            temperature_bin = int(round(stage.temperature_kelvin / 2.0))
            pressure_bin = int(round(safe_log(stage.pressure_kpa) / 0.10))
            key = (temperature_bin, pressure_bin)
            previous = best_by_bin.get(key)
            if previous is None or stage.score > previous.score:
                best_by_bin[key] = stage

    rough_candidates = sorted(
        best_by_bin.values(),
        key=lambda candidate: candidate.score,
        reverse=True,
    )[: max(keep_count * 3, keep_count)]
    refined_candidates = [
        local_refine_stage(candidate, feed_stream, target_name, product_branch, noise, config)
        for candidate in rough_candidates
    ]

    refined_candidates.sort(key=lambda candidate: candidate.score, reverse=True)
    return _unique_stages(refined_candidates, keep_count, config)


def top_stage_candidates_for_all_targets(
    feed_stream: MaterialStream,
    target_names: Sequence[str],
    noise: ControlNoise,
    config: PlannerConfig,
    keep_count: int,
) -> dict[tuple[str, ProductBranch], list[StageEvaluation]]:
    best_candidates: dict[tuple[str, ProductBranch], list[StageEvaluation]] = {
        (target_name, product_branch): []
        for target_name in target_names
        for product_branch in (ProductBranch.LIQUID, ProductBranch.GAS)
    }

    def maybe_add_candidate(stage: StageEvaluation) -> None:
        if not _is_useful_stage(stage, config):
            return
        key = (stage.target_name, stage.product_branch)
        candidates = best_candidates[key]
        candidates.append(stage)
        candidates.sort(key=lambda candidate: candidate.score, reverse=True)
        del candidates[max(keep_count * 4, keep_count) :]

    temperatures = candidate_temperatures_for_stream(feed_stream, config)
    for temperature in temperatures:
        pressures = candidate_pressures_for_temperature(feed_stream, temperature, config)
        for pressure in pressures:
            for product_branch in (ProductBranch.LIQUID, ProductBranch.GAS):
                branch = evaluate_branch(
                    feed_stream, product_branch, temperature, pressure, noise, config
                )
                for target_name in target_names:
                    if (
                        feed_stream.moles_by_substance_name.get(target_name, 0.0)
                        <= config.minimum_branch_total_moles
                    ):
                        continue
                    maybe_add_candidate(stage_from_branch(branch, target_name, config))

    refined_result: dict[tuple[str, ProductBranch], list[StageEvaluation]] = {}
    for key, candidates in best_candidates.items():
        target_name, product_branch = key
        refined_candidates = [
            local_refine_stage(candidate, feed_stream, target_name, product_branch, noise, config)
            for candidate in candidates[: max(keep_count * 2, keep_count)]
        ]
        refined_candidates.sort(key=lambda candidate: candidate.score, reverse=True)
        refined_result[key] = _unique_stages(refined_candidates, keep_count, config)

    return refined_result


def _is_useful_stage(stage: StageEvaluation, config: PlannerConfig) -> bool:
    return (
        math.isfinite(stage.score)
        and stage.target_recovery >= config.minimum_target_recovery_for_stage
        and stage.product_purity >= config.minimum_product_purity_for_stage
        and stage.product_total_moles > config.minimum_branch_total_moles
    )


def _unique_stages(
    stages: list[StageEvaluation],
    keep_count: int,
    config: PlannerConfig,
) -> list[StageEvaluation]:
    unique_candidates: list[StageEvaluation] = []
    seen: set[tuple[float, float, ProductBranch, str]] = set()
    for candidate in stages:
        if not _is_useful_stage(candidate, config):
            continue
        unique_key = (
            round(candidate.temperature_kelvin, 2),
            round(candidate.pressure_kpa, 1),
            candidate.product_branch,
            candidate.target_name,
        )
        if unique_key in seen:
            continue
        seen.add(unique_key)
        unique_candidates.append(candidate)
        if len(unique_candidates) >= keep_count:
            break
    return unique_candidates
