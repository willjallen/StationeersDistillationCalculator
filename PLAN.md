Friend, here is the technical spec.

# Technical Spec: Stationeers Phase-Change Gas Sorting Simulator

## 1. Conversation summary

The user wants to build a Stationeers gas/air sorting system **without using the normal Filtration atmospherics block**. The desired mechanism is phase-change separation: compression, depressurization, cooling, heating, condensation, evaporation, liquid capture, gas bypass, and repeated polishing passes.

The core idea discussed was:

```text
mixed gas stream
  -> choose temperature and pressure
  -> one or more components cross into liquid
  -> drain liquid product
  -> remaining gas continues
  -> repeat until all useful gases are separated
```

This is essentially **fractional condensation** when starting from gas, and **distillation / reboiling** when purifying a liquid mixture.

We identified the first-order phase-change condition as:

```text
component condenses if chamber pressure is above its vapor-pressure curve at that temperature
component stays gas if chamber pressure is below its vapor-pressure curve at that temperature
```

For a target `A` to condense while contaminant `B` remains gaseous, the useful pressure interval at a given temperature is:

```text
P_vapor_A(T) < P_chamber < P_vapor_B(T)
```

For multiple contaminants:

```text
P_vapor_target(T) < P_chamber < min(P_vapor_contaminant_i(T))
```

The user correctly pushed back that the previous answer treated the separation windows too one-dimensionally. There are two control axes: **temperature** and **pressure**. The more correct problem is to search over both axes to find the fattest feasible separation region.

We then discussed that this still does not guarantee easy separation, because if two gases have similar vapor-pressure curves, then the legal region can remain thin everywhere. In those cases, the solution is not just “pick a better point.” The solution is repeated equilibrium contacts:

```text
partial separation
  -> reboil / repressurize / recool
  -> recycle vapor or liquid
  -> repeat until desired purity
```

That is the Stationeers analogue of reflux / fractionating distillation.

A first simple Python optimizer was provided. It used endpoint data and log-pressure interpolation to estimate vapor-pressure curves. That was useful only as a proof of concept. It searched stage setpoints but did not fully model arbitrary process topology, recycling, control error, finite residence time, or true pass-count purity. It showed an important qualitative result: a single monotonically colder condensation-only chain is probably not sufficient for all gases.

The user then clarified the real desired tool:

A fully aware simulator/planner that searches over heating, cooling, pressurizing, depressurizing, condensation, evaporation, branching, and multiple passes, then estimates how many passes are required to reach purity targets under finite temperature/pressure variation.

This spec defines that tool.

---

# 2. Objective

Build a Python simulator and optimizer that designs Stationeers-compatible phase-change gas sorting systems.

The program should answer questions of the form:

> Given an input gas mixture, available devices, pressure limits, temperature limits, control precision, and target purity, what sequence or network of phase-change stages best separates all gases into pure product streams without using filtration blocks?

The simulator must produce:

1. A candidate process graph.
2. Per-stage setpoints:

   * temperature
   * pressure
   * operation type
   * selected output branch
   * expected phase split
3. Product purity estimates.
4. Product recovery/yield estimates.
5. Pass-count estimates for repeated polishing.
6. Energy / thermal swing estimates.
7. Risk warnings:

   * freezing
   * overpressure
   * liquid in gas pipes
   * gas in liquid pipes
   * combustion-compatible mixtures
   * bad narrow separations
8. Sensitivity reports for temperature and pressure control error.

The output should be practical enough to guide an actual Stationeers build.

---

# 3. Non-goals

The simulator should **not** initially attempt to be a real-world thermodynamics package.

The primary target is **Stationeers game mechanics**, not physical chemistry. When real thermodynamics and Stationeers mechanics disagree, the simulator should prefer Stationeers behavior.

Do not build a visually pretty UI first. The first deliverable should be a correct CLI tool and data model.

Do not hard-code a single “best chain.” The whole point is that the process may require branching, reheating, recycling, and polishing loops.

Do not assume a pure monotonic cryogenic cascade is sufficient.

---

# 4. Core game-mechanics assumptions

These assumptions must be configurable, because Stationeers updates can change details.

## 4.1 Temperature and pressure are independent controls

Compression/decompression should not automatically heat/cool the stream unless this is explicitly proven by in-game behavior.

The simulator should model pressure changes as pressure changes, and model temperature changes through heat-transfer devices, radiators, heaters, coolers, phase-change energy, or user-defined thermal nodes.

## 4.2 Phase state is controlled by phase boundaries

Each substance has a vapor-pressure boundary curve:

```text
P_boundary = P_vapor_i(T)
```

At a given stage temperature and pressure, a substance can be classified as:

```text
gas-like    if P_stage < P_vapor_i(T)
liquid-like if P_stage > P_vapor_i(T)
solid-risk  if T_stage <= freezing/melting threshold
invalid     if outside known data range
```

## 4.3 Total-pressure versus partial-pressure ambiguity

The simulator must support two models:

### Model A: total pressure mode

```text
condenses if P_total > P_vapor_i(T)
```

This may match simplified Stationeers behavior where vapor pressure can be supplied by other gases.

### Model B: partial pressure mode

```text
condenses if y_i * P_total > P_vapor_i(T)
```

where:

```text
y_i = mole_fraction_i
```

This is closer to physical thermodynamics.

The CLI must allow:

```bash
--pressure-model total
--pressure-model partial
```

Default should be `total`, but the code must make this explicit and easy to change.

A calibration test should later determine which model matches the current Stationeers build.

## 4.4 Helium is a terminal tail gas

Helium has no useful liquid/frozen phase in the ordinary Stationeers phase-change system, so it should be treated as non-condensable unless game data says otherwise.

A gas sorting chain should eventually output helium as a remaining gas tail.

## 4.5 Sodium chloride and non-atmospheric substances

The simulator should support all substances in the data table, but ordinary “air sorting” presets should exclude sodium chloride unless explicitly requested.

---

# 5. Substance database

Create a substance database file:

```text
stationeers_phase_sort/data/substances.yaml
```

Each substance entry should contain:

```yaml
- name: Oxygen
  formula: O2
  phase_change_enabled: true
  melting_temperature_kelvin: 56.4
  minimum_condensation_pressure_kpa: 6.3
  boiling_temperature_kelvin_at_100_kpa: 86.5
  maximum_liquid_temperature_kelvin: 162.0
  maximum_liquid_pressure_kpa: 6000.0
  specific_heat_j_per_mol_kelvin: null
  latent_heat_j_per_mol: null
  hazard_tags:
    - oxidizer
  curve_points:
    - temperature_kelvin: 56.4
      pressure_kpa: 6.3
    - temperature_kelvin: 86.5
      pressure_kpa: 100.0
    - temperature_kelvin: 162.0
      pressure_kpa: 6000.0
```

The minimum required fields:

```text
name
formula
melting_temperature_kelvin
minimum_condensation_pressure_kpa
boiling_temperature_kelvin_at_100_kpa, nullable
maximum_liquid_temperature_kelvin
maximum_liquid_pressure_kpa
curve_points
hazard_tags
```

The exact phase boundary should be represented by many sampled points, not just endpoints.

The program should initially work with endpoint interpolation, but the final target is a calibrated curve database.

---

# 6. Phase curve representation

Implement:

```python
class PhaseCurve:
    def vapor_pressure_kpa(self, temperature_kelvin: float) -> PhaseBoundaryResult:
        ...
```

`PhaseBoundaryResult` should distinguish:

```text
valid vapor pressure
below melting / solid-risk region
above maximum liquid temperature / non-condensable region
outside data
```

Use piecewise interpolation.

Default interpolation:

```text
linear in temperature
linear in log pressure
```

That is:

```text
log(P) = lerp(log(P_left), log(P_right), alpha)
```

But design the API so later interpolation methods can be swapped in:

```text
piecewise_log_linear
monotone_cubic
raw_table_lookup
```

The phase curve must be monotonic-checked on load.

If a substance has non-monotonic or malformed curve data, the loader should fail loudly.

---

# 7. Mixture model

Represent a stream as:

```python
@dataclass
class MaterialStream:
    moles_by_substance_name: dict[str, float]
    temperature_kelvin: float
    pressure_kpa: float
    volume_liters: float | None
    phase_hint: Literal["gas", "liquid", "mixed", "unknown"]
```

The simulator should conserve moles exactly except for explicitly modeled vent/dump losses.

The simulator should not mutate streams in place. Every operation should return new streams.

Core helpers:

```python
total_moles(stream) -> float
mole_fraction(stream, substance_name) -> float
normalize_small_values(stream, epsilon) -> MaterialStream
composition_purity(stream, target_name) -> float
```

---

# 8. Stage model

A stage is a controlled operation applied to one input stream, producing two output streams:

```text
input stream
  -> controlled T/P phase split
  -> liquid branch
  -> gas branch
```

Represent as:

```python
@dataclass(frozen=True)
class PhaseSplitStage:
    stage_id: str
    operation_kind: Literal["condense", "evaporate", "equilibrate"]
    target_substance_name: str | None
    setpoint_temperature_kelvin: float
    setpoint_pressure_kpa: float
    selected_product_branch: Literal["gas", "liquid", "both"]
    residence_time_seconds: float | None
    device_model_name: str | None
```

The stage evaluator should produce:

```python
@dataclass
class StageEvaluation:
    gas_output_stream: MaterialStream
    liquid_output_stream: MaterialStream
    stage_metrics: StageMetrics
```

Metrics:

```python
@dataclass
class StageMetrics:
    target_purity_in_gas: float
    target_purity_in_liquid: float
    target_recovery_in_gas: float
    target_recovery_in_liquid: float
    liquid_fraction_by_substance_name: dict[str, float]
    gas_fraction_by_substance_name: dict[str, float]
    solid_risk_by_substance_name: dict[str, float]
    combustion_risk_score: float
    pressure_margin_kpa_by_substance_name: dict[str, float]
    log_pressure_margin_by_substance_name: dict[str, float]
    estimated_heat_required_joules: float | None
    estimated_power_required_watts: float | None
```

---

# 9. Partition model

The simplest deterministic split is binary:

```text
if substance is liquid at T/P:
    100% goes to liquid branch
else:
    100% goes to gas branch
```

But this is too brittle for planning purity under variation. The simulator should support several partition models.

## 9.1 Deterministic equilibrium model

```python
liquid_fraction_i = 1.0 if condenses else 0.0
```

Good for idealized feasibility.

## 9.2 Soft boundary model

Model finite control error and finite residence time by converting boundary margin into a smooth transition.

For total-pressure mode:

```text
margin_i = log(P_stage / P_vapor_i(T_stage))
```

For partial-pressure mode:

```text
margin_i = log((y_i * P_stage) / P_vapor_i(T_stage))
```

Then:

```text
liquid_fraction_i = sigmoid(margin_i / boundary_softness)
```

where `boundary_softness` is configurable.

This is not necessarily the real game model, but it gives the optimizer a continuous signal.

## 9.3 Monte Carlo controller-noise model

For a given stage, sample actual setpoints:

```text
T_actual = T_setpoint + error
P_actual = P_setpoint * exp(log_pressure_error)
```

Supported error distributions:

```text
uniform
normal
triangular
worst_case_grid
```

Then run deterministic or soft partition for each sample.

The output should include:

```text
mean purity
median purity
5th percentile purity
1st percentile purity
failure probability below target purity
solid-risk probability
```

This is the mechanism needed to answer:

> If I have ±0.5 K or ±1.0 K variation per step, how many passes until 99.99% purity?

---

# 10. Repeated pass / polishing model

This is critical.

For a polishing operation, the simulator should estimate what happens if the product stream is repeatedly processed by the same stage or small loop.

Each stage can be represented as a linear transition on mole vectors.

For a selected product branch `B`, define:

```text
n_next = A_B * n_current
reject = A_reject * n_current
```

For a simple phase split:

```text
A_liquid[i, i] = liquid_fraction_i
A_gas[i, i]    = 1 - liquid_fraction_i
```

Repeatedly keeping the selected branch gives:

```text
n_after_passes = (A_selected)^k * n_initial
```

Product purity after `k` passes:

```text
purity(k) = target_moles_after_k / total_moles_after_k
```

Target recovery after `k` passes:

```text
recovery(k) = target_moles_after_k / target_moles_initial
```

Find the minimum `k` such that:

```text
purity(k) >= target_purity
```

while also reporting:

```text
recovery(k)
lost_target_fraction
contaminant_rejection_fraction
```

Do not use a scalar shortcut unless the stream has exactly one contaminant. Use the vector form so the simulator handles many contaminants correctly.

For Monte Carlo mode, compute pass count distributions:

```text
expected passes
median passes
95th percentile passes
probability of never reaching target before max_passes
expected recovery at purity target
```

CLI options:

```bash
--target-purity 0.9999
--maximum-polishing-passes 50
--temperature-error-kelvin 0.5
--pressure-error-fraction 0.02
--monte-carlo-samples 2000
```

---

# 11. Process graph model

The ideal solution is not necessarily a linear chain.

Represent the design as a process graph:

```text
nodes:
  source
  heat_exchanger
  cooler
  heater
  compressor
  pressure_regulator
  phase_splitter
  liquid_storage
  gas_storage
  recycle_mixer
  vent
  drain

edges:
  material streams
```

Implement a simplified internal graph first:

```python
@dataclass
class ProcessNode:
    node_id: str
    node_kind: str
    parameters: dict[str, float | str | bool]

@dataclass
class ProcessEdge:
    source_node_id: str
    destination_node_id: str
    stream: MaterialStream

@dataclass
class ProcessGraph:
    nodes: list[ProcessNode]
    edges: list[ProcessEdge]
```

A candidate process can include:

```text
main gas path
liquid product polishing loops
gas product polishing loops
recycle from rejected branch to earlier stage
terminal product storage
terminal waste/tail gas
```

The first version does not need to solve arbitrary cyclic graphs perfectly. It can implement bounded recycle iteration:

```text
for recycle_iteration in range(max_recycle_iterations):
    evaluate graph nodes in topological order
    mix recycle streams into their target upstream nodes
    stop when stream composition changes below tolerance
```

---

# 12. Search problem

The optimizer must search over:

```text
stage target
operation kind
temperature
pressure
branch choice
stage ordering
reheat/cool between stages
repressurize/depressurize between stages
whether to polish a product
whether to recycle rejected material
```

This is not a simple chain optimization.

## 12.1 Candidate setpoint generation

For each mixture state and target substance, generate candidate `(T, P)` points.

Methods:

### Boundary-pair sampling

For each target `A` and contaminant `B`, solve or sample where:

```text
P_vapor_A(T) < P < P_vapor_B(T)
```

Generate pressure candidates:

```text
P = geometric_mean(P_vapor_A(T), P_vapor_B(T))
```

Score by:

```text
window_ratio = P_upper / P_lower
log_window = log(window_ratio)
```

### Grid sampling

Sample:

```text
temperature over valid global range
pressure over allowed pressure range
```

Keep points with good separation score.

### Adaptive local refinement

After coarse candidates, locally refine temperature and pressure with coordinate search or Nelder-Mead style hill climbing.

Because for a fixed `T`, the best `P` is often the geometric midpoint of the legal pressure window, this can often reduce to a one-dimensional temperature search.

## 12.2 Stage score

For a candidate phase split, compute:

```text
target purity in selected branch
target recovery in selected branch
contaminant rejection
solid risk
combustion risk
thermal cost
pressure cost
device feasibility
control sensitivity
```

Suggested score:

```text
score =
    + weight_purity * logit(product_purity)
    + weight_recovery * log(target_recovery + epsilon)
    + weight_window * log_pressure_window
    - weight_heat * abs(delta_temperature)
    - weight_pressure * abs(log(P_next / P_previous))
    - weight_solid_risk * solid_risk
    - weight_combustion_risk * combustion_risk
    - weight_complexity * device_count
```

Do not hide individual components. The report should show why a stage was chosen.

## 12.3 Chain / graph search

Implement in phases.

### Phase 1: greedy planner

At each step:

1. Given current active stream, evaluate all possible target splits.
2. Select best target/product branch according to score.
3. Emit that product.
4. Continue with the other branch as the main stream.
5. Stop when all requested products are captured or no useful split exists.

This is useful for debugging but not globally optimal.

### Phase 2: beam search planner

Maintain top `N` partial plans.

State:

```python
@dataclass
class SearchState:
    active_streams: list[MaterialStream]
    captured_product_streams: dict[str, MaterialStream]
    process_graph: ProcessGraph
    accumulated_cost: float
    accumulated_energy_joules: float
    previous_temperature_kelvin: float | None
    previous_pressure_kpa: float | None
```

Expand each state by applying candidate stages to any active stream.

Keep the best `beam_width` states.

### Phase 3: graph planner with polishing

After a beam-search base plan exists:

1. Identify product streams below target purity.
2. Generate polishing loops for each bad product.
3. Estimate pass count and recovery.
4. Add reboil/recycle nodes as needed.
5. Re-score entire graph.

### Phase 4: recycle steady-state solver

Implement bounded recycle only after the acyclic planner works.

---

# 13. Purity and pass-count reporting

For every product, output:

```text
target substance
product branch type
stage where captured
one-pass purity
one-pass recovery
recommended polishing stage
polishing passes for 99%
polishing passes for 99.9%
polishing passes for 99.99%
expected final recovery after polishing
main contaminants
limiting contaminant
temperature/pressure sensitivity
```

Example report format:

```text
Product: Nitrogen
Captured at: Stage 11, liquid branch
Stage setpoint: 178.4 K, 4320 kPa
One-pass purity: 97.8%
One-pass target recovery: 93.1%
Main contaminants: Methane 1.4%, Oxygen 0.8%
Control sensitivity:
  ±0.25 K, ±1% P: 2 passes to 99.99%, 88.2% recovery
  ±0.50 K, ±1% P: 4 passes to 99.99%, 74.6% recovery
  ±1.00 K, ±2% P: not recommended; 7.5% freeze/failure risk
Recommended handling:
  Reboil liquid nitrogen product at ...
  Return vapor reject to previous methane/nitrogen split stage.
```

The actual values above are placeholders. The simulator must compute them.

---

# 14. Energy and device-cost model

The first version can estimate thermal cost approximately.

For each conditioning transition:

```text
Q_sensible = sum_i(n_i * heat_capacity_i * (T_next - T_previous))
```

For phase change:

```text
Q_latent = sum_i(delta_liquid_moles_i * latent_heat_i)
```

Sign convention:

```text
positive Q = heat added
negative Q = heat removed
```

Since Stationeers device behavior may differ, make this optional:

```bash
--energy-model off
--energy-model approximate
--energy-model calibrated
```

For pressure work, because Stationeers does not model true adiabatic compression as normal physical thermodynamics, estimate pressure cost separately as pump/device complexity, not stream heat:

```text
pressure_cost = abs(log(P_next / P_previous)) * total_moles
```

Do not mix this into temperature unless a calibrated game model proves that pressure devices change temperature.

---

# 15. Hazard model

Implement hazard flags but do not overcomplicate them in version 1.

Substances should have tags:

```text
fuel
oxidizer
toxic
corrosive
inert
cryogenic
high_temperature
```

Hazard checks:

```text
fuel + oxidizer + high temperature -> combustion risk
oxygen + hydrogen at high temperature -> combustion risk
oxygen + methane at high temperature -> combustion risk
ozone + fuel -> high oxidizer risk
nitrous oxide + fuel -> oxidizer risk
solid-risk if T <= melting + margin
gas-pipe liquid fraction too high -> pipe damage risk
liquid-pipe pressure too high -> rupture risk
```

The simulator should not merely fail on hazards. It should report them and allow the user to constrain them:

```bash
--forbid-combustion-risk
--forbid-solid-risk
--maximum-solid-risk-probability 0.001
```

---

# 16. CLI design

Executable:

```bash
stationeers-phase-sort
```

Basic command:

```bash
stationeers-phase-sort plan \
  --preset all-gases \
  --target-purity 0.9999 \
  --pressure-model total \
  --temperature-error-kelvin 0.5 \
  --pressure-error-fraction 0.02 \
  --search-mode beam \
  --beam-width 32 \
  --output report.md \
  --output-csv stages.csv
```

Useful options:

```text
--substances Oxygen,Nitrogen,Carbon_Dioxide,...
--initial-composition composition.yaml
--target-products all
--exclude Sodium_Chloride
--include Helium
--minimum-temperature-kelvin 20
--maximum-temperature-kelvin 900
--maximum-pressure-kpa 6000
--temperature-grid 80
--pressure-grid 80
--adaptive-refinement
--monte-carlo-samples 5000
--maximum-polishing-passes 50
--maximum-recycle-iterations 100
--objective purity_recovery_energy
--allow-reheat
--allow-depressurize
--allow-recycle
--allow-distillation
--forbid-filtration-block
```

---

# 17. Output files

The planner should emit:

```text
report.md
stages.csv
products.csv
process_graph.json
sensitivity.csv
calibration_warnings.txt
```

## 17.1 `stages.csv`

Columns:

```text
stage_index
operation_kind
target_substance
input_stream_id
selected_branch
temperature_kelvin
temperature_celsius
pressure_kpa
delta_temperature_from_previous
delta_pressure_from_previous
liquid_output_composition
gas_output_composition
target_purity
target_recovery
limiting_contaminant
solid_risk_probability
combustion_risk_score
estimated_heat_required_joules
notes
```

## 17.2 `products.csv`

Columns:

```text
product_substance
capture_stage
raw_product_purity
raw_product_recovery
recommended_polishing_passes_99
recommended_polishing_passes_999
recommended_polishing_passes_9999
expected_final_purity
expected_final_recovery
main_contaminants
limiting_stage
```

## 17.3 `process_graph.json`

Machine-readable representation of the selected plan.

---

# 18. Package architecture

Recommended repository layout:

```text
stationeers-phase-sort/
  pyproject.toml
  README.md
  stationeers_phase_sort/
    __init__.py
    cli.py
    units.py
    data_loader.py
    phase_curve.py
    substances.py
    streams.py
    partition_models.py
    stage_models.py
    process_graph.py
    optimizer/
      __init__.py
      candidate_generation.py
      greedy.py
      beam_search.py
      polishing.py
      recycle_solver.py
      scoring.py
    uncertainty.py
    energy_model.py
    hazards.py
    reporting.py
    calibration.py
    presets.py
  data/
    substances.yaml
    devices.yaml
    presets/
      all_gases.yaml
      mars_atmosphere.yaml
      base_air.yaml
  tests/
    test_phase_curve.py
    test_partition_models.py
    test_stage_mass_conservation.py
    test_polishing_passes.py
    test_candidate_generation.py
    test_beam_search.py
    test_hazards.py
    test_reports.py
```

Use descriptive variable names throughout. Avoid terse names like `T`, `P`, `n`, `cfg` in production code unless inside a very local mathematical expression. Prefer:

```python
temperature_kelvin
pressure_kpa
moles_by_substance_name
planner_configuration
```

---

# 19. Calibration plan

The final simulator is only as good as its phase-curve data. Endpoint interpolation is not enough.

A coding agent should include a calibration workflow.

## 19.1 Pure-substance phase curve calibration

For each substance:

1. Create a known-volume chamber.
2. Insert a known amount of pure gas or liquid.
3. Sweep temperature.
4. Sweep pressure.
5. Record the boundary where liquid begins to appear/disappear.
6. Export points:

```csv
substance_name,temperature_kelvin,pressure_kpa,observed_phase
```

Then fit a monotone phase curve.

## 19.2 Mixture pressure-model calibration

Test whether Stationeers uses total pressure or partial pressure.

Example:

```text
Chamber A:
  100% CO2

Chamber B:
  1% CO2, 99% inert gas

Same total pressure and temperature.
```

If CO2 condenses in both chambers at the same total pressure, use total-pressure mode.

If diluted CO2 requires much higher total pressure proportional to dilution, use partial-pressure mode.

## 19.3 Device rate calibration

Measure:

```text
condensation valve throughput
condensation chamber throughput
evaporation chamber throughput
heater/cooler response
radiator cooling rate
pipe heat leakage
pump pressure control stability
sensor quantization
```

Store in:

```text
data/devices.yaml
```

## 19.4 Control-error calibration

Run a controller around a fixed setpoint and log:

```text
temperature error over time
pressure error over time
overshoot
settling time
oscillation amplitude
```

Feed this into the uncertainty model.

---

# 20. Acceptance criteria

The simulator is acceptable when it can do all of the following.

## 20.1 Deterministic correctness

* Conserves moles in every phase split.
* Never produces negative moles.
* Correctly classifies substances as gas/liquid/solid-risk for known curve points.
* Correctly reports impossible separations when no legal pressure/temperature region exists.
* Correctly handles helium as non-condensable tail gas.
* Correctly enforces pressure limits.

## 20.2 Search quality

* Finds at least one feasible partial sorting plan for the all-gases preset.
* Does not require monotonic cooling unless explicitly constrained.
* Uses reheating/depressurization when that improves separation.
* Identifies narrow separations and recommends polishing/recycle.
* Can optimize under different objective weights:

  * maximum purity
  * maximum recovery
  * minimum energy
  * minimum stage count

## 20.3 Polishing model

* For a known artificial two-component split, computes the exact number of repeated passes required to hit 99%, 99.9%, and 99.99%.
* Reports target recovery degradation as pass count increases.
* Handles more than one contaminant correctly.

## 20.4 Uncertainty model

* Reports purity distributions under temperature/pressure error.
* Shows worse purity/pass-count results as control error increases.
* Flags stages whose legal window is smaller than the configured control tolerance.

## 20.5 Reporting

* Emits a readable Markdown report.
* Emits machine-readable CSV and JSON.
* Shows enough information to build the machine in Stationeers.

---

# 21. Suggested implementation phases

## Phase 1: Data and deterministic phase split

Implement:

```text
substance loader
phase curve interpolation
material streams
deterministic stage evaluator
basic report
```

No optimizer yet. Hard-code a few test stages and verify.

## Phase 2: Candidate setpoint search

Implement candidate generation over `(temperature, pressure)`.

For each target in a mixture, find promising points and rank by:

```text
purity
recovery
pressure window
solid risk
```

## Phase 3: Greedy chain planner

Implement a simple greedy planner that repeatedly peels off one product.

This will be wrong sometimes, but it validates the mechanics.

## Phase 4: Beam search planner

Implement stateful beam search over arbitrary stage order and branch choice.

Allow reheat/cool and pressure changes between stages.

## Phase 5: Polishing / repeated-pass estimator

Implement transition-matrix polishing.

Add reports for pass counts to purity targets.

## Phase 6: Monte Carlo sensitivity

Implement uncertainty sampling over temperature and pressure.

Generate percentile reports.

## Phase 7: Recycle graph solver

Implement bounded recycle loops.

Allow rejected vapor/liquid from polishing to return upstream.

## Phase 8: Calibration tooling

Add a tool to ingest measured Stationpedia or in-game experimental phase data.

---

# 22. Core algorithms in pseudocode

## 22.1 Stage evaluation

```text
evaluate_stage(input_stream, stage):
    actual_temperature = stage.setpoint_temperature_kelvin
    actual_pressure = stage.setpoint_pressure_kpa

    for each substance in input_stream:
        phase_boundary = phase_curve[substance].vapor_pressure(actual_temperature)

        if actual_temperature <= substance.melting_temperature + margin:
            mark solid risk

        condensation_margin = compute_margin(
            pressure_model,
            actual_pressure,
            mole_fraction,
            phase_boundary
        )

        liquid_fraction = partition_model.liquid_fraction(condensation_margin)

        liquid_moles[substance] = input_moles[substance] * liquid_fraction
        gas_moles[substance] = input_moles[substance] * (1 - liquid_fraction)

    return gas_stream, liquid_stream, metrics
```

## 22.2 Candidate generation

```text
generate_candidates(stream):
    candidates = []

    for target in stream.substances:
        for temperature in temperature_grid:
            target_boundary = vapor_pressure(target, temperature)
            if target_boundary invalid:
                continue

            lower_pressure = target_boundary * safety_factor
            upper_pressure = maximum_pressure

            for contaminant in stream.substances excluding target:
                contaminant_boundary = vapor_pressure(contaminant, temperature)
                if contaminant should remain gas:
                    upper_pressure = min(upper_pressure, contaminant_boundary / safety_factor)

            if lower_pressure < upper_pressure:
                pressure = geometric_mean(lower_pressure, upper_pressure)
                candidates.append(stage(target, temperature, pressure))

    refine best candidates locally
    return candidates
```

## 22.3 Polishing pass count

```text
estimate_polishing_passes(product_stream, polishing_stage, target_purity):
    transition_matrix = diagonal matrix of selected_branch_fractions

    current_stream_vector = product_stream.vector

    for pass_index in 0..maximum_passes:
        purity = target_moles(current_stream_vector) / total_moles(current_stream_vector)

        if purity >= target_purity:
            return pass_index, purity, recovery

        current_stream_vector = transition_matrix * current_stream_vector

    return failure
```

## 22.4 Beam search

```text
beam = [initial_state]

for depth in range(maximum_stages):
    expanded_states = []

    for state in beam:
        for active_stream in state.active_streams:
            candidates = generate_candidates(active_stream)

            for candidate_stage in candidates:
                evaluated_stage = evaluate_stage(active_stream, candidate_stage)

                for branch_choice in ["gas", "liquid"]:
                    new_state = state after capturing branch or continuing branch
                    new_state.score = score_state(new_state)
                    expanded_states.append(new_state)

    beam = best N expanded_states

return best complete states
```

---

# 23. Important design philosophy

The ideal simulator should not merely output:

```text
Stage 1: 6000 kPa, 230 K
Stage 2: 6000 kPa, 180 K
...
```

That is too brittle.

It should output:

```text
This separation is easy because the legal pressure ratio is 18.2.
This one is bad because the legal pressure ratio is 1.07.
At ±0.5 K control error, this product needs 5 polishing passes.
At ±1.0 K, this stage becomes unreliable.
Recycle the reject stream upstream instead of venting it.
Do not use a monotonic cold chain here; reheat before this split.
```

The user is trying to build a physically/game-mechanically principled gas sorter. The simulator should therefore be an **explainable process planner**, not just a numerical optimizer.

---

# 24. Final coding-agent instruction

Implement a Python package that models Stationeers phase-change gas sorting as a configurable process-planning problem. It must load substance phase curves, simulate gas/liquid partitioning under temperature and pressure control, search arbitrary conditioning and phase-split stages, estimate product purity/recovery, compute repeated polishing pass counts under control error, and emit a practical build report.

The first version may use endpoint/log interpolation, but the architecture must treat exact phase curves as data. The planner must not assume a monotonic condensation chain. It must support reheating, cooling, pressurization, depressurization, distillation, polishing, and recycle. It must explicitly expose uncertainty and warn when a separation is narrower than the user’s control precision.
