from __future__ import annotations

from collections.abc import Sequence

from stationeers_phase_sort.models import (
    ControlNoise,
    MaterialStream,
    PlannerConfig,
    SearchPlan,
    StageEvaluation,
)
from stationeers_phase_sort.optimizer.candidate_generation import (
    top_stage_candidates_for_all_targets,
)
from stationeers_phase_sort.optimizer.finalize import empty_stream, finalize_with_residue_product
from stationeers_phase_sort.optimizer.polishing import make_product_record
from stationeers_phase_sort.units import safe_log


def search_phase_chain_greedy(
    initial_stream: MaterialStream,
    target_names: Sequence[str],
    noise: ControlNoise,
    config: PlannerConfig,
) -> SearchPlan:
    state = SearchPlan(
        residue_stream=initial_stream,
        remaining_target_names=tuple(target_names),
        product_records=tuple(),
        cumulative_score=0.0,
        worst_product_purity=1.0,
        cumulative_target_recovery_log=0.0,
        cumulative_energy_kj=0.0,
        cumulative_setpoint_cost=0.0,
    )

    for stage_index in range(1, len(target_names)):
        current_present_names = tuple(
            name
            for name in state.remaining_target_names
            if state.residue_stream.moles_by_substance_name.get(name, 0.0)
            > config.minimum_branch_total_moles
        )
        if len(current_present_names) <= 1:
            break

        candidates_by_target_and_phase = top_stage_candidates_for_all_targets(
            state.residue_stream,
            current_present_names,
            noise,
            config,
            keep_count=config.candidate_keep_per_target,
        )
        all_candidates: list[StageEvaluation] = []
        for candidates in candidates_by_target_and_phase.values():
            all_candidates.extend(candidates)

        if not all_candidates:
            break

        all_candidates.sort(key=lambda candidate: candidate.score, reverse=True)
        best_stage = all_candidates[0]
        product_record = make_product_record(
            stage_index,
            best_stage,
            config.target_final_purity,
            config.maximum_polishing_passes,
        )

        state = SearchPlan(
            residue_stream=best_stage.residue_stream.without_tiny_entries(),
            remaining_target_names=tuple(
                name for name in state.remaining_target_names if name != best_stage.target_name
            ),
            product_records=state.product_records + (product_record,),
            cumulative_score=state.cumulative_score
            + best_stage.score
            - config.prefer_fewer_stages_weight,
            worst_product_purity=min(state.worst_product_purity, best_stage.product_purity),
            cumulative_target_recovery_log=state.cumulative_target_recovery_log
            + safe_log(max(best_stage.target_recovery, 1.0e-12)),
            cumulative_energy_kj=state.cumulative_energy_kj
            + best_stage.estimated_sensible_heat_kj
            + best_stage.estimated_latent_heat_kj,
            cumulative_setpoint_cost=state.cumulative_setpoint_cost + best_stage.setpoint_cost,
        )

    finalized = finalize_with_residue_product(state, config)
    if not finalized.product_records:
        return SearchPlan(
            residue_stream=empty_stream(),
            remaining_target_names=tuple(target_names),
            product_records=tuple(),
            cumulative_score=0.0,
            worst_product_purity=0.0,
            cumulative_target_recovery_log=0.0,
            cumulative_energy_kj=0.0,
            cumulative_setpoint_cost=0.0,
        )
    return finalized
