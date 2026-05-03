from __future__ import annotations

import math

import pytest

from stationeers_phase_sort.models import BoundaryStatus
from stationeers_phase_sort.phase_curve import PhaseCurve, vapor_pressure_kpa
from stationeers_phase_sort.substances import SUBSTANCES_BY_NAME


def test_oxygen_curve_hits_known_boiling_point() -> None:
    oxygen = SUBSTANCES_BY_NAME["Oxygen"]
    assert vapor_pressure_kpa(oxygen, 86.5) == pytest.approx(100.0)


def test_helium_is_non_condensable() -> None:
    helium = SUBSTANCES_BY_NAME["Helium"]
    result = PhaseCurve(helium).vapor_pressure_kpa(40.0)
    assert result.status == BoundaryStatus.NON_CONDENSABLE
    assert result.vapor_pressure_kpa == math.inf


def test_below_melting_reports_solid_risk() -> None:
    oxygen = SUBSTANCES_BY_NAME["Oxygen"]
    result = PhaseCurve(oxygen).vapor_pressure_kpa(40.0)
    assert result.status == BoundaryStatus.SOLID_RISK
    assert result.vapor_pressure_kpa is None
