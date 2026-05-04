from __future__ import annotations

from stationeers_phase_sort.models import (
    MaterialStream,
    PhaseProbability,
    ProductBranch,
    ProductRecord,
    SearchPlan,
    StageEvaluation,
)
from stationeers_phase_sort.process_graph import plan_to_process_graph


def test_process_graph_expands_condensing_separator_into_buffers_and_valve() -> None:
    feed = MaterialStream(
        {"Carbon Dioxide": 10.0, "Oxygen": 90.0},
        temperature_kelvin=293.15,
        pressure_kpa=100.0,
        phase_hint="gas",
    )
    stage = StageEvaluation(
        target_name="Carbon Dioxide",
        product_branch=ProductBranch.LIQUID,
        temperature_kelvin=260.0,
        pressure_kpa=6500.0,
        feed_stream=feed,
        product_stream=MaterialStream(
            {"Carbon Dioxide": 10.0},
            temperature_kelvin=260.0,
            pressure_kpa=6500.0,
            phase_hint="liquid",
        ),
        residue_stream=MaterialStream(
            {"Oxygen": 90.0},
            temperature_kelvin=260.0,
            pressure_kpa=6500.0,
            phase_hint="gas",
        ),
        phase_probabilities_by_name={
            "Carbon Dioxide": PhaseProbability(1.0, 0.0, 0.0, 1.0, 0.0, 6500.0, 5000.0),
            "Oxygen": PhaseProbability(0.0, 1.0, 0.0, -1.0, 0.0, 6500.0, 6000.0),
        },
        product_purity=1.0,
        target_recovery=1.0,
        target_loss_to_residue=0.0,
        product_total_moles=10.0,
        residue_total_moles=90.0,
        estimated_sensible_heat_kj=1.0,
        estimated_latent_heat_kj=6.0,
        setpoint_cost=0.0,
        solid_risk_total_moles=0.0,
        hazard_warnings=tuple(),
        score=0.0,
        limiting_impurity_name=None,
        operation_kind="condense",
    )

    graph = plan_to_process_graph(_single_stage_plan(stage))
    node_kinds = {node.node_kind for node in graph.nodes}

    assert "pressure_increaser" in node_kinds
    assert "cooler" in node_kinds
    assert "phase_equilibrator" in node_kinds
    assert "condensation_valve" in node_kinds
    assert "gas_buffer" in node_kinds
    assert "liquid_buffer" in node_kinds
    assert any(
        node.node_kind == "liquid_buffer" and node.parameters["pressure_warning"] is True
        for node in graph.nodes
    )
    assert any(
        edge.parameters.get("phase_transfer_device") == "condensation_valve"
        and edge.parameters.get("safety_warning") == "liquid_must_be_drained_by_condensation_valve"
        for edge in graph.edges
    )
    assert any(
        edge.parameters.get("pipe_network") == "liquid"
        and edge.parameters.get("safety_warning") == "liquid_pipe_overpressure"
        for edge in graph.edges
    )


def test_process_graph_expands_liquid_feed_evaporation_with_expansion_transfer() -> None:
    feed = MaterialStream(
        {"Water": 10.0},
        temperature_kelvin=300.0,
        pressure_kpa=6000.0,
        phase_hint="liquid",
    )
    stage = StageEvaluation(
        target_name="Water",
        product_branch=ProductBranch.GAS,
        temperature_kelvin=390.0,
        pressure_kpa=100.0,
        feed_stream=feed,
        product_stream=MaterialStream(
            {"Water": 8.0},
            temperature_kelvin=390.0,
            pressure_kpa=100.0,
            phase_hint="gas",
        ),
        residue_stream=MaterialStream(
            {"Water": 2.0},
            temperature_kelvin=390.0,
            pressure_kpa=100.0,
            phase_hint="liquid",
        ),
        phase_probabilities_by_name={
            "Water": PhaseProbability(0.2, 0.8, 0.0, -1.0, 0.0, 100.0, 120.0),
        },
        product_purity=1.0,
        target_recovery=0.8,
        target_loss_to_residue=0.2,
        product_total_moles=8.0,
        residue_total_moles=2.0,
        estimated_sensible_heat_kj=64.8,
        estimated_latent_heat_kj=64.0,
        setpoint_cost=0.0,
        solid_risk_total_moles=0.0,
        hazard_warnings=tuple(),
        score=0.0,
        limiting_impurity_name=None,
        operation_kind="evaporate",
    )

    graph = plan_to_process_graph(_single_stage_plan(stage))
    expansion_valves = [node for node in graph.nodes if node.node_kind == "expansion_valve"]
    phase_holders = [
        node
        for node in graph.nodes
        if node.node_kind == "heater" and node.parameters.get("role") == "phase_hold_delta"
    ]

    assert expansion_valves
    assert expansion_valves[0].parameters["direction"] == "liquid_network_to_gas_network"
    assert phase_holders
    assert phase_holders[0].parameters["native_phase_heat_kj"] < 0.0
    assert phase_holders[0].parameters["external_heat_kj"] > 0.0
    assert phase_holders[0].parameters["output_temperature_kelvin"] == 390.0


def _single_stage_plan(stage: StageEvaluation) -> SearchPlan:
    return SearchPlan(
        residue_stream=stage.residue_stream,
        remaining_target_names=tuple(),
        product_records=(
            ProductRecord(
                stage_index=1,
                stage=stage,
                polishing_passes_needed=1,
                polishing_final_purity=stage.product_purity,
                polishing_final_yield_fraction=1.0,
            ),
        ),
        cumulative_score=0.0,
        worst_product_purity=stage.product_purity,
        cumulative_target_recovery_log=0.0,
        cumulative_energy_kj=0.0,
        cumulative_setpoint_cost=0.0,
    )
