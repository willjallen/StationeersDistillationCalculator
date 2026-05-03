from __future__ import annotations

from collections.abc import Sequence

from stationeers_phase_sort.models import (
    ControlNoise,
    MaterialStream,
    PlannerConfig,
    ProductBranch,
    SearchPlan,
)
from stationeers_phase_sort.optimizer.candidate_generation import (
    top_stage_candidates_for_all_targets,
)
from stationeers_phase_sort.optimizer.finalize import empty_stream, finalize_with_residue_product
from stationeers_phase_sort.optimizer.polishing import make_product_record
from stationeers_phase_sort.optimizer.scoring import plan_sort_key
from stationeers_phase_sort.units import safe_log


def search_phase_chain_beam(
    initial_stream: MaterialStream,
    target_names: Sequence[str],
    noise: ControlNoise,
    config: PlannerConfig,
) -> SearchPlan:
    initial_state = SearchPlan(
        residue_stream=initial_stream,
        remaining_target_names=tuple(target_names),
        product_records=tuple(),
        cumulative_score=0.0,
        worst_product_purity=1.0,
        cumulative_target_recovery_log=0.0,
        cumulative_energy_kj=0.0,
        cumulative_setpoint_cost=0.0,
    )
    beam: list[SearchPlan] = [initial_state]

    for stage_index in range(1, len(target_names)):
        next_beam: list[SearchPlan] = []

        for state in beam:
            if state.residue_stream.total_moles <= config.minimum_branch_total_moles:
                continue

            current_present_names = tuple(
                name
                for name in state.remaining_target_names
                if state.residue_stream.moles_by_substance_name.get(name, 0.0)
                > config.minimum_branch_total_moles
            )
            if len(current_present_names) <= 1:
                next_beam.append(state)
                continue

            candidates_by_target_and_phase = top_stage_candidates_for_all_targets(
                state.residue_stream,
                current_present_names,
                noise,
                config,
                keep_count=config.candidate_keep_per_target,
            )

            for target_name in current_present_names:
                for product_branch in (ProductBranch.LIQUID, ProductBranch.GAS):
                    for stage in candidates_by_target_and_phase.get(
                        (target_name, product_branch), []
                    ):
                        if stage.product_purity <= 0.0 or stage.target_recovery <= 0.0:
                            continue

                        product_record = make_product_record(
                            stage_index,
                            stage,
                            config.target_final_purity,
                            config.maximum_polishing_passes,
                        )
                        new_remaining_names = tuple(
                            name for name in state.remaining_target_names if name != target_name
                        )

                        next_beam.append(
                            SearchPlan(
                                residue_stream=stage.residue_stream.without_tiny_entries(),
                                remaining_target_names=new_remaining_names,
                                product_records=state.product_records + (product_record,),
                                cumulative_score=state.cumulative_score
                                + stage.score
                                - config.prefer_fewer_stages_weight,
                                worst_product_purity=min(
                                    state.worst_product_purity,
                                    stage.product_purity,
                                ),
                                cumulative_target_recovery_log=state.cumulative_target_recovery_log
                                + safe_log(max(stage.target_recovery, 1.0e-12)),
                                cumulative_energy_kj=state.cumulative_energy_kj
                                + stage.estimated_sensible_heat_kj
                                + stage.estimated_latent_heat_kj,
                                cumulative_setpoint_cost=state.cumulative_setpoint_cost
                                + stage.setpoint_cost,
                            )
                        )

        if not next_beam:
            break

        next_beam.sort(key=plan_sort_key, reverse=True)
        beam = next_beam[: config.beam_width]

    finalized_states = [finalize_with_residue_product(state, config) for state in beam]
    finalized_states.sort(key=plan_sort_key, reverse=True)
    if not finalized_states:
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
    return finalized_states[0]
