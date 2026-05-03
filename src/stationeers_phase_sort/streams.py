from __future__ import annotations

from collections.abc import Sequence

from stationeers_phase_sort.models import MaterialStream


def total_moles(stream: MaterialStream) -> float:
    return stream.total_moles


def mole_fraction(stream: MaterialStream, substance_name: str) -> float:
    total = stream.total_moles
    if total <= 0.0:
        return 0.0
    return max(0.0, stream.moles_by_substance_name.get(substance_name, 0.0)) / total


def composition_purity(stream: MaterialStream, target_name: str) -> float:
    total = stream.total_moles
    if total <= 0.0:
        return 0.0
    return max(0.0, stream.moles_by_substance_name.get(target_name, 0.0)) / total


def normalize_small_values(stream: MaterialStream, epsilon: float = 1.0e-12) -> MaterialStream:
    return stream.without_tiny_entries(epsilon)


def make_initial_stream(
    names: Sequence[str],
    total_moles_value: float,
    temperature_kelvin: float,
    pressure_kpa: float,
    composition_by_name: dict[str, float] | None = None,
) -> MaterialStream:
    if not names:
        raise ValueError("At least one substance is required")

    if composition_by_name is None:
        mole_fraction_value = 1.0 / len(names)
        moles_by_name = {name: total_moles_value * mole_fraction_value for name in names}
    else:
        total_fraction = sum(max(0.0, composition_by_name.get(name, 0.0)) for name in names)
        if total_fraction <= 0.0:
            raise ValueError(
                "composition_by_name has zero total fraction for the selected substances"
            )
        moles_by_name = {
            name: total_moles_value * max(0.0, composition_by_name.get(name, 0.0)) / total_fraction
            for name in names
        }

    return MaterialStream(
        moles_by_substance_name=moles_by_name,
        temperature_kelvin=temperature_kelvin,
        pressure_kpa=pressure_kpa,
        phase_hint="gas",
    )


def sorted_composition_items(stream: MaterialStream) -> list[tuple[str, float, float]]:
    total = stream.total_moles
    rows = []
    for name, moles in sorted(
        stream.moles_by_substance_name.items(),
        key=lambda item: item[1],
        reverse=True,
    ):
        fraction = moles / total if total > 0.0 else 0.0
        rows.append((name, moles, fraction))
    return rows
