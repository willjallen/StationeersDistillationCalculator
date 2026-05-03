from __future__ import annotations

from stationeers_phase_sort.models import MaterialStream, ProductRecord, StageEvaluation
from stationeers_phase_sort.partition_models import branch_fraction


def product_retention_probability_for_name(stage: StageEvaluation, name: str) -> float:
    phase_probability_value = stage.phase_probabilities_by_name[name]
    return branch_fraction(phase_probability_value, stage.product_branch)


def purity_after_repeated_passes(
    product_stream: MaterialStream,
    stage: StageEvaluation,
    target_name: str,
    passes: int,
) -> tuple[float, float]:
    retained_moles_by_name = {}
    target_initial_moles = product_stream.moles_by_substance_name.get(target_name, 0.0)
    for name, amount in product_stream.moles_by_substance_name.items():
        retention_probability = product_retention_probability_for_name(stage, name)
        retained_moles_by_name[name] = amount * (retention_probability**passes)

    total_retained_moles = sum(retained_moles_by_name.values())
    target_retained_moles = retained_moles_by_name.get(target_name, 0.0)
    purity = target_retained_moles / total_retained_moles if total_retained_moles > 0.0 else 0.0
    target_yield = (
        target_retained_moles / target_initial_moles if target_initial_moles > 0.0 else 0.0
    )
    return purity, target_yield


def required_polishing_passes(
    product_stream: MaterialStream,
    stage: StageEvaluation,
    target_name: str,
    target_purity: float,
    maximum_passes: int,
) -> tuple[int | None, float, float]:
    best_purity = 0.0
    best_yield = 0.0
    for passes in range(1, maximum_passes + 1):
        purity, target_yield = purity_after_repeated_passes(
            product_stream,
            stage,
            target_name,
            passes,
        )
        if purity > best_purity:
            best_purity = purity
            best_yield = target_yield
        if purity >= target_purity:
            return passes, purity, target_yield
    return None, best_purity, best_yield


def polishing_table_for_stage(
    stage: StageEvaluation,
    target_name: str,
    target_purity: float,
    maximum_passes: int,
) -> list[tuple[int, float, float]]:
    rows: list[tuple[int, float, float]] = []
    for passes in range(1, maximum_passes + 1):
        purity, target_yield = purity_after_repeated_passes(
            stage.product_stream,
            stage,
            target_name,
            passes,
        )
        rows.append((passes, purity, target_yield))
        if purity >= target_purity and passes >= 3:
            break
    return rows


def make_product_record(
    stage_index: int,
    stage: StageEvaluation,
    target_final_purity: float,
    maximum_polishing_passes: int,
) -> ProductRecord:
    passes, final_purity, final_yield = required_polishing_passes(
        stage.product_stream,
        stage,
        stage.target_name,
        target_final_purity,
        maximum_polishing_passes,
    )
    return ProductRecord(
        stage_index=stage_index,
        stage=stage,
        polishing_passes_needed=passes,
        polishing_final_purity=final_purity,
        polishing_final_yield_fraction=final_yield,
    )
