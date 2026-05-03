from __future__ import annotations

import math
from typing import Literal

from stationeers_phase_sort.energy_model import (
    estimate_latent_heat_kj,
    estimate_sensible_heat_kj,
)
from stationeers_phase_sort.hazards import active_hazards
from stationeers_phase_sort.models import (
    BranchEvaluation,
    ControlNoise,
    MaterialStream,
    PhaseProbability,
    PlannerConfig,
    ProductBranch,
    StageEvaluation,
)
from stationeers_phase_sort.partition_models import branch_fraction, phase_probability
from stationeers_phase_sort.substances import SUBSTANCES_BY_NAME
from stationeers_phase_sort.units import logit_clamped, safe_log


def evaluate_branch(
    feed_stream: MaterialStream,
    product_branch: ProductBranch,
    temperature_kelvin: float,
    pressure_kpa: float,
    noise: ControlNoise,
    config: PlannerConfig,
) -> BranchEvaluation:
    composition = feed_stream.normalized_composition()
    phase_probabilities_by_name: dict[str, PhaseProbability] = {}
    product_moles_by_name: dict[str, float] = {}
    residue_moles_by_name: dict[str, float] = {}
    solid_risk_total_moles = 0.0

    for name, feed_moles in feed_stream.moles_by_substance_name.items():
        substance = SUBSTANCES_BY_NAME[name]
        phase_probability_value = phase_probability(
            substance,
            temperature_kelvin,
            pressure_kpa,
            composition.get(name, 0.0),
            noise,
            config,
        )
        phase_probabilities_by_name[name] = phase_probability_value
        product_fraction = branch_fraction(phase_probability_value, product_branch)
        product_moles_by_name[name] = max(0.0, feed_moles) * product_fraction
        residue_moles_by_name[name] = max(0.0, feed_moles) * max(
            0.0,
            1.0 - product_fraction - phase_probability_value.solid_probability,
        )
        solid_risk_total_moles += max(0.0, feed_moles) * phase_probability_value.solid_probability

    product_stream = MaterialStream(
        moles_by_substance_name=product_moles_by_name,
        temperature_kelvin=temperature_kelvin,
        pressure_kpa=pressure_kpa,
        phase_hint=product_branch.value,
    ).without_tiny_entries()
    residue_phase_hint: Literal["gas", "liquid", "mixed", "unknown", "empty"] = (
        "gas" if product_branch == ProductBranch.LIQUID else "liquid"
    )
    residue_stream = MaterialStream(
        moles_by_substance_name=residue_moles_by_name,
        temperature_kelvin=temperature_kelvin,
        pressure_kpa=pressure_kpa,
        phase_hint=residue_phase_hint,
    ).without_tiny_entries()

    estimated_sensible_heat = estimate_sensible_heat_kj(feed_stream, temperature_kelvin)
    estimated_latent_heat = estimate_latent_heat_kj(
        feed_stream,
        phase_probabilities_by_name,
        product_branch,
    )

    temperature_change_cost = (
        0.0
        if feed_stream.temperature_kelvin is None
        else abs(temperature_kelvin - feed_stream.temperature_kelvin)
    )
    pressure_change_cost = (
        0.0
        if feed_stream.pressure_kpa is None
        else abs(safe_log(pressure_kpa) - safe_log(feed_stream.pressure_kpa))
    )

    setpoint_cost = (
        config.stage_temperature_change_cost_weight * temperature_change_cost
        + config.stage_pressure_change_cost_weight * pressure_change_cost
        + config.sensible_heat_cost_weight * estimated_sensible_heat
        + config.latent_heat_cost_weight * estimated_latent_heat
    )

    return BranchEvaluation(
        product_branch=product_branch,
        temperature_kelvin=temperature_kelvin,
        pressure_kpa=pressure_kpa,
        feed_stream=feed_stream,
        product_stream=product_stream,
        residue_stream=residue_stream,
        phase_probabilities_by_name=phase_probabilities_by_name,
        product_total_moles=product_stream.total_moles,
        residue_total_moles=residue_stream.total_moles,
        estimated_sensible_heat_kj=estimated_sensible_heat,
        estimated_latent_heat_kj=estimated_latent_heat,
        setpoint_cost=setpoint_cost,
        solid_risk_total_moles=solid_risk_total_moles,
        hazard_warnings=active_hazards(feed_stream, temperature_kelvin),
    )


def stage_from_branch(
    branch: BranchEvaluation,
    target_name: str,
    config: PlannerConfig,
) -> StageEvaluation:
    product_total_moles = branch.product_total_moles
    residue_total_moles = branch.residue_total_moles
    target_product_moles = branch.product_stream.moles_by_substance_name.get(target_name, 0.0)
    feed_target_moles = max(0.0, branch.feed_stream.moles_by_substance_name.get(target_name, 0.0))
    target_residue_moles = branch.residue_stream.moles_by_substance_name.get(target_name, 0.0)

    product_purity = (
        target_product_moles / product_total_moles if product_total_moles > 0.0 else 0.0
    )
    target_recovery = target_product_moles / feed_target_moles if feed_target_moles > 0.0 else 0.0
    target_loss_to_residue = (
        target_residue_moles / feed_target_moles if feed_target_moles > 0.0 else 0.0
    )

    impurity_by_name = {
        name: moles
        for name, moles in branch.product_stream.moles_by_substance_name.items()
        if name != target_name
    }
    limiting_impurity_name = (
        max(impurity_by_name, key=lambda name: impurity_by_name[name]) if impurity_by_name else None
    )

    if product_total_moles <= config.minimum_branch_total_moles:
        score = -math.inf
    elif residue_total_moles <= 0.0 and len(branch.feed_stream.moles_by_substance_name) > 1:
        score = -math.inf
    else:
        residue_conservation = residue_total_moles / max(branch.feed_stream.total_moles, 1.0e-12)
        score = (
            config.product_purity_weight * logit_clamped(product_purity)
            + config.target_recovery_weight * safe_log(target_recovery + 1.0e-12)
            + config.residue_conservation_weight * safe_log(residue_conservation + 1.0e-12)
            - branch.setpoint_cost
            - config.solid_risk_cost_weight
            * (branch.solid_risk_total_moles / max(branch.feed_stream.total_moles, 1.0e-12))
            - config.hazard_cost_weight * len(branch.hazard_warnings)
        )

    return StageEvaluation(
        target_name=target_name,
        product_branch=branch.product_branch,
        temperature_kelvin=branch.temperature_kelvin,
        pressure_kpa=branch.pressure_kpa,
        feed_stream=branch.feed_stream,
        product_stream=branch.product_stream,
        residue_stream=branch.residue_stream,
        phase_probabilities_by_name=branch.phase_probabilities_by_name,
        product_purity=product_purity,
        target_recovery=target_recovery,
        target_loss_to_residue=target_loss_to_residue,
        product_total_moles=product_total_moles,
        residue_total_moles=residue_total_moles,
        estimated_sensible_heat_kj=branch.estimated_sensible_heat_kj,
        estimated_latent_heat_kj=branch.estimated_latent_heat_kj,
        setpoint_cost=branch.setpoint_cost,
        solid_risk_total_moles=branch.solid_risk_total_moles,
        hazard_warnings=branch.hazard_warnings,
        score=score,
        limiting_impurity_name=limiting_impurity_name,
    )


def evaluate_stage(
    feed_stream: MaterialStream,
    target_name: str,
    product_branch: ProductBranch,
    temperature_kelvin: float,
    pressure_kpa: float,
    noise: ControlNoise,
    config: PlannerConfig,
) -> StageEvaluation:
    branch = evaluate_branch(
        feed_stream,
        product_branch,
        temperature_kelvin,
        pressure_kpa,
        noise,
        config,
    )
    return stage_from_branch(branch, target_name, config)
