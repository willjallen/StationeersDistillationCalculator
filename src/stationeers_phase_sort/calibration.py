from __future__ import annotations

from stationeers_phase_sort.data_loader import load_calibration_points_by_name
from stationeers_phase_sort.models import CurvePoint


def calibration_points_for(substance_name: str) -> list[CurvePoint]:
    return list(load_calibration_points_by_name().get(substance_name, []))
