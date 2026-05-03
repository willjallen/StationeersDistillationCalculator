# AGENTS.md

## Operating Reminders

These instructions exist because previous UI work moved too quickly, burned time on repeated checks, and accepted a weak visual result. Follow them every turn in this repository.

## Goal Completion

- Do not claim a visual/UI goal is complete unless the current artifact visibly satisfies the user-provided reference or acceptance criteria.
- For visual work, inspect the reference image first, state the concrete visual targets, and compare the current screenshot against those targets before finalizing.
- Treat "close enough" as incomplete when the user asked to match a specific image or layout.
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
- Keep rendering pure where possible: layout functions should return drawable objects; drawing functions should consume those objects.

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

## Quality Bar

- Build for the ceiling the task needs, not the fastest path to a screenshot.
- Prefer clear boundaries and replaceable pieces over tightly coupled code that blocks later improvements.
- If the current structure will limit the requested result, refactor first instead of layering more hacks on top.
- When user feedback says the result is disappointing or incomplete, acknowledge the gap, preserve the lesson in this file when asked, and improve the process before continuing implementation.
