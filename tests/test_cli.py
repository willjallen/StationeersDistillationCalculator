from __future__ import annotations

import json
from pathlib import Path

from stationeers_phase_sort.cli import main


def test_validate_data_command(capsys) -> None:  # type: ignore[no-untyped-def]
    assert main(["validate-data"]) == 0
    assert "Data validation passed." in capsys.readouterr().out


def test_plan_command_writes_outputs(tmp_path: Path, capsys) -> None:  # type: ignore[no-untyped-def]
    report_path = tmp_path / "report.md"
    stages_path = tmp_path / "stages.csv"
    products_path = tmp_path / "products.csv"
    graph_path = tmp_path / "graph.json"

    assert (
        main(
            [
                "plan",
                "--substances",
                "Oxygen",
                "Nitrogen",
                "Carbon Dioxide",
                "Helium",
                "--temperature-grid",
                "4",
                "--pressure-grid",
                "4",
                "--maximum-polishing-passes",
                "5",
                "--output",
                str(report_path),
                "--output-csv",
                str(stages_path),
                "--output-products-csv",
                str(products_path),
                "--output-graph",
                str(graph_path),
            ]
        )
        == 0
    )

    assert report_path.exists()
    output = capsys.readouterr().out
    assert "solid-risk diversion:" in output
    assert "product moles:" in output
    assert stages_path.read_text(encoding="utf-8").startswith("stage_index,operation_kind")
    products_header = products_path.read_text(encoding="utf-8").splitlines()[0]
    assert "target_product_recovery_from_initial" in products_header
    assert "Solid-risk diversion" in report_path.read_text(encoding="utf-8")
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    assert graph["nodes"]
    assert graph["edges"]
    stage_nodes = [node for node in graph["nodes"] if node["node_kind"] == "phase_splitter"]
    assert all("solid_risk_total_moles" in node["parameters"] for node in stage_nodes)
    assert all("polishing_reached_target" in node["parameters"] for node in stage_nodes)
    equipment_nodes = [
        node
        for node in graph["nodes"]
        if node["node_kind"]
        in {"compressor", "cooler", "heater", "expansion_valve", "condensation_valve"}
    ]
    assert equipment_nodes
    assert all("unit_index" in node["parameters"] for node in equipment_nodes)
    assert any(node["node_kind"] == "compressor" for node in equipment_nodes)
    residue_nodes = [node for node in graph["nodes"] if node["node_kind"] == "residue"]
    assert residue_nodes
    assert all("residue_total_moles" in node["parameters"] for node in residue_nodes)
    assert any(node["node_kind"] == "solid_risk" for node in graph["nodes"])
