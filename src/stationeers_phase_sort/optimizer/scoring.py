from __future__ import annotations

from stationeers_phase_sort.models import SearchPlan


def plan_sort_key(plan: SearchPlan) -> tuple[float, float, float, float]:
    return (
        plan.worst_product_purity,
        plan.cumulative_target_recovery_log,
        plan.cumulative_score,
        -plan.cumulative_setpoint_cost,
    )
