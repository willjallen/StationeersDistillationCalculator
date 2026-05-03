from __future__ import annotations

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
