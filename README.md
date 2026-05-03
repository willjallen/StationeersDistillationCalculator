# Stationeers Phase Sort

Stationeers Phase Sort is a Python simulator and planner for separating Stationeers gases
with phase-change mechanics instead of filtration blocks.

The package supports:

- total-pressure and partial-pressure phase models
- control-noise-aware phase probabilities
- greedy and beam-search chain planning
- polishing pass estimates
- CSV, Markdown, and process-graph JSON outputs
- package data for substances, calibration points, hazards, and presets

## Usage

```bash
uv run stationeers-phase-sort plan \
  --substances Oxygen Nitrogen "Carbon Dioxide" Helium \
  --temperature-grid 4 \
  --pressure-grid 4
```

Validate packaged data:

```bash
uv run stationeers-phase-sort validate-data
```

Inspect a substance curve:

```bash
uv run stationeers-phase-sort inspect-substance Oxygen
```

Run the local webview:

```bash
uv run stationeers-phase-sort webview
```

Then open `http://127.0.0.1:8765/`.

Packaged presets are `all-gases`, `base-air`, and `mars-atmosphere`.
