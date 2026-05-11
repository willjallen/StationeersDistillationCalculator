from __future__ import annotations

import math

from stationeers_phase_sort.models import (
    ControlNoise,
    PhaseProbability,
    PlannerConfig,
    PressureModel,
    ProductBranch,
    Substance,
)
from stationeers_phase_sort.phase_curve import log_vapor_pressure_and_slope
from stationeers_phase_sort.units import clamp, normal_cdf, safe_log


def effective_pressure_kpa(
    total_pressure_kpa: float,
    mole_fraction: float,
    pressure_model: PressureModel,
) -> float:
    if pressure_model == PressureModel.TOTAL:
        return max(total_pressure_kpa, 1.0e-12)
    raise ValueError(f"Unknown pressure model: {pressure_model}")


def phase_probability(
    substance: Substance,
    temperature_kelvin: float,
    total_pressure_kpa: float,
    mole_fraction: float,
    noise: ControlNoise,
    config: PlannerConfig,
) -> PhaseProbability:
    effective_pressure = effective_pressure_kpa(
        total_pressure_kpa,
        mole_fraction,
        config.pressure_model,
    )

    if not substance.can_phase_change:
        return PhaseProbability(
            liquid_probability=0.0,
            gas_probability=1.0,
            solid_probability=0.0,
            phase_margin_log_pressure=-math.inf,
            phase_sigma_log_pressure=0.0,
            effective_pressure_kpa=effective_pressure,
            vapor_pressure_kpa=None,
        )

    assert substance.melting_temperature_kelvin is not None
    assert substance.maximum_liquid_temperature_kelvin is not None

    log_effective_pressure = safe_log(effective_pressure)

    solid_boundary_temperature = (
        substance.melting_temperature_kelvin + config.freezing_margin_kelvin
    )
    if noise.temperature_sigma_kelvin > 0.0:
        solid_probability = normal_cdf(
            (solid_boundary_temperature - temperature_kelvin) / noise.temperature_sigma_kelvin
        )
        below_max_liquid_probability = normal_cdf(
            (substance.maximum_liquid_temperature_kelvin - temperature_kelvin)
            / noise.temperature_sigma_kelvin
        )
        above_solid_probability = 1.0 - solid_probability
    else:
        solid_probability = 1.0 if temperature_kelvin <= solid_boundary_temperature else 0.0
        below_max_liquid_probability = (
            1.0 if temperature_kelvin <= substance.maximum_liquid_temperature_kelvin else 0.0
        )
        above_solid_probability = 1.0 - solid_probability

    log_vapor_pressure, log_vapor_pressure_slope = log_vapor_pressure_and_slope(
        substance,
        temperature_kelvin,
    )
    if log_vapor_pressure is None:
        return PhaseProbability(
            liquid_probability=0.0,
            gas_probability=max(0.0, 1.0 - solid_probability),
            solid_probability=solid_probability,
            phase_margin_log_pressure=-math.inf,
            phase_sigma_log_pressure=0.0,
            effective_pressure_kpa=effective_pressure,
            vapor_pressure_kpa=None,
        )

    if math.isinf(log_vapor_pressure):
        return PhaseProbability(
            liquid_probability=0.0,
            gas_probability=max(0.0, 1.0 - solid_probability),
            solid_probability=solid_probability,
            phase_margin_log_pressure=-math.inf,
            phase_sigma_log_pressure=0.0,
            effective_pressure_kpa=effective_pressure,
            vapor_pressure_kpa=math.inf,
        )

    pressure_sigma_from_absolute = (
        noise.pressure_sigma_kpa / max(total_pressure_kpa, 1.0e-9)
        if noise.pressure_sigma_kpa > 0.0
        else 0.0
    )
    sigma_log_pressure = math.sqrt(
        pressure_sigma_from_absolute * pressure_sigma_from_absolute
        + noise.pressure_sigma_fraction * noise.pressure_sigma_fraction
        + noise.extra_model_sigma_log_pressure * noise.extra_model_sigma_log_pressure
        + (log_vapor_pressure_slope * noise.temperature_sigma_kelvin) ** 2
    )

    phase_margin_log_pressure = log_effective_pressure - log_vapor_pressure

    if sigma_log_pressure <= 1.0e-12:
        pressure_liquid_probability = 1.0 if phase_margin_log_pressure > 0.0 else 0.0
    else:
        pressure_liquid_probability = normal_cdf(phase_margin_log_pressure / sigma_log_pressure)

    liquid_probability = (
        pressure_liquid_probability * below_max_liquid_probability * above_solid_probability
    )
    liquid_probability = clamp(liquid_probability, 0.0, 1.0)
    solid_probability = clamp(solid_probability, 0.0, 1.0)
    gas_probability = clamp(1.0 - liquid_probability - solid_probability, 0.0, 1.0)

    return PhaseProbability(
        liquid_probability=liquid_probability,
        gas_probability=gas_probability,
        solid_probability=solid_probability,
        phase_margin_log_pressure=phase_margin_log_pressure,
        phase_sigma_log_pressure=sigma_log_pressure,
        effective_pressure_kpa=effective_pressure,
        vapor_pressure_kpa=math.exp(log_vapor_pressure),
    )


def branch_fraction(
    phase_probability_value: PhaseProbability,
    product_branch: ProductBranch,
) -> float:
    if product_branch == ProductBranch.LIQUID:
        return phase_probability_value.liquid_probability
    if product_branch == ProductBranch.GAS:
        return phase_probability_value.gas_probability
    raise ValueError(f"Unknown product branch: {product_branch}")
