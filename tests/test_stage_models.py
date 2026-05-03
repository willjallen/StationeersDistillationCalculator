from __future__ import annotations

from stationeers_phase_sort.models import ControlNoise, MaterialStream, PlannerConfig, ProductBranch
from stationeers_phase_sort.stage_models import evaluate_stage


def test_stage_split_conserves_moles_or_reports_solid_risk() -> None:
    stream = MaterialStream(
        {
            "Oxygen": 10.0,
            "Nitrogen": 10.0,
        },
        temperature_kelvin=293.15,
        pressure_kpa=100.0,
        phase_hint="gas",
    )
    stage = evaluate_stage(
        stream,
        target_name="Oxygen",
        product_branch=ProductBranch.LIQUID,
        temperature_kelvin=157.0,
        pressure_kpa=6000.0,
        noise=ControlNoise(
            temperature_sigma_kelvin=0.0,
            pressure_sigma_fraction=0.0,
            extra_model_sigma_log_pressure=0.0,
        ),
        config=PlannerConfig(),
    )

    accounted_moles = (
        stage.product_stream.total_moles
        + stage.residue_stream.total_moles
        + stage.solid_risk_total_moles
    )
    assert accounted_moles == stream.total_moles
