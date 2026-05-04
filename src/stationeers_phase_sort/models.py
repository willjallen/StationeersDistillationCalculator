from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Literal


class PressureModel(StrEnum):
    TOTAL = "total"
    PARTIAL = "partial"


class ProductBranch(StrEnum):
    LIQUID = "liquid"
    GAS = "gas"


class BoundaryStatus(StrEnum):
    VALID = "valid"
    SOLID_RISK = "solid_risk"
    NON_CONDENSABLE = "non_condensable"
    OUTSIDE_DATA = "outside_data"


@dataclass(frozen=True)
class CurvePoint:
    temperature_kelvin: float
    pressure_kpa: float


@dataclass(frozen=True)
class Substance:
    name: str
    formula: str
    phase_change_enabled: bool
    molar_heat_capacity_j_per_mol_kelvin: float | None
    molar_heat_of_fusion_kj_per_mol: float | None
    melting_temperature_kelvin: float | None
    boiling_temperature_kelvin_at_100_kpa: float | None
    minimum_condensation_pressure_kpa: float | None
    maximum_liquid_temperature_kelvin: float | None
    maximum_liquid_pressure_kpa: float | None
    molar_latent_heat_kj_per_mol: float | None
    liquid_molar_volume_l_per_mol: float | None
    molar_mass_g_per_mol: float | None
    hazard_tags: tuple[str, ...] = tuple()

    @property
    def can_phase_change(self) -> bool:
        return (
            self.phase_change_enabled
            and self.melting_temperature_kelvin is not None
            and self.minimum_condensation_pressure_kpa is not None
            and self.maximum_liquid_temperature_kelvin is not None
            and self.maximum_liquid_pressure_kpa is not None
        )


@dataclass(frozen=True)
class ControlNoise:
    temperature_sigma_kelvin: float = 0.50
    pressure_sigma_fraction: float = 0.01
    pressure_sigma_kpa: float = 0.0
    extra_model_sigma_log_pressure: float = 0.02


@dataclass(frozen=True)
class PlannerConfig:
    pressure_model: PressureModel = PressureModel.TOTAL
    minimum_process_pressure_kpa: float = 0.05
    maximum_process_pressure_kpa: float = 6000.0
    freezing_margin_kelvin: float = 2.0
    minimum_branch_total_moles: float = 1.0e-9
    trace_mole_fraction_ignore_for_temperature_bounds: float = 1.0e-3
    minimum_target_recovery_for_stage: float = 0.005
    minimum_product_purity_for_stage: float = 0.25
    target_final_purity: float = 0.9999
    maximum_polishing_passes: int = 80
    temperature_grid_count: int = 24
    pressure_grid_count: int = 24
    local_refinement_rounds: int = 0
    beam_width: int = 16
    candidate_keep_per_target: int = 2
    stage_temperature_change_cost_weight: float = 0.002
    stage_pressure_change_cost_weight: float = 0.020
    sensible_heat_cost_weight: float = 0.00003
    latent_heat_cost_weight: float = 0.00001
    solid_risk_cost_weight: float = 25.0
    hazard_cost_weight: float = 50.0
    product_purity_weight: float = 7.0
    target_recovery_weight: float = 1.2
    residue_conservation_weight: float = 0.20
    prefer_fewer_stages_weight: float = 0.05


@dataclass(frozen=True)
class PhaseBoundaryResult:
    status: BoundaryStatus
    vapor_pressure_kpa: float | None
    slope_log_pressure_per_kelvin: float = 0.0


@dataclass(frozen=True)
class PhaseProbability:
    liquid_probability: float
    gas_probability: float
    solid_probability: float
    phase_margin_log_pressure: float
    phase_sigma_log_pressure: float
    effective_pressure_kpa: float
    vapor_pressure_kpa: float | None


@dataclass(frozen=True)
class MaterialStream:
    moles_by_substance_name: dict[str, float]
    temperature_kelvin: float | None = None
    pressure_kpa: float | None = None
    volume_liters: float | None = None
    phase_hint: Literal["gas", "liquid", "mixed", "unknown", "empty"] = "mixed"

    @property
    def total_moles(self) -> float:
        return sum(max(0.0, amount) for amount in self.moles_by_substance_name.values())

    def normalized_composition(self) -> dict[str, float]:
        total_moles = self.total_moles
        if total_moles <= 0.0:
            return {name: 0.0 for name in self.moles_by_substance_name}
        return {
            name: max(0.0, amount) / total_moles
            for name, amount in self.moles_by_substance_name.items()
        }

    def without_tiny_entries(self, threshold_moles: float = 1.0e-12) -> MaterialStream:
        return MaterialStream(
            {
                name: amount
                for name, amount in self.moles_by_substance_name.items()
                if amount > threshold_moles
            },
            temperature_kelvin=self.temperature_kelvin,
            pressure_kpa=self.pressure_kpa,
            volume_liters=self.volume_liters,
            phase_hint=self.phase_hint,
        )


@dataclass(frozen=True)
class HazardWarning:
    name: str
    threshold_temperature_kelvin: float
    reactants: tuple[str, ...]
    severity: str


@dataclass(frozen=True)
class BranchEvaluation:
    product_branch: ProductBranch
    temperature_kelvin: float
    pressure_kpa: float
    feed_stream: MaterialStream
    product_stream: MaterialStream
    residue_stream: MaterialStream
    phase_probabilities_by_name: dict[str, PhaseProbability]
    product_total_moles: float
    residue_total_moles: float
    estimated_sensible_heat_kj: float
    estimated_latent_heat_kj: float
    setpoint_cost: float
    solid_risk_total_moles: float
    hazard_warnings: tuple[HazardWarning, ...]


@dataclass(frozen=True)
class StageEvaluation:
    target_name: str
    product_branch: ProductBranch
    temperature_kelvin: float
    pressure_kpa: float
    feed_stream: MaterialStream
    product_stream: MaterialStream
    residue_stream: MaterialStream
    phase_probabilities_by_name: dict[str, PhaseProbability]
    product_purity: float
    target_recovery: float
    target_loss_to_residue: float
    product_total_moles: float
    residue_total_moles: float
    estimated_sensible_heat_kj: float
    estimated_latent_heat_kj: float
    setpoint_cost: float
    solid_risk_total_moles: float
    hazard_warnings: tuple[HazardWarning, ...]
    score: float
    limiting_impurity_name: str | None
    operation_kind: Literal["condense", "evaporate", "equilibrate"] = "equilibrate"

    @property
    def temperature_celsius(self) -> float:
        return self.temperature_kelvin - 273.15

    @property
    def product_impurity(self) -> float:
        return max(0.0, 1.0 - self.product_purity)


@dataclass(frozen=True)
class ProductRecord:
    stage_index: int
    stage: StageEvaluation
    polishing_passes_needed: int | None
    polishing_final_purity: float
    polishing_final_yield_fraction: float


@dataclass(frozen=True)
class SearchPlan:
    residue_stream: MaterialStream
    remaining_target_names: tuple[str, ...]
    product_records: tuple[ProductRecord, ...]
    cumulative_score: float
    worst_product_purity: float
    cumulative_target_recovery_log: float
    cumulative_energy_kj: float
    cumulative_setpoint_cost: float


@dataclass(frozen=True)
class ProcessNode:
    node_id: str
    node_kind: str
    parameters: dict[str, float | int | str | bool | None] = field(default_factory=dict)


@dataclass(frozen=True)
class ProcessEdge:
    source_node_id: str
    destination_node_id: str
    stream: MaterialStream | None = None
    parameters: dict[str, float | int | str | bool | None] = field(default_factory=dict)


@dataclass(frozen=True)
class ProcessGraph:
    nodes: tuple[ProcessNode, ...]
    edges: tuple[ProcessEdge, ...]
