from __future__ import annotations

from stationeers_phase_sort.models import (
    MaterialStream,
    PhaseProbability,
    PlannerConfig,
    ProductBranch,
    ProductRecord,
    SearchPlan,
    StageEvaluation,
)
from stationeers_phase_sort.units import logit_clamped


def empty_stream() -> MaterialStream:
    return MaterialStream({}, phase_hint="empty")


def finalize_with_residue_product(state: SearchPlan, config: PlannerConfig) -> SearchPlan:
    remaining_present_names = [
        name
        for name in state.remaining_target_names
        if state.residue_stream.moles_by_substance_name.get(name, 0.0)
        > config.minimum_branch_total_moles
    ]
    if not remaining_present_names:
        return SearchPlan(
            residue_stream=empty_stream(),
            remaining_target_names=tuple(),
            product_records=state.product_records,
            cumulative_score=state.cumulative_score,
            worst_product_purity=state.worst_product_purity,
            cumulative_target_recovery_log=state.cumulative_target_recovery_log,
            cumulative_energy_kj=state.cumulative_energy_kj,
            cumulative_setpoint_cost=state.cumulative_setpoint_cost,
        )

    final_target_name = max(
        remaining_present_names,
        key=lambda name: state.residue_stream.moles_by_substance_name.get(name, 0.0),
    )
    final_total_moles = state.residue_stream.total_moles
    final_target_moles = state.residue_stream.moles_by_substance_name.get(final_target_name, 0.0)
    final_purity = final_target_moles / final_total_moles if final_total_moles > 0.0 else 0.0
    product_branch = (
        ProductBranch.LIQUID if state.residue_stream.phase_hint == "liquid" else ProductBranch.GAS
    )

    phase_probabilities = {
        name: PhaseProbability(
            liquid_probability=1.0 if product_branch == ProductBranch.LIQUID else 0.0,
            gas_probability=1.0 if product_branch == ProductBranch.GAS else 0.0,
            solid_probability=0.0,
            phase_margin_log_pressure=0.0,
            phase_sigma_log_pressure=0.0,
            effective_pressure_kpa=state.residue_stream.pressure_kpa or 0.0,
            vapor_pressure_kpa=None,
        )
        for name in state.residue_stream.moles_by_substance_name
    }

    final_stage = StageEvaluation(
        target_name=final_target_name,
        product_branch=product_branch,
        temperature_kelvin=state.residue_stream.temperature_kelvin or 293.15,
        pressure_kpa=state.residue_stream.pressure_kpa or 100.0,
        feed_stream=state.residue_stream,
        product_stream=state.residue_stream,
        residue_stream=empty_stream(),
        phase_probabilities_by_name=phase_probabilities,
        product_purity=final_purity,
        target_recovery=1.0,
        target_loss_to_residue=0.0,
        product_total_moles=final_total_moles,
        residue_total_moles=0.0,
        estimated_sensible_heat_kj=0.0,
        estimated_latent_heat_kj=0.0,
        setpoint_cost=0.0,
        solid_risk_total_moles=0.0,
        hazard_warnings=tuple(),
        score=config.product_purity_weight * logit_clamped(final_purity),
        limiting_impurity_name=None,
        operation_kind="equilibrate",
    )
    final_record = ProductRecord(
        stage_index=len(state.product_records) + 1,
        stage=final_stage,
        polishing_passes_needed=1 if final_purity >= config.target_final_purity else None,
        polishing_final_purity=final_purity,
        polishing_final_yield_fraction=1.0,
    )

    return SearchPlan(
        residue_stream=empty_stream(),
        remaining_target_names=tuple(
            name for name in state.remaining_target_names if name != final_target_name
        ),
        product_records=state.product_records + (final_record,),
        cumulative_score=state.cumulative_score + final_stage.score,
        worst_product_purity=min(state.worst_product_purity, final_purity),
        cumulative_target_recovery_log=state.cumulative_target_recovery_log,
        cumulative_energy_kj=state.cumulative_energy_kj,
        cumulative_setpoint_cost=state.cumulative_setpoint_cost,
    )
