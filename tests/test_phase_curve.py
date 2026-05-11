from __future__ import annotations

import math

import pytest

from stationeers_phase_sort.models import BoundaryStatus, CurvePoint
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


def test_above_max_liquid_temperature_is_non_condensable() -> None:
    oxygen = SUBSTANCES_BY_NAME["Oxygen"]
    assert oxygen.maximum_liquid_temperature_kelvin is not None

    result = PhaseCurve(oxygen).vapor_pressure_kpa(
        oxygen.maximum_liquid_temperature_kelvin + 0.1
    )

    assert result.status == BoundaryStatus.NON_CONDENSABLE
    assert result.vapor_pressure_kpa == math.inf


def test_phase_curve_uses_injected_curve_points() -> None:
    oxygen = SUBSTANCES_BY_NAME["Oxygen"]
    assert oxygen.melting_temperature_kelvin is not None
    assert oxygen.maximum_liquid_temperature_kelvin is not None
    custom_curve = [
        CurvePoint(oxygen.melting_temperature_kelvin, 10.0),
        CurvePoint(oxygen.maximum_liquid_temperature_kelvin, 1000.0),
    ]

    result = PhaseCurve(oxygen, custom_curve).vapor_pressure_kpa(86.5)

    assert result.status == BoundaryStatus.VALID
    assert result.vapor_pressure_kpa is not None
    assert result.vapor_pressure_kpa != pytest.approx(vapor_pressure_kpa(oxygen, 86.5))
