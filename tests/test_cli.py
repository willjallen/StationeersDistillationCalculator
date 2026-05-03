from __future__ import annotations

import json
from pathlib import Path

from stationeers_phase_sort.cli import main


def test_validate_data_command(capsys) -> None:  # type: ignore[no-untyped-def]
    assert main(["validate-data"]) == 0
    assert "Data validation passed." in capsys.readouterr().out


def test_plan_command_writes_outputs(tmp_path: Path) -> None:
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
    assert stages_path.read_text(encoding="utf-8").startswith("stage_index,operation_kind")
    assert products_path.exists()
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    assert graph["nodes"]
    assert graph["edges"]
