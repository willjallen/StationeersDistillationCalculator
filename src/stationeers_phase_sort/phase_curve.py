from __future__ import annotations

import math

from stationeers_phase_sort.models import (
    BoundaryStatus,
    CurvePoint,
    PhaseBoundaryResult,
    Substance,
)
from stationeers_phase_sort.substances import CALIBRATION_POINTS_BY_NAME
from stationeers_phase_sort.units import safe_log


class PhaseCurve:
    def __init__(self, substance: Substance, curve_points: list[CurvePoint] | None = None) -> None:
        self.substance = substance
        self.curve_points = (
            curve_points if curve_points is not None else build_curve_points(substance)
        )
        _validate_curve_points(substance.name, self.curve_points)

    def vapor_pressure_kpa(self, temperature_kelvin: float) -> PhaseBoundaryResult:
        log_pressure, slope = log_vapor_pressure_and_slope_from_points(
            self.substance,
            self.curve_points,
            temperature_kelvin,
        )
        if log_pressure is None:
            return PhaseBoundaryResult(BoundaryStatus.SOLID_RISK, None, slope)
        if math.isinf(log_pressure):
            return PhaseBoundaryResult(BoundaryStatus.NON_CONDENSABLE, math.inf, slope)
        return PhaseBoundaryResult(BoundaryStatus.VALID, math.exp(log_pressure), slope)


def build_curve_points(substance: Substance) -> list[CurvePoint]:
    if not substance.can_phase_change:
        return []

    assert substance.melting_temperature_kelvin is not None
    assert substance.minimum_condensation_pressure_kpa is not None
    assert substance.maximum_liquid_temperature_kelvin is not None
    assert substance.maximum_liquid_pressure_kpa is not None

    curve_points = [
        CurvePoint(
            substance.melting_temperature_kelvin,
            substance.minimum_condensation_pressure_kpa,
        )
    ]

    if substance.boiling_temperature_kelvin_at_100_kpa is not None:
        curve_points.append(CurvePoint(substance.boiling_temperature_kelvin_at_100_kpa, 100.0))

    curve_points.extend(CALIBRATION_POINTS_BY_NAME.get(substance.name, []))
    curve_points.append(
        CurvePoint(
            substance.maximum_liquid_temperature_kelvin,
            substance.maximum_liquid_pressure_kpa,
        )
    )
    curve_points.sort(key=lambda point: point.temperature_kelvin)

    deduplicated: list[CurvePoint] = []
    for curve_point in curve_points:
        if curve_point.pressure_kpa <= 0.0:
            raise ValueError(f"Bad phase point for {substance.name}: {curve_point}")
        if (
            deduplicated
            and abs(deduplicated[-1].temperature_kelvin - curve_point.temperature_kelvin) < 1.0e-9
        ):
            deduplicated[-1] = curve_point
        else:
            deduplicated.append(curve_point)

    _validate_curve_points(substance.name, deduplicated)
    return deduplicated


def _validate_curve_points(substance_name: str, curve_points: list[CurvePoint]) -> None:
    for left, right in zip(curve_points, curve_points[1:], strict=False):
        if right.temperature_kelvin <= left.temperature_kelvin:
            raise ValueError(
                f"{substance_name} phase curve temperatures must be strictly increasing"
            )
        if right.pressure_kpa <= left.pressure_kpa:
            raise ValueError(f"{substance_name} phase curve pressures must be strictly increasing")


def log_vapor_pressure_and_slope(
    substance: Substance,
    temperature_kelvin: float,
) -> tuple[float | None, float]:
    return log_vapor_pressure_and_slope_from_points(
        substance,
        build_curve_points(substance),
        temperature_kelvin,
    )


def log_vapor_pressure_and_slope_from_points(
    substance: Substance,
    curve_points: list[CurvePoint],
    temperature_kelvin: float,
) -> tuple[float | None, float]:
    if not substance.can_phase_change:
        return math.inf, 0.0

    assert substance.melting_temperature_kelvin is not None
    assert substance.maximum_liquid_temperature_kelvin is not None

    if temperature_kelvin < substance.melting_temperature_kelvin:
        return None, 0.0

    if temperature_kelvin > substance.maximum_liquid_temperature_kelvin:
        return math.inf, 0.0

    if len(curve_points) < 2:
        return None, 0.0

    if temperature_kelvin <= curve_points[0].temperature_kelvin:
        left_point = curve_points[0]
        right_point = curve_points[1]
    elif temperature_kelvin >= curve_points[-1].temperature_kelvin:
        left_point = curve_points[-2]
        right_point = curve_points[-1]
    else:
        left_point = curve_points[0]
        right_point = curve_points[-1]
        for candidate_left, candidate_right in zip(curve_points, curve_points[1:], strict=False):
            if (
                candidate_left.temperature_kelvin
                <= temperature_kelvin
                <= candidate_right.temperature_kelvin
            ):
                left_point = candidate_left
                right_point = candidate_right
                break

    temperature_span = right_point.temperature_kelvin - left_point.temperature_kelvin
    if temperature_span <= 0.0:
        return safe_log(right_point.pressure_kpa), 0.0

    log_left_pressure = safe_log(left_point.pressure_kpa)
    log_right_pressure = safe_log(right_point.pressure_kpa)
    slope = (log_right_pressure - log_left_pressure) / temperature_span
    interpolation_fraction = (temperature_kelvin - left_point.temperature_kelvin) / temperature_span
    log_pressure = log_left_pressure + interpolation_fraction * (
        log_right_pressure - log_left_pressure
    )
    return log_pressure, slope


def vapor_pressure_kpa(substance: Substance, temperature_kelvin: float) -> float | None:
    log_pressure, _ = log_vapor_pressure_and_slope(substance, temperature_kelvin)
    if log_pressure is None:
        return None
    if math.isinf(log_pressure):
        return math.inf
    return math.exp(log_pressure)
