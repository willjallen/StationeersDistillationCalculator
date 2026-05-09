from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from stationeers_phase_sort.models import MaterialStream

GraphParameter = float | int | str | bool | None
Severity = Literal["info", "warning", "blocking"]


@dataclass(frozen=True)
class BuildHazard:
    hazard_id: str
    kind: str
    severity: Severity
    message: str
    stage_index: int | None = None
    node_id: str | None = None
    edge_id: str | None = None
    substance_name: str | None = None


@dataclass(frozen=True)
class StreamState:
    temperature_kelvin: float | None
    pressure_kpa: float | None
    total_moles: float
    volume_liters: float | None
    phase_hint: str
    network: str | None
    composition: dict[str, float]
    liquid_fraction_by_name: dict[str, float] = field(default_factory=dict)
    gas_fraction_by_name: dict[str, float] = field(default_factory=dict)
    solid_fraction_by_name: dict[str, float] = field(default_factory=dict)
    vapor_pressure_by_name: dict[str, float | None] = field(default_factory=dict)
    phase_margin_by_name: dict[str, float | None] = field(default_factory=dict)


@dataclass(frozen=True)
class RampSample:
    path_id: str
    sample_index: int
    temperature_kelvin: float
    pressure_kpa: float
    state: StreamState
    hazards: tuple[BuildHazard, ...] = tuple()


@dataclass(frozen=True)
class RampPathCandidate:
    path_id: str
    label: str
    required_equipment: tuple[str, ...]
    warning_count: int
    blocking_count: int
    max_liquid_fraction: float
    max_gas_fraction: float
    max_solid_fraction: float
    score: float


@dataclass(frozen=True)
class RampAudit:
    audit_id: str
    selected_path: str
    candidate_paths: tuple[RampPathCandidate, ...]
    samples: tuple[RampSample, ...]
    hazards: tuple[BuildHazard, ...]
    required_equipment: tuple[str, ...]
    required_controls: tuple[str, ...]
    blocking: bool


@dataclass(frozen=True)
class ControlRule:
    rule_id: str
    controlled_device_id: str
    sensor_node_id: str
    variable: str
    target: float | str | None
    deadband: float | None
    action: str
    priority: int
    fail_safe_state: str


@dataclass(frozen=True)
class BuildNode:
    node_id: str
    node_kind: str
    label: str
    stage_index: int | None = None
    equipment: str | None = None
    role: str | None = None
    network: str | None = None
    state_in: StreamState | None = None
    state_out: StreamState | None = None
    stream_in: MaterialStream | None = None
    stream_out: MaterialStream | None = None
    setpoints: dict[str, GraphParameter] = field(default_factory=dict)
    ramp: RampAudit | None = None
    controls: tuple[ControlRule, ...] = tuple()
    hazards: tuple[BuildHazard, ...] = tuple()
    build_notes: tuple[str, ...] = tuple()
    parameters: dict[str, GraphParameter] = field(default_factory=dict)


@dataclass(frozen=True)
class BuildEdge:
    edge_id: str
    edge_kind: str
    source_node_id: str
    target_node_id: str
    stream: MaterialStream | None
    network: str | None
    direction: str
    controlled_by: tuple[str, ...] = tuple()
    hazards: tuple[BuildHazard, ...] = tuple()
    parameters: dict[str, GraphParameter] = field(default_factory=dict)


@dataclass(frozen=True)
class BuildStage:
    stage_index: int
    target_name: str
    operation_kind: str
    product_branch: str
    endpoint_temperature_kelvin: float
    endpoint_pressure_kpa: float
    node_ids: tuple[str, ...]
    edge_ids: tuple[str, ...]
    hazards: tuple[BuildHazard, ...]


@dataclass(frozen=True)
class SequenceStep:
    step_id: str
    order: int
    text: str
    node_id: str | None = None
    stage_index: int | None = None


@dataclass(frozen=True)
class BuildPlanViewModel:
    request: dict[str, object]
    assumptions: tuple[str, ...]
    substances: tuple[str, ...]
    nodes: tuple[BuildNode, ...]
    edges: tuple[BuildEdge, ...]
    stages: tuple[BuildStage, ...]
    controllers: tuple[ControlRule, ...]
    hazards: tuple[BuildHazard, ...]
    startup_sequence: tuple[SequenceStep, ...]
    shutdown_sequence: tuple[SequenceStep, ...]
    summary: dict[str, GraphParameter]
