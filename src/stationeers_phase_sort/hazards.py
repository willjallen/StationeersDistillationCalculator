from __future__ import annotations

from stationeers_phase_sort.models import HazardWarning, MaterialStream
from stationeers_phase_sort.substances import HAZARD_WARNINGS


def active_hazards(
    feed_stream: MaterialStream, temperature_kelvin: float
) -> tuple[HazardWarning, ...]:
    present_names = {
        name for name, moles in feed_stream.moles_by_substance_name.items() if moles > 1.0e-12
    }
    warnings: list[HazardWarning] = []
    for warning in HAZARD_WARNINGS:
        if temperature_kelvin >= warning.threshold_temperature_kelvin and all(
            reactant in present_names for reactant in warning.reactants
        ):
            warnings.append(warning)
    return tuple(warnings)
