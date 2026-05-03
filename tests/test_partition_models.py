from __future__ import annotations

from stationeers_phase_sort.models import ControlNoise, PlannerConfig, PressureModel
from stationeers_phase_sort.partition_models import phase_probability
from stationeers_phase_sort.substances import SUBSTANCES_BY_NAME


def test_total_pressure_model_can_condense_trace_gas() -> None:
    config = PlannerConfig(pressure_model=PressureModel.TOTAL)
    noise = ControlNoise(
        temperature_sigma_kelvin=0.0,
        pressure_sigma_fraction=0.0,
        extra_model_sigma_log_pressure=0.0,
    )
    probability = phase_probability(
        SUBSTANCES_BY_NAME["Oxygen"],
        temperature_kelvin=86.5,
        total_pressure_kpa=101.0,
        mole_fraction=0.01,
        noise=noise,
        config=config,
    )
    assert probability.liquid_probability == 1.0


def test_partial_pressure_model_uses_mole_fraction() -> None:
    config = PlannerConfig(pressure_model=PressureModel.PARTIAL)
    noise = ControlNoise(
        temperature_sigma_kelvin=0.0,
        pressure_sigma_fraction=0.0,
        extra_model_sigma_log_pressure=0.0,
    )
    probability = phase_probability(
        SUBSTANCES_BY_NAME["Oxygen"],
        temperature_kelvin=86.5,
        total_pressure_kpa=101.0,
        mole_fraction=0.01,
        noise=noise,
        config=config,
    )
    assert probability.gas_probability == 1.0
