from __future__ import annotations

import pytest

from stationeers_phase_sort.data_loader import validate_database
from stationeers_phase_sort.presets import preset_substances
from stationeers_phase_sort.substances import DEFAULT_ALL_GAS_NAMES, SUBSTANCES_BY_NAME


def test_packaged_data_validates() -> None:
    validate_database()


def test_all_gases_preset_contains_helium_and_excludes_salt() -> None:
    assert "Helium" in DEFAULT_ALL_GAS_NAMES
    assert "Sodium Chloride" not in DEFAULT_ALL_GAS_NAMES
    assert set(DEFAULT_ALL_GAS_NAMES).issubset(SUBSTANCES_BY_NAME)


def test_named_presets_load() -> None:
    assert preset_substances("base-air") == ("Nitrogen", "Oxygen", "Carbon Dioxide")
    assert "Pollutant" in preset_substances("mars-atmosphere")


@pytest.mark.parametrize(
    (
        "name",
        "freezing_temperature_kelvin",
        "maximum_liquid_temperature_kelvin",
        "maximum_liquid_pressure_kpa",
        "latent_heat_kj_per_mol",
    ),
    [
        ("Alcohol", 231.630843984, 423.675171692, 1000.0, 2.0),
        ("Carbon Dioxide", 217.82, 265.0, 6000.0, 0.6),
        ("Hydrogen", 15.1767057463, 70.0551551908, 6000.0, 0.2),
        ("Hydrazine", 246.236749353, 520.807708414, 6000.0, 4.0),
        ("Nitrous Oxide", 252.1, 430.6, 2000.0, 4.0),
        ("Ozone", 81.4067268868, 304.387897614, 6000.0, 1.0),
        ("Oxygen", 56.416, 162.2, 6000.0, 0.8),
        ("Polluted Water", 276.15, 629.0, 6000.0, 8.0),
        ("Pollutant", 173.32, 425.0, 6000.0, 2.0),
        ("Sodium Chloride", 605.903458297, 2799.31057833, 515.0, 1.0),
        ("Water", 273.15, 643.0, 6000.0, 8.0),
    ],
)
def test_sourced_stationeers_phase_constants(
    name: str,
    freezing_temperature_kelvin: float,
    maximum_liquid_temperature_kelvin: float,
    maximum_liquid_pressure_kpa: float,
    latent_heat_kj_per_mol: float,
) -> None:
    substance = SUBSTANCES_BY_NAME[name]

    assert substance.melting_temperature_kelvin == pytest.approx(
        freezing_temperature_kelvin
    )
    assert substance.maximum_liquid_temperature_kelvin == pytest.approx(
        maximum_liquid_temperature_kelvin
    )
    assert substance.maximum_liquid_pressure_kpa == pytest.approx(maximum_liquid_pressure_kpa)
    assert substance.molar_latent_heat_kj_per_mol == pytest.approx(latent_heat_kj_per_mol)
