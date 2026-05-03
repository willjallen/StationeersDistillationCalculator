from __future__ import annotations

from stationeers_phase_sort.models import MaterialStream, PhaseProbability, ProductBranch
from stationeers_phase_sort.substances import SUBSTANCES_BY_NAME


def estimate_sensible_heat_kj(
    feed_stream: MaterialStream,
    target_temperature_kelvin: float,
) -> float:
    if feed_stream.temperature_kelvin is None:
        return 0.0

    delta_temperature = abs(target_temperature_kelvin - feed_stream.temperature_kelvin)
    heat_joules = 0.0
    for name, moles in feed_stream.moles_by_substance_name.items():
        substance = SUBSTANCES_BY_NAME[name]
        heat_capacity = substance.molar_heat_capacity_j_per_mol_kelvin
        if heat_capacity is None:
            continue
        heat_joules += max(0.0, moles) * heat_capacity * delta_temperature
    return heat_joules / 1000.0


def estimate_latent_heat_kj(
    feed_stream: MaterialStream,
    phase_probabilities_by_name: dict[str, PhaseProbability],
    product_branch: ProductBranch,
) -> float:
    latent_heat = 0.0
    for name, moles in feed_stream.moles_by_substance_name.items():
        substance = SUBSTANCES_BY_NAME[name]
        if substance.molar_latent_heat_kj_per_mol is None:
            continue
        probability = phase_probabilities_by_name[name]
        if product_branch in (ProductBranch.LIQUID, ProductBranch.GAS):
            transition_fraction = probability.liquid_probability
        else:
            transition_fraction = 0.0
        latent_heat += (
            max(0.0, moles) * transition_fraction * substance.molar_latent_heat_kj_per_mol
        )
    return latent_heat
