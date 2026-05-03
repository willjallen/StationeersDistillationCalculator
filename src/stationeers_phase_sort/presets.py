from __future__ import annotations

from stationeers_phase_sort.data_loader import load_preset_names


def preset_substances(preset_name: str) -> tuple[str, ...]:
    return load_preset_names(preset_name)
