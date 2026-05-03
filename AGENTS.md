# AGENTS.md

## Operating Reminders

These instructions exist because previous UI work moved too quickly, burned time on repeated checks, and accepted a weak visual result. Follow them every turn in this repository.

## Goal Completion

- Do not claim a visual/UI goal is complete unless the current artifact visibly satisfies the user-provided reference or acceptance criteria.
- For visual work, inspect the reference image first, state the concrete visual targets, and compare the current screenshot against those targets before finalizing.
- Treat "close enough" as incomplete when the user asked to match a specific image or layout.
- Treat visual references as style, structure, and interaction targets unless the user explicitly asks for static mock data. Preserve the real application data and simulation behavior while adapting the presentation.
- If an instruction says not to stop until a visual target is met, continue iterating or clearly state the blocker. Do not mark the work complete based only on tests or implementation effort.

## Planning Before Editing

- Before large UI or rendering changes, pause and write a short implementation plan that identifies the core abstractions, data flow, and verification method.
- Avoid rushing directly into a large single-file implementation. Quick prototypes are acceptable only if they are replaced with a deliberate structure before final delivery.
- When a task involves nontrivial layout, canvas rendering, arrows, graph routing, or interaction, design the rendering model first.

## Canvas And Diagram Architecture

- Do not put the full canvas renderer into one master component.
- Split canvas work into focused modules before it grows:
  - scene/model types
  - layout engine
  - routing/path generation
  - drawing primitives
  - hit testing
  - theme/tokens
  - renderer orchestration
- Treat arrows, special connectors, labels, node placement, collision avoidance, and zoom/minimap behavior as real layout problems that need reusable primitives.
- Prefer deterministic layout data structures over ad hoc coordinate tweaks scattered through draw calls.
- Do not hard-code graph nodes, graph positions, labels, values, or flows merely to resemble a screenshot. Layout may use deterministic anchors and templates, but the rendered graph must be generated from the current separation plan data.
- Keep rendering pure where possible: layout functions should return drawable objects; drawing functions should consume those objects.
- Validate graph behavior across multiple presets and reruns. Changing inputs such as `base-air`, `all-gases`, constraints, or optimization settings must materially update the resulting plan data and diagram when the solver output changes.

## Functional Fidelity

- A polished webview is not acceptable if it stops being useful. Preserve and verify the core workflows before visual sign-off.
- Presets, feed composition controls, constraints, optimization controls, and the run/recalculate action must update the real simulation request and render the returned plan.
- Canvas controls must work: panning, fit/zoom, minimap orientation, node selection, route/edge selection where supported, and inspector updates should all respond to user input.
- Never replace live simulation output with sample data except for an explicit snapshot/demo mode. Snapshot data must be clearly isolated from normal interactive execution.
- When matching a reference UI, keep checking that the reference-driven styling has not severed the data flow, event handlers, or state transitions that make the page operational.
- The graph topology must come from the Python simulation/planner output. The web UI may render and lay out that graph, but it must not invent or substitute stage/product topology from frontend-only heuristics.
- Render backend graph nodes and edges faithfully. Do not replace multiple real graph nodes with frontend-only grouped nodes, fake summary nodes, or aliases unless the user explicitly asks for a presentation aggregate and the original graph remains inspectable.
- Computing or rerunning a plan must fully determine the graph contents. Clicking a graph node may highlight/focus the inspector only; it must not rebuild, re-root, reorder, or change node contents in the graph.
- Selection state must be an overlay on an already computed graph. It must not affect node labels, node values, edge routing, layout slots, product assignment, or which graph nodes exist.
- Do not preserve a numeric stage selection across a newly computed plan as though stage numbers identify the same physical separation target. A rerun or preset change must refocus from the returned plan, not reinterpret the old selection against different simulation data.
- Python owns process topology and equipment semantics, including separators, product storage, residue streams, solid-risk branches, condensation valves, heaters, and conditioning valves. TypeScript may compute screen coordinates and draw controls, but it must not create process equipment or product topology that is absent from `plan.graph`.
- Preset changes and reruns must visibly update graph topology when the returned simulation graph changes. A graph that looks identical for materially different plan outputs is a correctness failure, even if the UI is visually polished.
- Include operation nodes from the simulation graph, such as condensation valves, where the plan requires them. Do not hide required process equipment to make the diagram easier to style.

## Dev Workflow And Token Efficiency

- Set up fast dev scripts before rapid iteration. Prefer one command for each repeated task, such as:
  - frontend type check
  - frontend build
  - backend tests
  - screenshot capture
  - visual smoke checks
- Do not repeatedly run full test suites after every tiny CSS or drawing tweak. Use the narrowest relevant check during iteration, then run full gates at the end.
- Avoid spending many turns rediscovering tooling. If capture or browser automation is needed, script it once and reuse it.
- Prefer concise command output. Use targeted commands and limit output unless debugging a failure.

## Visual Verification

- For UI work, maintain a repeatable screenshot command and use it during iteration.
- Check at the actual target viewport. If the user says the page should not scroll, verify that with browser/DOM evidence, not just CSS intent.
- Compare screenshots against the reference for structure, spacing, density, visual hierarchy, and content visibility.
- Tests are not a substitute for visual inspection on visual tasks.
- Before declaring a visual match complete, spawn a subagent to compare a recent capture of the webview render against `goal_webui.png`.
- Give the subagent both images and instruct it to point out every visible style, structure, and interaction difference, including layout, spacing, scale, colors, typography, diagram routing, controls, clipped content, missing content, and any scroll/canvas artifacts.
- If the reference is a style target rather than a static data contract, tell the subagent to separate legitimate live-simulation data differences from presentation differences. Do not "fix" reported data/value differences by hard-coding mock values.
- Treat the subagent as an unbiased third-party reviewer: do not lead it toward approval, and do not summarize away differences it reports.
- The task is not complete unless the subagent reports no remaining presentation differences and no data-fidelity issues. If it reports any such difference, keep iterating and repeat the subagent review after a fresh capture.

## Quality Bar

- Build for the ceiling the task needs, not the fastest path to a screenshot.
- Prefer clear boundaries and replaceable pieces over tightly coupled code that blocks later improvements.
- If the current structure will limit the requested result, refactor first instead of layering more hacks on top.
- When user feedback says the result is disappointing or incomplete, acknowledge the gap, preserve the lesson in this file when asked, and improve the process before continuing implementation.
