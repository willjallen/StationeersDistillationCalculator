from __future__ import annotations

from stationeers_phase_sort.models import (
    MaterialStream,
    PhaseProbability,
    ProductBranch,
    StageEvaluation,
)
from stationeers_phase_sort.optimizer.polishing import required_polishing_passes


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
