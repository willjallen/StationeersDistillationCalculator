from __future__ import annotations

from stationeers_phase_sort.data_loader import (
    load_calibration_points_by_name,
    load_hazard_warnings,
    load_preset_names,
    load_substance_database,
)

SUBSTANCES_BY_NAME = load_substance_database()
CALIBRATION_POINTS_BY_NAME = load_calibration_points_by_name()
HAZARD_WARNINGS = load_hazard_warnings()
DEFAULT_ALL_GAS_NAMES = load_preset_names("all-gases")

__all__ = [
    "CALIBRATION_POINTS_BY_NAME",
    "DEFAULT_ALL_GAS_NAMES",
    "HAZARD_WARNINGS",
    "SUBSTANCES_BY_NAME",
]
