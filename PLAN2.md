# PLAN2: Buildable Process Planner And Single View Model

## Objective

Make the simulator produce a comprehensive, buildable Stationeers gas/liquid separation plan that can be followed directly in game.

The planner should no longer answer only:

```text
At this exact temperature and pressure, what separates?
```

It must answer:

```text
Starting from this real stream state, what equipment, setpoints, ramp sequence,
buffers, drains, purges, recovery paths, and controller rules safely transform
the stream into the requested products?
```

The output must be one coherent process model and one coherent web UI view. Do not split the UI into separate process, ramp, and control views. Ramp hazards, controls, equipment, state transitions, and product/residue branches must all live in the same canonical plan model and be rendered in one inspectable process diagram.

## Core Product Rule

There is one source of truth:

```text
Python planner -> BuildPlanViewModel JSON -> TypeScript renderer
```

Python owns:

- process topology
- equipment choice
- pressure and temperature state transitions
- phase-change behavior
- ramp safety analysis
- required drains, purges, buffers, and recycle paths
- controller rules and alarms
- product/residue semantics

TypeScript owns:

- screen coordinates
- canvas layout
- hit testing
- selection overlays
- visual styling

TypeScript must not invent equipment, combine backend nodes into fake nodes, infer process topology, create synthetic product paths, or reinterpret a selected stage into a different graph. Selection is only an overlay on the already computed plan.

## Current Gap

The current planner evaluates endpoint equilibrium for candidate stages. It can say what fraction of each substance is gas/liquid/solid-risk at a selected setpoint. It also renders abstract operations such as pressure increasers, coolers, and phase equilibrators.

That is useful but incomplete for direct construction.

Missing behavior:

- transient ramp from input state to target setpoint
- safe ordering of pressure and temperature changes
- accidental condensation during ramp-up or cooldown
- sublimation/freezing risk during intermediate states
- liquid-in-gas-pipe and gas-in-liquid-pipe risk during transitions
- drain/purge requirements while crossing phase boundaries
- device-specific capabilities and limits
- final pressure/temperature stabilization loops
- product buffer/recovery behavior
- controller synthesis
- explicit startup and shutdown sequences

The new planner must treat a stage as a sequence of safe state transitions through actual buildable equipment, not as a single equilibrium point.

## Canonical Model

Add a backend model named `BuildPlanViewModel`. This is the only object returned to the UI for rendering the plan.

Suggested module:

```text
src/stationeers_phase_sort/build_plan/
  __init__.py
  models.py
  equipment.py
  ramp_audit.py
  stage_synthesis.py
  controller_synthesis.py
  view_model.py
```

The current `plan.graph` should either be replaced by this model or become a compatibility projection of it. The UI should render the build plan model directly.

## BuildPlanViewModel Shape

The model should contain these top-level sections:

```text
BuildPlanViewModel
  request
  assumptions
  substances
  nodes
  edges
  stages
  controllers
  hazards
  startup_sequence
  shutdown_sequence
  summary
```

This is still one view model. The sections are data domains, not separate UI views.

## Node Model

Every node in the rendered plan is a real plan object.

```text
BuildNode
  id
  kind
  label
  stage_index
  equipment
  role
  network
  state_in
  state_out
  stream_in
  stream_out
  setpoints
  ramp
  controls
  hazards
  build_notes
```

Allowed node kinds should include:

- source
- feed_buffer
- gas_buffer
- liquid_buffer
- recovery_buffer
- pressure_regulator
- back_pressure_regulator
- volume_pump
- turbo_volume_pump
- heat_exchanger
- radiator_bank
- wall_heater
- wall_cooler
- condensation_chamber
- evaporation_chamber
- condensation_valve
- expansion_valve
- purge_valve
- pressurant_valve
- phase_separator
- product_storage
- waste_dump
- alarm

Avoid abstract node kinds such as `cooler` or `pressure_increaser` in final build plans. If a concept is not yet mapped to equipment, emit an explicit `unresolved_equipment` node with a blocking hazard.

## Edge Model

Edges represent material flow or thermal coupling.

```text
BuildEdge
  id
  kind
  source_node_id
  target_node_id
  stream
  network
  direction
  controlled_by
  hazards
```

Allowed edge kinds:

- gas_stream
- liquid_stream
- mixed_stream
- thermal_coupling
- control_signal
- recovery
- purge
- drain
- bypass
- recycle

Edges must preserve backend graph fidelity. If the simulation says there is a condensation valve, purge valve, recovery path, or residue stream, it must appear as an edge/node in this model.

## Stream State Model

Every stream state must include enough information to decide if it is safe in the selected device/network.

```text
StreamState
  temperature_kelvin
  pressure_kpa
  total_moles
  volume_liters
  phase_hint
  network
  composition
  liquid_fraction_by_name
  gas_fraction_by_name
  solid_fraction_by_name
  vapor_pressure_by_name
  phase_margin_by_name
```

The model must distinguish:

- gas pipe
- liquid pipe
- mixed phase chamber
- storage tank
- atmosphere dump
- thermal loop

The same physical mixture can be safe in a phase chamber and unsafe in ordinary gas piping. The simulator must know the containment context.

## Equipment Model

Create first-class equipment definitions. Each device should declare what it can accept and produce.

```text
EquipmentDefinition
  kind
  buildable_name
  input_networks
  output_networks
  allowed_phase_states
  pressure_limit_kpa
  temperature_limit_kelvin
  active_power_watts
  passive
  can_change_pressure
  can_change_temperature
  can_transfer_heat
  can_separate_phase
  can_hold_mixed_phase
  required_controls
  failure_modes
```

The planner should prefer concrete devices over abstract operations:

- raising pressure: pressure regulator, volume pump, turbo volume pump
- lowering pressure: back pressure regulator, volume pump to recovery, controlled dump
- cooling: heat exchanger, radiator bank, wall cooler, phase-change loop
- heating: heat exchanger, wall heater, waste heat loop
- condensing and collecting liquid: condensation chamber, condensation valve
- evaporating and collecting gas: evaporation chamber, expansion valve, purge valve
- stabilizing liquid networks: pressurant valve, purge valve, liquid buffer

## Stage Synthesis

Each separation stage should expand into a buildable stage template:

```text
feed buffer
-> pressure/temperature ramp equipment
-> phase-safe containment or separator
-> gas branch buffer
-> liquid branch buffer
-> residue/recycle branch
-> product trim/storage
-> purge/drain/recovery safety path
```

The stage template should be adjusted based on the planned operation:

- condensation from gas
- evaporation from liquid
- equilibration in a mixed phase chamber
- polishing loop
- final residue storage

Do not assume that every stage needs every piece. Omit unnecessary equipment, but never omit safety equipment required by the simulated stream states.

## Ramp Safety Audit

Every transition from input state `A` to target state `B` must be audited.

Input:

```text
A = temperature_a, pressure_a, composition_a, phase/network context
B = temperature_b, pressure_b, composition_b, desired phase/network context
```

Test multiple candidate ramp paths:

- pressure first, then temperature
- temperature first, then pressure
- linear simultaneous ramp
- stepped pressure ramp with temperature holds
- stepped temperature ramp with pressure holds
- chamber-contained ramp
- ramp with active condensate drain
- ramp with active gas purge

At each sampled point:

- evaluate phase probability for each substance
- detect unintended liquid formation
- detect unintended evaporation
- detect solid risk
- detect network incompatibility
- detect overpressure
- detect hazardous mixtures at hazardous temperatures

The audit returns:

```text
RampAudit
  selected_path
  candidate_paths
  samples
  hazards
  required_equipment
  required_controls
  blocking
```

If all ordinary pipe paths are unsafe but a phase chamber path is safe, the planner must insert a chamber-contained ramp. If no safe path is found, the stage is not buildable and must be rejected or emitted as blocked.

## Ramp Scoring

The optimizer must score the full transition, not just the endpoint.

Add costs and penalties for:

- endpoint impurity
- target loss
- ramp solid risk
- unintended condensation
- unintended evaporation
- required drain complexity
- required purge complexity
- overpressure margin
- temperature swing
- pressure swing
- active device count
- passive radiator area estimate
- power draw estimate
- recycle complexity
- number of buffers
- number of polishing passes

A high-purity endpoint that crosses a fatal solid boundary during ramp-up should lose to a lower-yield but buildable stage.

## Path Selection Rules

The planner should prefer safe, simple paths:

1. Keep the stream in its current compatible network if possible.
2. Use valves instead of powered pumps where pressure differential can do the work safely.
3. Use recovery buffers instead of dumping valuable gas.
4. Use phase chambers when mixed phase or solids are possible.
5. Use drain/purge devices before normal pipe networks see incompatible phases.
6. Avoid cooling at high pressure when that causes unintended condensation.
7. Avoid pressurizing at low temperature when that causes unintended condensation.
8. Avoid depressurizing liquids below vapor pressure unless evaporation is intended and contained.
9. Prefer recirculating heat exchanger loops for temperature trim over adding hot/cold mass to final product tanks.

## Control Synthesis

Every active build node should emit controller rules.

```text
ControlRule
  id
  controlled_device_id
  sensor_node_id
  variable
  target
  deadband
  action
  priority
  fail_safe_state
```

Examples:

```text
Final product gas tank:
- run recirculation pump through cold exchanger if T > target + 1 K
- stop cooling if T < target - 0.5 K
- open fill regulator if P < target - 20 kPa and T is within target band
- open recovery back-pressure path if P > target + 20 kPa
- alarm if liquid fraction in gas buffer exceeds threshold
```

Controls must be part of the same graph. They can render as badges, inline annotations, or signal edges, but they must live in `BuildPlanViewModel`.

## One UI View

The website should show one process board.

The board contains:

- equipment nodes
- gas/liquid/mixed/recycle/drain/purge edges
- setpoint labels
- ramp hazard badges
- controller badges
- product/residue branch labels
- recovery paths
- selected-node inspector

No separate process/ramp/control tabs. The ramp and control details appear in the inspector for the selected node/stage and as compact badges on the same diagram.

The UI should support:

- pan and zoom
- fit
- minimap
- node selection
- edge selection
- stage focus
- hazard focus
- controller focus

These are interactions on one model, not separate models.

## Inspector Requirements

When selecting a node, the inspector should show:

- equipment name
- role in stage
- input state
- output state
- setpoints
- build ports/direction
- required sensors
- control rules
- ramp path summary
- transient hazards
- safety margins
- startup step
- shutdown step
- what to do with overpressure, condensate, and purge gas

When selecting an edge, the inspector should show:

- stream composition
- phase/network type
- pressure and temperature
- expected flow direction
- controlling device
- drain/purge/recovery behavior
- hazards

## Startup And Shutdown

The plan must include an ordered startup sequence.

Example sequence:

```text
1. Isolate product storage.
2. Pressurize liquid coolant loop.
3. Charge cold reservoir.
4. Bring feed buffer into safe pressure range.
5. Enable ramp chamber controls.
6. Enable condensate drain.
7. Open feed regulator.
8. Enable product trim loop.
```

Shutdown should include:

- close feed source
- drain/collect condensate
- purge gas from liquid networks
- recover overpressure to buffer
- isolate product tanks
- leave phase chambers in safe state

Startup/shutdown steps are rendered in the same UI as selectable sequence annotations, not as a separate view model.

## Hazard Policy

Unknown or unmodeled behavior must be visible.

Planner outputs should classify hazards as:

- info
- warning
- blocking

Blocking examples:

- all ramp paths cross solid boundary in normal pipes
- liquid expected in gas pipe without drain
- gas expected in liquid pipe without purge
- output pressure exceeds pipe/device limit
- required equipment has no buildable mapping
- endpoint is safe but transient path is unsafe and no chamber-contained route exists

Warnings should never be hidden behind a visually polished graph.

## Optimizer Changes

The optimizer should move from selecting endpoint stages to selecting buildable stage candidates.

New flow:

```text
1. Generate candidate endpoint separations.
2. For each endpoint, synthesize possible equipment/ramp paths.
3. Run ramp safety audit for each path.
4. Reject blocked candidates.
5. Score buildable candidates.
6. Assemble full process plan with buffers, recovery, polishing, and controls.
7. Emit BuildPlanViewModel.
```

This preserves the current phase-search work but wraps it in real construction logic.

## Backend Implementation Phases

### Phase 1: Canonical Build Plan Model

- Add `BuildPlanViewModel` dataclasses.
- Add JSON serialization.
- Include compatibility projection from current `SearchPlan`.
- Keep current solver behavior, but render through the new model shape.
- Add tests that graph node count and backend node count match exactly.

### Phase 2: Equipment Definitions

- Add `EquipmentDefinition`.
- Replace abstract graph nodes with buildable device nodes where possible.
- Emit `unresolved_equipment` for remaining abstract operations.
- Add unit tests for allowed input/output phases and pressure limits.

### Phase 3: Ramp Audit

- Implement ramp path sampling.
- Reuse existing `phase_probability` logic at each sample.
- Detect unintended phase transitions and solid risk.
- Add report fields to nodes and stages.
- Add tests for known unsafe transitions, especially CO2 on Mars and water near freezing.

### Phase 4: Buildable Stage Synthesis

- Expand each endpoint stage into feed buffer, ramp equipment, phase device, product buffers, residue paths, and safety paths.
- Insert condensation valves, purge valves, pressurant valves, or phase chambers when required by the ramp audit.
- Reject stages that cannot be made safe.

### Phase 5: Optimizer Integration

- Feed ramp safety and equipment complexity into scoring.
- Prefer buildable candidates over endpoint-only purity wins.
- Add beam-search support for buildable candidates.
- Add summary metrics for energy, active devices, buffers, recovery loss, and blocking hazards.

### Phase 6: Controller Synthesis

- Generate pressure, temperature, drain, purge, and recovery rules.
- Add controller nodes or signal edges to the same view model.
- Add deadbands and fail-safe states.
- Add tests for final product tank pressure/temperature trim loops.

### Phase 7: UI Rendering

- Replace the current graph consumption with `BuildPlanViewModel`.
- Render all backend nodes faithfully.
- Render ramp/control/hazard details as badges and inspector sections in the same board.
- Preserve pan, zoom, fit, minimap, node selection, and edge selection.
- Do not create separate process/ramp/control views.

## Test Strategy

Backend tests:

- phase endpoint behavior still matches current tests
- ramp audit catches condensation during pressure-first transitions
- ramp audit catches solid risk during temperature-first transitions
- chamber-contained ramp can make some unsafe pipe transitions buildable
- liquid-in-gas and gas-in-liquid paths require drain/purge devices
- build model serializes deterministically
- every rendered node has a backend node
- every backend edge has a rendered edge

Frontend tests:

- one view model drives the canvas
- node click only changes selection
- edge click only changes selection
- preset rerun fully replaces plan contents
- no frontend-generated equipment nodes
- hazard badges match backend hazards
- controller badges match backend controls

Visual checks:

- capture base-air plan
- capture all-gases plan
- capture a deliberately unsafe Mars/CO2 plan
- verify the diagram shows blocked or warning states clearly
- verify no text overlap or clipped inspector content

## Acceptance Criteria

The work is complete when:

- A plan can be read as a direct build recipe.
- Every pressure/temperature transition has a ramp audit.
- Unsafe transient behavior is either handled by equipment or marked blocking.
- Product stabilization includes pressure and temperature control rules.
- The web UI renders one canonical build plan model.
- The UI does not split process, ramp, and control into separate views.
- The frontend does not invent topology or equipment.
- Preset changes and reruns visibly change the process when backend outputs change.
- The graph remains faithful to backend nodes and edges.

## Design Principle

The simulator should be conservative. If the game build would require a buffer, drain, purge, phase chamber, recovery tank, or controller to make the plan safe, the plan must show it.

A clean endpoint is not enough. A buildable plan must be safe during startup, transition, steady operation, and shutdown.
