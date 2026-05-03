from __future__ import annotations

from stationeers_phase_sort.models import (
    MaterialStream,
    PhaseProbability,
    ProductRecord,
    ProductBranch,
    SearchPlan,
    StageEvaluation,
)
from stationeers_phase_sort.optimizer.polishing import required_polishing_passes
from stationeers_phase_sort.optimizer.polishing import polishing_streams_after_repeated_passes
from stationeers_phase_sort.process_graph import plan_to_process_graph


def test_polishing_uses_vector_retention_for_multiple_contaminants() -> None:
    product_stream = MaterialStream(
        {
            "Oxygen": 90.0,
            "Nitrogen": 9.0,
            "Carbon Dioxide": 1.0,
        },
        temperature_kelvin=100.0,
        pressure_kpa=100.0,
        phase_hint="gas",
    )
    stage = StageEvaluation(
        target_name="Oxygen",
        product_branch=ProductBranch.GAS,
        temperature_kelvin=100.0,
        pressure_kpa=100.0,
        feed_stream=product_stream,
        product_stream=product_stream,
        residue_stream=MaterialStream({}, phase_hint="empty"),
        phase_probabilities_by_name={
            "Oxygen": PhaseProbability(0.05, 0.95, 0.0, 0.0, 0.0, 100.0, 100.0),
            "Nitrogen": PhaseProbability(0.80, 0.20, 0.0, 0.0, 0.0, 100.0, 100.0),
            "Carbon Dioxide": PhaseProbability(0.90, 0.10, 0.0, 0.0, 0.0, 100.0, 100.0),
        },
        product_purity=0.90,
        target_recovery=1.0,
        target_loss_to_residue=0.0,
        product_total_moles=100.0,
        residue_total_moles=0.0,
        estimated_sensible_heat_kj=0.0,
        estimated_latent_heat_kj=0.0,
        setpoint_cost=0.0,
        solid_risk_total_moles=0.0,
        hazard_warnings=tuple(),
        score=0.0,
        limiting_impurity_name="Nitrogen",
    )

    passes, final_purity, final_yield = required_polishing_passes(
        product_stream,
        stage,
        "Oxygen",
        target_purity=0.999,
        maximum_passes=20,
    )

    assert passes is not None
    assert final_purity >= 0.999
    assert 0.0 < final_yield < 1.0

    polished_stream, rejected_stream = polishing_streams_after_repeated_passes(
        product_stream,
        stage,
        passes,
    )

    assert abs(polished_stream.total_moles + rejected_stream.total_moles - product_stream.total_moles) < 1.0e-9
    assert polished_stream.moles_by_substance_name["Oxygen"] < product_stream.moles_by_substance_name["Oxygen"]
    assert rejected_stream.total_moles > 0.0


def test_process_graph_emits_polishing_recycle_and_residue() -> None:
    product_stream = MaterialStream(
        {
            "Oxygen": 90.0,
            "Nitrogen": 9.0,
            "Carbon Dioxide": 1.0,
        },
        temperature_kelvin=100.0,
        pressure_kpa=100.0,
        phase_hint="gas",
    )
    stage = StageEvaluation(
        target_name="Oxygen",
        product_branch=ProductBranch.GAS,
        temperature_kelvin=100.0,
        pressure_kpa=100.0,
        feed_stream=product_stream,
        product_stream=product_stream,
        residue_stream=MaterialStream({}, phase_hint="empty"),
        phase_probabilities_by_name={
            "Oxygen": PhaseProbability(0.05, 0.95, 0.0, 0.0, 0.0, 100.0, 100.0),
            "Nitrogen": PhaseProbability(0.80, 0.20, 0.0, 0.0, 0.0, 100.0, 100.0),
            "Carbon Dioxide": PhaseProbability(0.90, 0.10, 0.0, 0.0, 0.0, 100.0, 100.0),
        },
        product_purity=0.90,
        target_recovery=1.0,
        target_loss_to_residue=0.0,
        product_total_moles=100.0,
        residue_total_moles=0.0,
        estimated_sensible_heat_kj=0.0,
        estimated_latent_heat_kj=0.0,
        setpoint_cost=0.0,
        solid_risk_total_moles=0.0,
        hazard_warnings=tuple(),
        score=0.0,
        limiting_impurity_name="Nitrogen",
    )
    plan = SearchPlan(
        residue_stream=MaterialStream({}, phase_hint="empty"),
        remaining_target_names=tuple(),
        product_records=(
            ProductRecord(
                stage_index=1,
                stage=stage,
                polishing_passes_needed=3,
                polishing_final_purity=0.999,
                polishing_final_yield_fraction=0.9,
            ),
        ),
        cumulative_score=0.0,
        worst_product_purity=0.90,
        cumulative_target_recovery_log=0.0,
        cumulative_energy_kj=0.0,
        cumulative_setpoint_cost=0.0,
    )

    graph = plan_to_process_graph(plan)
    node_kinds = {node.node_kind for node in graph.nodes}

    assert "polishing_recycle" in node_kinds
    assert "residue" in node_kinds
    assert any(edge.source_node_id == "polishing_recycle_01" for edge in graph.edges)
