from __future__ import annotations

import math


def clamp(value: float, minimum_value: float, maximum_value: float) -> float:
    return max(minimum_value, min(maximum_value, value))


def safe_log(value: float, floor: float = 1.0e-300) -> float:
    return math.log(max(floor, value))


def normal_cdf(value: float) -> float:
    return 0.5 * math.erfc(-value / math.sqrt(2.0))


def logit_clamped(probability: float, epsilon: float = 1.0e-12) -> float:
    probability = clamp(probability, epsilon, 1.0 - epsilon)
    return math.log(probability / (1.0 - probability))


def format_temperature(temperature_kelvin: float) -> str:
    return f"{temperature_kelvin:8.2f} K / {temperature_kelvin - 273.15:8.2f} C"
