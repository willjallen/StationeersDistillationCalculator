from __future__ import annotations

from functools import lru_cache
from importlib.resources import files
from typing import Any

import yaml

from stationeers_phase_sort.models import CurvePoint, HazardWarning, Substance


def _load_yaml(relative_path: str) -> Any:
    resource = files("stationeers_phase_sort.data").joinpath(relative_path)
    with resource.open("r", encoding="utf-8") as file:
        return yaml.safe_load(file)


def _optional_float(value: Any) -> float | None:
    return None if value is None else float(value)


def _required_str(mapping: dict[str, Any], key: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"Expected non-empty string for {key}")
    return value


def _parse_substance(raw: Any) -> Substance:
    if not isinstance(raw, dict):
        raise ValueError(f"Substance entries must be mappings, got {type(raw).__name__}")

    hazard_tags = raw.get("hazard_tags") or []
    if not isinstance(hazard_tags, list):
        raise ValueError(f"hazard_tags must be a list for {raw.get('name')}")

    return Substance(
        name=_required_str(raw, "name"),
        formula=_required_str(raw, "formula"),
        phase_change_enabled=bool(raw.get("phase_change_enabled", True)),
        molar_heat_capacity_j_per_mol_kelvin=_optional_float(
            raw.get("molar_heat_capacity_j_per_mol_kelvin")
        ),
        molar_heat_of_fusion_kj_per_mol=_optional_float(raw.get("molar_heat_of_fusion_kj_per_mol")),
        melting_temperature_kelvin=_optional_float(raw.get("melting_temperature_kelvin")),
        boiling_temperature_kelvin_at_100_kpa=_optional_float(
            raw.get("boiling_temperature_kelvin_at_100_kpa")
        ),
        minimum_condensation_pressure_kpa=_optional_float(
            raw.get("minimum_condensation_pressure_kpa")
        ),
        maximum_liquid_temperature_kelvin=_optional_float(
            raw.get("maximum_liquid_temperature_kelvin")
        ),
        maximum_liquid_pressure_kpa=_optional_float(raw.get("maximum_liquid_pressure_kpa")),
        molar_latent_heat_kj_per_mol=_optional_float(raw.get("molar_latent_heat_kj_per_mol")),
        liquid_molar_volume_l_per_mol=_optional_float(raw.get("liquid_molar_volume_l_per_mol")),
        molar_mass_g_per_mol=_optional_float(raw.get("molar_mass_g_per_mol")),
        hazard_tags=tuple(str(tag) for tag in hazard_tags),
    )


@lru_cache(maxsize=1)
def load_substance_database() -> dict[str, Substance]:
    loaded = _load_yaml("substances.yaml")
    if not isinstance(loaded, list):
        raise ValueError("substances.yaml must contain a list")

    substances: dict[str, Substance] = {}
    for raw_entry in loaded:
        substance = _parse_substance(raw_entry)
        if substance.name in substances:
            raise ValueError(f"Duplicate substance name: {substance.name}")
        substances[substance.name] = substance

    validate_substances(substances)
    return substances


@lru_cache(maxsize=1)
def load_calibration_points_by_name() -> dict[str, list[CurvePoint]]:
    loaded = _load_yaml("calibration.yaml") or {}
    if not isinstance(loaded, dict):
        raise ValueError("calibration.yaml must contain a mapping")

    points_by_name: dict[str, list[CurvePoint]] = {name: [] for name in load_substance_database()}
    for name, raw_points in loaded.items():
        if name not in points_by_name:
            raise ValueError(f"Calibration references unknown substance: {name}")
        if not isinstance(raw_points, list):
            raise ValueError(f"Calibration points for {name} must be a list")
        points: list[CurvePoint] = []
        for raw_point in raw_points:
            if not isinstance(raw_point, dict):
                raise ValueError(f"Calibration point for {name} must be a mapping")
            points.append(
                CurvePoint(
                    temperature_kelvin=float(raw_point["temperature_kelvin"]),
                    pressure_kpa=float(raw_point["pressure_kpa"]),
                )
            )
        points_by_name[name] = points
    return points_by_name


@lru_cache(maxsize=1)
def load_hazard_warnings() -> tuple[HazardWarning, ...]:
    loaded = _load_yaml("hazards.yaml") or []
    if not isinstance(loaded, list):
        raise ValueError("hazards.yaml must contain a list")

    warnings: list[HazardWarning] = []
    for raw_warning in loaded:
        if not isinstance(raw_warning, dict):
            raise ValueError("Hazard warnings must be mappings")
        reactants = raw_warning.get("reactants") or []
        if not isinstance(reactants, list):
            raise ValueError(f"reactants must be a list for {raw_warning.get('name')}")
        warnings.append(
            HazardWarning(
                name=_required_str(raw_warning, "name"),
                threshold_temperature_kelvin=float(raw_warning["threshold_temperature_kelvin"]),
                reactants=tuple(str(reactant) for reactant in reactants),
                severity=_required_str(raw_warning, "severity"),
            )
        )
    return tuple(warnings)


@lru_cache(maxsize=8)
def load_preset_names(preset_name: str) -> tuple[str, ...]:
    file_name = preset_name.replace("_", "-")
    loaded = _load_yaml(f"presets/{file_name}.yaml")
    if not isinstance(loaded, dict):
        raise ValueError(f"Preset {preset_name} must contain a mapping")
    substances = loaded.get("substances")
    if not isinstance(substances, list):
        raise ValueError(f"Preset {preset_name} must contain a substances list")

    database = load_substance_database()
    names = tuple(str(name) for name in substances)
    unknown_names = [name for name in names if name not in database]
    if unknown_names:
        raise ValueError(f"Preset {preset_name} references unknown substances: {unknown_names}")
    return names


def curve_points_for_validation(
    substance: Substance,
    calibration_points_by_name: dict[str, list[CurvePoint]],
) -> list[CurvePoint]:
    if not substance.can_phase_change:
        return []

    assert substance.melting_temperature_kelvin is not None
    assert substance.minimum_condensation_pressure_kpa is not None
    assert substance.maximum_liquid_temperature_kelvin is not None
    assert substance.maximum_liquid_pressure_kpa is not None

    points = [
        CurvePoint(
            substance.melting_temperature_kelvin,
            substance.minimum_condensation_pressure_kpa,
        )
    ]
    if substance.boiling_temperature_kelvin_at_100_kpa is not None:
        points.append(CurvePoint(substance.boiling_temperature_kelvin_at_100_kpa, 100.0))
    points.extend(calibration_points_by_name.get(substance.name, []))
    points.append(
        CurvePoint(
            substance.maximum_liquid_temperature_kelvin,
            substance.maximum_liquid_pressure_kpa,
        )
    )
    points.sort(key=lambda point: point.temperature_kelvin)
    return points


def validate_substances(substances: dict[str, Substance]) -> None:
    for substance in substances.values():
        if not substance.can_phase_change:
            continue
        required_values = (
            substance.melting_temperature_kelvin,
            substance.minimum_condensation_pressure_kpa,
            substance.maximum_liquid_temperature_kelvin,
            substance.maximum_liquid_pressure_kpa,
        )
        if any(value is None for value in required_values):
            raise ValueError(f"{substance.name} has incomplete phase-change data")
        if substance.melting_temperature_kelvin >= substance.maximum_liquid_temperature_kelvin:  # type: ignore[operator]
            raise ValueError(f"{substance.name} has inverted temperature bounds")
        if substance.minimum_condensation_pressure_kpa <= 0.0:  # type: ignore[operator]
            raise ValueError(f"{substance.name} has non-positive minimum condensation pressure")
        if substance.maximum_liquid_pressure_kpa <= 0.0:  # type: ignore[operator]
            raise ValueError(f"{substance.name} has non-positive maximum liquid pressure")


def validate_database() -> None:
    substances = load_substance_database()
    calibration = load_calibration_points_by_name()
    load_hazard_warnings()
    for preset_name in ("all-gases", "base-air", "mars-atmosphere"):
        load_preset_names(preset_name)

    for substance in substances.values():
        points = curve_points_for_validation(substance, calibration)
        for left, right in zip(points, points[1:], strict=False):
            if right.temperature_kelvin <= left.temperature_kelvin:
                raise ValueError(f"{substance.name} has non-monotonic curve temperatures")
            if right.pressure_kpa <= left.pressure_kpa:
                raise ValueError(f"{substance.name} has non-monotonic curve pressures")
