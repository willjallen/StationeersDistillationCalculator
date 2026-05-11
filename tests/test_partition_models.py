from __future__ import annotations

from stationeers_phase_sort.models import ControlNoise, PlannerConfig, PressureModel
from stationeers_phase_sort.partition_models import phase_probability
from stationeers_phase_sort.substances import SUBSTANCES_BY_NAME


def test_stationeers_model_uses_total_network_pressure_by_default() -> None:
    config = PlannerConfig()
    noise = ControlNoise(
        temperature_sigma_kelvin=0.0,
        pressure_sigma_fraction=0.0,
        extra_model_sigma_log_pressure=0.0,
    )

    trace_probability = phase_probability(
        SUBSTANCES_BY_NAME["Oxygen"],
        temperature_kelvin=86.5,
        total_pressure_kpa=101.0,
        mole_fraction=0.01,
        noise=noise,
        config=config,
    )
    rich_probability = phase_probability(
        SUBSTANCES_BY_NAME["Oxygen"],
        temperature_kelvin=86.5,
        total_pressure_kpa=101.0,
        mole_fraction=0.80,
        noise=noise,
        config=config,
    )

    assert config.pressure_model == PressureModel.TOTAL
    assert trace_probability.effective_pressure_kpa == 101.0
    assert rich_probability.effective_pressure_kpa == 101.0
    assert trace_probability.liquid_probability == 1.0
    assert rich_probability.liquid_probability == 1.0
