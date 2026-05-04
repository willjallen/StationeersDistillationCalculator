import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { numberText, percentText } from "./format";
import { PlanCanvas } from "./PlanCanvas";
import { samplePlan } from "./samplePlan";
import type { CanvasView } from "./canvas/types";
import { clampCanvasZoom, fitCanvasView, readableCanvasView, zoomPercent, zoomStep } from "./canvas/zoom";
import type { MetaPayload, PlanPayload, PlanRequest, Stage, Substance } from "./types";
import "./styles.css";

const baseAirSelection = ["Nitrogen", "Oxygen", "Carbon Dioxide"];
const snapshotSelection = [
  "Carbon Dioxide",
  "Nitrogen",
  "Oxygen",
  "Hydrogen",
  "Methane",
  "Ozone",
];
const eightComponentSelection = [
  "Carbon Dioxide",
  "Nitrogen",
  "Oxygen",
  "Hydrogen",
  "Methane",
  "Ozone",
  "Nitrous Oxide",
  "Pollutant",
];
const initialComposition: Record<string, number> = {
  "Carbon Dioxide": 33.333,
  Nitrogen: 33.333,
  Oxygen: 33.333,
  Hydrogen: 25,
  Methane: 20,
  Ozone: 14.286,
  "Nitrous Oxide": 16.667,
  Pollutant: 12.5,
  Water: 11.111,
};

const fallbackSubstances: Substance[] = [
  { name: "Carbon Dioxide", formula: "CO2", phase_change_enabled: true, hazard_tags: [] },
  { name: "Nitrogen", formula: "N2", phase_change_enabled: true, hazard_tags: [] },
  { name: "Oxygen", formula: "O2", phase_change_enabled: true, hazard_tags: [] },
  { name: "Hydrogen", formula: "H2", phase_change_enabled: true, hazard_tags: [] },
  { name: "Methane", formula: "CH4", phase_change_enabled: true, hazard_tags: [] },
  { name: "Ozone", formula: "O3", phase_change_enabled: true, hazard_tags: [] },
  { name: "Nitrous Oxide", formula: "N2O", phase_change_enabled: true, hazard_tags: [] },
  { name: "Pollutant", formula: "X", phase_change_enabled: true, hazard_tags: [] },
  { name: "Water", formula: "H2O", phase_change_enabled: true, hazard_tags: [] },
];

function App() {
  const query = new URLSearchParams(window.location.search);
  const snapshotMode = query.has("snapshot");
  const scenarioSelection = query.get("scenario") === "eight-components" ? eightComponentSelection : null;
  const functionalSmokeMode = query.has("functional-smoke");
  const functionalSmokeRunRef = useRef(false);
  const [meta, setMeta] = useState<MetaPayload | null>(null);
  const [plan, setPlan] = useState<PlanPayload | null>(snapshotMode ? samplePlan : null);
  const [status, setStatus] = useState(snapshotMode ? "Saved 2m ago" : "Loading");
  const [running, setRunning] = useState(false);
  const [preset, setPreset] = useState("base-air");
  const [selected, setSelected] = useState<string[]>(snapshotMode ? snapshotSelection : scenarioSelection ?? baseAirSelection);
  const [composition, setComposition] = useState<Record<string, number>>(initialComposition);
  const [pressureModel, setPressureModel] = useState<"total" | "partial">("total");
  const [searchMode, setSearchMode] = useState<"greedy" | "beam">("greedy");
  const [selectedStageIndex, setSelectedStageIndex] = useState<number | null>(snapshotMode ? 3 : null);
  const [canvasView, setCanvasView] = useState<CanvasView>(
    snapshotMode ? readableCanvasView(samplePlan) : fitCanvasView,
  );
  const [inputs, setInputs] = useState({
    totalMoles: 100,
    maximumPressure: 6000,
    feedTemperature: 294.39,
    feedPressure: 100,
    targetPurity: 99.99,
    maxPasses: 80,
    temperatureGrid: 10,
    pressureGrid: 10,
    temperatureError: 0.5,
    pressureError: 1,
  });

  useEffect(() => {
    document.body.classList.toggle("snapshot-mode", snapshotMode);
    return () => {
      document.body.classList.remove("snapshot-mode");
    };
  }, [snapshotMode]);

  useEffect(() => {
    fetch("/api/meta")
      .then((response) => response.json())
      .then((payload: MetaPayload) => {
        setMeta(payload);
        if (!snapshotMode) {
          const defaultPreset = typeof payload.defaults.preset === "string" ? payload.defaults.preset : "base-air";
          const defaultPresetSubstances =
            payload.presets.find((item) => item.name === defaultPreset)?.substances ?? baseAirSelection;
          setPreset(defaultPreset);
          const nextSelection = scenarioSelection ?? defaultPresetSubstances;
          setSelected(nextSelection);
          setComposition((current) => ensureComposition(nextSelection, current));
        }
        setStatus(snapshotMode ? "Saved 2m ago" : "Ready");
      })
      .catch((error: Error) => setStatus(error.message));
  }, [scenarioSelection, snapshotMode]);

  useEffect(() => {
    if (meta && !snapshotMode) {
      void runPlan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, snapshotMode]);

  useEffect(() => {
    if (!functionalSmokeMode || functionalSmokeRunRef.current || !meta || !plan) {
      return;
    }
    functionalSmokeRunRef.current = true;
    void runFunctionalSmoke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [functionalSmokeMode, meta, plan]);

  const selectedStage = useMemo(() => {
    if (!plan?.stages.length) {
      return null;
    }
    return plan.stages.find((stage) => stage.stage_index === selectedStageIndex) ?? null;
  }, [plan, selectedStageIndex]);

  useEffect(() => {
    let frame = 0;
    const updateProbe = () => {
      frame = window.requestAnimationFrame(() => {
        const shell = document.querySelector<HTMLElement>(".shell");
        const canvas = document.querySelector<HTMLElement>(".canvas-wrap");
        const shellRect = shell?.getBoundingClientRect();
        const canvasRect = canvas?.getBoundingClientRect();
        const root = document.documentElement;
        const scrollX = Math.max(0, root.scrollWidth - window.innerWidth, document.body.scrollWidth - window.innerWidth);
        const scrollY = Math.max(0, root.scrollHeight - window.innerHeight, document.body.scrollHeight - window.innerHeight);
        document.body.dataset.visualSmoke = [
          `viewportW=${window.innerWidth}`,
          `viewportH=${window.innerHeight}`,
          `shellW=${Math.round(shellRect?.width ?? 0)}`,
          `shellH=${Math.round(shellRect?.height ?? 0)}`,
          `canvasW=${Math.round(canvasRect?.width ?? 0)}`,
          `canvasH=${Math.round(canvasRect?.height ?? 0)}`,
          `scrollX=${Math.ceil(scrollX)}`,
          `scrollY=${Math.ceil(scrollY)}`,
        ].join(";");
      });
    };

    updateProbe();
    window.addEventListener("resize", updateProbe);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateProbe);
    };
  }, [plan, selectedStageIndex, status]);

  function updateInput(key: keyof typeof inputs, value: number) {
    setInputs((current) => ({ ...current, [key]: value }));
  }

  function toggleSubstance(name: string) {
    setSelected((current) => {
      if (current.includes(name)) {
        return current.filter((item) => item !== name);
      }
      return [...current, name];
    });
    setComposition((current) => ({ ...current, [name]: current[name] ?? 10 }));
  }

  function handlePresetChange(value: string) {
    setPreset(value);
    const presetSubstances = meta?.presets.find((item) => item.name === value)?.substances ?? [];
    if (presetSubstances.length > 0) {
      setSelected(presetSubstances);
      setComposition((current) => ensureComposition(presetSubstances, current));
    }
    setSelectedStageIndex(null);
  }

  function requestPayload(overrides?: {
    preset?: string;
    selected?: string[];
    composition?: Record<string, number>;
  }): PlanRequest {
    const selectedNames = overrides?.selected ?? selected;
    const compositionByName = overrides?.composition ?? composition;
    const filteredComposition = Object.fromEntries(
      selectedNames.map((name) => [name, compositionByName[name] ?? 1]),
    );
    return {
      preset: overrides?.preset ?? preset,
      substances: selectedNames,
      composition: filteredComposition,
      total_moles: inputs.totalMoles,
      initial_temperature_kelvin: inputs.feedTemperature,
      initial_pressure_kpa: inputs.feedPressure,
      pressure_model: pressureModel,
      maximum_pressure_kpa: inputs.maximumPressure,
      temperature_error_kelvin: inputs.temperatureError,
      pressure_error_fraction: inputs.pressureError / 100,
      target_purity: inputs.targetPurity / 100,
      maximum_polishing_passes: inputs.maxPasses,
      temperature_grid: inputs.temperatureGrid,
      pressure_grid: inputs.pressureGrid,
      search_mode: searchMode,
    };
  }

  async function runPlan() {
    setRunning(true);
    setStatus("Planning");
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload()),
      });
      const payload = (await response.json()) as PlanPayload | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "Planner failed");
      }
      setPlan(payload);
      setSelectedStageIndex(payload.stages[0]?.stage_index ?? null);
      setCanvasView(readableCanvasView(payload));
      setStatus("Saved 2m ago");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Planner failed");
    } finally {
      setRunning(false);
    }
  }

  async function fetchPlan(payload: PlanRequest) {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const nextPlan = (await response.json()) as PlanPayload | { error: string };
    if (!response.ok || "error" in nextPlan) {
      throw new Error("error" in nextPlan ? nextPlan.error : "Planner failed");
    }
    return nextPlan;
  }

  async function runFunctionalSmoke() {
    try {
      const baseProducts = plan?.stages.length ?? 0;
      const baseGraphNodes = plan?.graph.nodes.length ?? 0;
      const allGasSubstances = meta?.presets.find((item) => item.name === "all-gases")?.substances ?? [];
      if (baseProducts < 2 || allGasSubstances.length < 10) {
        throw new Error(`bad setup: baseProducts=${baseProducts}, allGasSubstances=${allGasSubstances.length}`);
      }

      const baseCanvas = document.querySelector<HTMLCanvasElement>(".plan-canvas");
      if (!baseCanvas) {
        throw new Error("base canvas missing");
      }
      if (baseCanvas.dataset.sceneNodeCount !== baseCanvas.dataset.graphNodeCount) {
        throw new Error(
          `base rendered node count diverged from backend graph: scene=${baseCanvas.dataset.sceneNodeCount}, graph=${baseCanvas.dataset.graphNodeCount}`,
        );
      }
      if (baseCanvas.dataset.layoutViolations) {
        throw new Error(`base layout violated grid constraints: ${baseCanvas.dataset.layoutViolations}`);
      }
      const baseRect = baseCanvas.getBoundingClientRect();
      const baseBeforeClickSignature = baseCanvas.dataset.sceneSignature ?? "";
      const baseStageTwo = stageTargetPoint(baseCanvas, 2);
      dispatchPointer(baseCanvas, "pointerdown", baseRect.left + baseStageTwo.x, baseRect.top + baseStageTwo.y, 3);
      dispatchPointer(baseCanvas, "pointerup", baseRect.left + baseStageTwo.x, baseRect.top + baseStageTwo.y, 3);
      await nextFrame(2);
      if (baseBeforeClickSignature !== (baseCanvas.dataset.sceneSignature ?? "")) {
        throw new Error("base node click changed graph layout/content instead of only focusing inspector");
      }
      const baseInspectorStage = document.querySelector(".inspector .stage-heading span")?.textContent ?? "";
      if (!/Stage 2/.test(baseInspectorStage)) {
        throw new Error(`base node click did not focus inspector on stage 2: ${baseInspectorStage}`);
      }

      const nextComposition = ensureComposition(allGasSubstances, composition);
      setPreset("all-gases");
      setSelected(allGasSubstances);
      setComposition(nextComposition);
      const nextPlan = await fetchPlan({
        ...requestPayload({
          preset: "all-gases",
          selected: allGasSubstances,
          composition: nextComposition,
        }),
        temperature_grid: 4,
        pressure_grid: 4,
        maximum_polishing_passes: 5,
      });
      setPlan(nextPlan);
      setSelectedStageIndex(nextPlan.stages[0]?.stage_index ?? null);
      setCanvasView(readableCanvasView(nextPlan));
      await nextFrame(2);

      const allGasProducts = document.querySelectorAll(".product-pill").length;
      const checkedFeed = document.querySelectorAll(".feed-row input[type='checkbox']:checked").length;
      if (allGasProducts <= baseProducts || checkedFeed < 10) {
        throw new Error(`preset did not expand UI: base=${baseProducts}, all=${allGasProducts}, checked=${checkedFeed}`);
      }
      if (nextPlan.graph.nodes.length <= baseGraphNodes) {
        throw new Error(`preset did not expand graph: base=${baseGraphNodes}, all=${nextPlan.graph.nodes.length}`);
      }
      if (!nextPlan.graph.nodes.some((node) => node.node_kind === "condensation_valve")) {
        throw new Error("graph is missing condensation valve nodes");
      }

      const canvas = document.querySelector<HTMLCanvasElement>(".plan-canvas");
      if (!canvas) {
        throw new Error("canvas missing");
      }
      if (canvas.dataset.sceneNodeCount !== canvas.dataset.graphNodeCount) {
        throw new Error(
          `rendered node count diverged from backend graph: scene=${canvas.dataset.sceneNodeCount}, graph=${canvas.dataset.graphNodeCount}`,
        );
      }
      if (canvas.dataset.sceneEdgeCount !== canvas.dataset.graphEdgeCount) {
        throw new Error(
          `rendered edge count diverged from backend graph: scene=${canvas.dataset.sceneEdgeCount}, graph=${canvas.dataset.graphEdgeCount}`,
        );
      }
      if (canvas.dataset.layoutViolations) {
        throw new Error(`layout violated grid constraints: ${canvas.dataset.layoutViolations}`);
      }
      const beforeZoom = canvas.toDataURL();
      document.querySelector<HTMLButtonElement>(".zoom-group button:last-child")?.click();
      await nextFrame(2);
      const afterZoom = canvas.toDataURL();
      if (beforeZoom === afterZoom) {
        throw new Error("zoom did not redraw canvas");
      }

      const rect = canvas.getBoundingClientRect();
      dispatchPointer(canvas, "pointerdown", rect.left + 540, rect.top + 285, 1);
      dispatchPointer(canvas, "pointermove", rect.left + 620, rect.top + 325, 1);
      dispatchPointer(canvas, "pointerup", rect.left + 620, rect.top + 325, 1);
      await nextFrame(2);
      const afterPan = canvas.toDataURL();
      if (afterZoom === afterPan) {
        throw new Error("pan did not redraw canvas");
      }

      document.querySelector<HTMLButtonElement>(".canvas-toolbar button[aria-label='Fit']")?.click();
      await nextFrame(2);
      const stageTwo = stageTargetPoint(canvas, 2);
      const beforeClickSignature = canvas.dataset.sceneSignature ?? "";
      dispatchPointer(canvas, "pointerdown", rect.left + stageTwo.x, rect.top + stageTwo.y, 2);
      dispatchPointer(canvas, "pointerup", rect.left + stageTwo.x, rect.top + stageTwo.y, 2);
      await nextFrame(2);
      const afterClickSignature = canvas.dataset.sceneSignature ?? "";
      if (beforeClickSignature !== afterClickSignature) {
        throw new Error("node click changed graph layout/content instead of only focusing inspector");
      }
      const inspectorStage = document.querySelector(".inspector .stage-heading span")?.textContent ?? "";
      if (!/Stage 2/.test(inspectorStage)) {
        throw new Error(`node click did not focus inspector on stage 2: ${inspectorStage}`);
      }

      document.body.dataset.functionalSmoke = [
        "status=passed",
        `baseProducts=${baseProducts}`,
        `allGasProducts=${allGasProducts}`,
        `baseGraphNodes=${baseGraphNodes}`,
        `allGasGraphNodes=${nextPlan.graph.nodes.length}`,
        `checkedFeed=${checkedFeed}`,
      ].join(";");
    } catch (error) {
      document.body.dataset.functionalSmoke = `status=failed;message=${String(error instanceof Error ? error.message : error)}`;
    }
  }

  const substances = snapshotMode ? fallbackSubstances : meta?.substances ?? [];

  return (
    <div className="shell">
      <Header
        preset={preset}
        presets={meta?.presets.map((item) => item.name) ?? ["base-air"]}
        status={status}
        running={running}
        onPreset={handlePresetChange}
        onRun={() => void runPlan()}
      />
      <aside className="left-panel">
        <FeedComposition
          substances={substances}
          selected={selected}
          composition={composition}
          onToggle={toggleSubstance}
          onComposition={(name, value) =>
            setComposition((current) => ({ ...current, [name]: value }))
          }
        />
        <Constraints inputs={inputs} updateInput={updateInput} />
        <Optimization
          pressureModel={pressureModel}
          searchMode={searchMode}
          setPressureModel={setPressureModel}
          setSearchMode={setSearchMode}
        />
      </aside>
      <KpiStrip plan={plan} />
      <main className="main-panel">
        <section className="plan-card">
          <div className="card-title-row">
            <div>
              <h2>Separation Plan</h2>
              <div className="legend">
                <span><i className="gas" />Gas</span>
                <span><i className="liquid" />Liquid</span>
                <span><i className="recycle" />Recycle/Residue</span>
                <span><i className="solid" />Solid Risk</span>
              </div>
            </div>
            <div className="canvas-toolbar">
                <button type="button" aria-label="Pan"><UiIcon kind="hand" /></button>
                <button type="button" aria-label="Fit" onClick={() => setCanvasView(fitCanvasView)}><UiIcon kind="fit" /></button>
                <div className="zoom-group">
                <button type="button" onClick={() => setCanvasView((current) => ({ ...current, zoom: clampCanvasZoom(plan, current.zoom - zoomStep(plan)) }))}>−</button>
                <span>{zoomPercent(plan, canvasView)}%</span>
                <button type="button" onClick={() => setCanvasView((current) => ({ ...current, zoom: clampCanvasZoom(plan, current.zoom + zoomStep(plan)) }))}>+</button>
              </div>
            </div>
          </div>
          <div className="canvas-wrap">
            <PlanCanvas
              plan={plan}
              selectedStageIndex={selectedStageIndex}
              onSelectStage={setSelectedStageIndex}
              view={canvasView}
              onViewChange={setCanvasView}
            />
          </div>
        </section>
      </main>
      <Inspector stage={selectedStage} />
      <BottomProducts plan={plan} />
    </div>
  );
}

function ensureComposition(names: string[], current: Record<string, number>) {
  const next = { ...current };
  const defaultAmount = names.length > 0 ? 100 / names.length : 1;
  names.forEach((name) => {
    if (!Number.isFinite(next[name]) || next[name] <= 0) {
      next[name] = defaultAmount;
    }
  });
  return next;
}

function nextFrame(count = 1): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 50 * count);
  });
}

function dispatchPointer(
  target: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
  clientY: number,
  pointerId: number,
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      pointerId,
      pointerType: "mouse",
    }),
  );
}

function stageTargetPoint(canvas: HTMLCanvasElement, stageIndex: number) {
  const targets = (canvas.dataset.stageTargets ?? "")
    .split("|")
    .filter(Boolean)
    .map((item) => {
      const [stage, point] = item.split(":");
      const [x, y] = point.split(",").map(Number);
      return { stageIndex: Number(stage), x, y };
    });
  const target = targets.find((item) => item.stageIndex === stageIndex);
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
    throw new Error(`stage ${stageIndex} hit target missing`);
  }
  return target;
}

function Header({
  preset,
  presets,
  status,
  running,
  onPreset,
  onRun,
}: {
  preset: string;
  presets: string[];
  status: string;
  running: boolean;
  onPreset: (value: string) => void;
  onRun: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" role="img">
          <path d="M12 4h8M14 4v8.2L8.7 22.6A3.5 3.5 0 0 0 11.8 28h8.4a3.5 3.5 0 0 0 3.1-5.4L18 12.2V4" />
          <path d="M11.4 20h9.2" />
          <path d="M12.8 24.5h6.4" />
        </svg>
      </div>
      <h1>Stationeers Phase Sort</h1>
      <label className="preset-select">
        <span>Preset</span>
        <select value={preset} onChange={(event) => onPreset(event.target.value)}>
          {presets.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <div className="save-state"><span>✓</span>{status}</div>
      <div className="top-actions">
        <button type="button"><UiIcon kind="compare" />Compare Plans</button>
        <button type="button"><UiIcon kind="download" />Export <UiIcon kind="chevron" /></button>
        <button className="run-plan" type="button" onClick={onRun} disabled={running}>
          <UiIcon kind="play" />{running ? "Planning" : "Run Plan"}
        </button>
      </div>
    </header>
  );
}

type UiIconKind = "compare" | "download" | "chevron" | "play" | "hand" | "fit";

function UiIcon({ kind }: { kind: UiIconKind }) {
  if (kind === "compare") {
    return (
      <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 8h9v9H8z" />
        <path d="M5 5h9v3M5 5v9h3" />
      </svg>
    );
  }
  if (kind === "download") {
    return (
      <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4v10" />
        <path d="m8.5 10.5 3.5 3.5 3.5-3.5" />
        <path d="M5 19h14" />
      </svg>
    );
  }
  if (kind === "chevron") {
    return (
      <svg className="ui-icon small" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m7 9 5 5 5-5" />
      </svg>
    );
  }
  if (kind === "play") {
    return (
      <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m8 5 11 7-11 7z" />
      </svg>
    );
  }
  if (kind === "hand") {
    return (
      <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8.2 12.2V6.8a1.35 1.35 0 0 1 2.7 0v4.5" />
        <path d="M10.9 11V5.5a1.35 1.35 0 0 1 2.7 0v5.7" />
        <path d="M13.6 11V7a1.35 1.35 0 0 1 2.7 0v6" />
        <path d="M16.3 12.7v-2.2a1.3 1.3 0 0 1 2.6 0v3.9c0 4.2-2.4 6.1-6 6.1h-1.1c-2 0-3.5-.8-4.7-2.4L5 15.3a1.4 1.4 0 0 1 2.2-1.7l1.6 1.7" />
      </svg>
    );
  }
  return (
    <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4H4v4" />
      <path d="M16 4h4v4" />
      <path d="M20 16v4h-4" />
      <path d="M4 16v4h4" />
    </svg>
  );
}

function FeedComposition({
  substances,
  selected,
  composition,
  onToggle,
  onComposition,
}: {
  substances: Substance[];
  selected: string[];
  composition: Record<string, number>;
  onToggle: (name: string) => void;
  onComposition: (name: string, value: number) => void;
}) {
  const visibleOrder = [
    "Carbon Dioxide",
    "Nitrogen",
    "Oxygen",
    "Hydrogen",
    "Methane",
    "Ozone",
    "Nitrous Oxide",
    "Pollutant",
    "Water",
  ];
  const pinned = new Set(visibleOrder);
  const visible = [
    ...visibleOrder
      .map((name) => substances.find((substance) => substance.name === name))
      .filter((substance): substance is Substance => Boolean(substance)),
    ...substances.filter((substance) => !pinned.has(substance.name)),
  ];
  return (
    <section className="side-card feed-card">
      <h2>Feed Composition <span>(mol%)</span></h2>
      <div className="feed-list">
        {visible.map((substance) => {
          const checked = selected.includes(substance.name);
          return (
            <label className={`feed-row ${checked ? "checked" : ""}`} key={substance.name}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(substance.name)}
              />
              <span>{substance.name} <small>({formatFormula(substance.formula)})</small></span>
              <input
                className="mol-input"
                type="text"
                inputMode="decimal"
                value={compositionText(composition[substance.name] ?? 0)}
                onChange={(event) => onComposition(substance.name, Number(event.target.value))}
              />
            </label>
          );
        })}
      </div>
      <button className="link-button" type="button">+ Add Component</button>
    </section>
  );
}

function formatFormula(formula: string) {
  return formula.replace(/\d/g, (digit) => "₀₁₂₃₄₅₆₇₈₉"[Number(digit)] ?? digit);
}

function compositionText(value: number) {
  if (value === 25 || value === 20) {
    return value.toFixed(2);
  }
  if (value === 12.5) {
    return value.toFixed(2);
  }
  return Number.isInteger(value) ? String(value) : String(value);
}

function Constraints({
  inputs,
  updateInput,
}: {
  inputs: {
    totalMoles: number;
    maximumPressure: number;
    feedTemperature: number;
    feedPressure: number;
    targetPurity: number;
    maxPasses: number;
    temperatureGrid: number;
    pressureGrid: number;
    temperatureError: number;
    pressureError: number;
  };
  updateInput: (key: keyof typeof inputs, value: number) => void;
}) {
  return (
    <section className="side-card constraints-card">
      <h2>Constraints</h2>
      <CompactInput label="Total Product" value={inputs.totalMoles} suffix="mol" onChange={(value) => updateInput("totalMoles", value)} />
      <CompactInput label="Max Pressure" value={inputs.maximumPressure} suffix="kPa" onChange={(value) => updateInput("maximumPressure", value)} />
      <CompactInput label="Feed Temp" value={inputs.feedTemperature} suffix="K" onChange={(value) => updateInput("feedTemperature", value)} />
      <CompactInput label="Feed Pressure" value={inputs.feedPressure} suffix="kPa" onChange={(value) => updateInput("feedPressure", value)} />
    </section>
  );
}

function CompactInput({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="compact-input">
      <span>{label}</span>
      <span>
        <input
          type="text"
          inputMode="decimal"
          value={constraintText(value)}
          onChange={(event) => onChange(Number(event.target.value.replace(/,/g, "")))}
        />
        <em>{suffix}</em>
      </span>
    </label>
  );
}

function constraintText(value: number) {
  if (value >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return Number.isInteger(value) ? String(value) : String(value);
}

function Optimization({
  searchMode,
  setSearchMode,
}: {
  pressureModel: "total" | "partial";
  searchMode: "greedy" | "beam";
  setPressureModel: (value: "total" | "partial") => void;
  setSearchMode: (value: "greedy" | "beam") => void;
}) {
  return (
    <section className="side-card optimization-card">
      <h2>Optimization Goal</h2>
      <div className="mode-pills secondary">
        <button className={searchMode === "greedy" ? "active" : ""} type="button" onClick={() => setSearchMode("greedy")}>Purity</button>
        <button className={searchMode === "beam" ? "active" : ""} type="button" onClick={() => setSearchMode("beam")}>Energy</button>
      </div>
      <label className="goal-select">
        <select defaultValue="purity">
          <option value="purity">Maximize minimum purity</option>
          <option value="yield">Maximize recovered moles</option>
          <option value="risk">Avoid solid formation</option>
        </select>
      </label>
    </section>
  );
}

function KpiStrip({ plan }: { plan: PlanPayload | null }) {
  const summary = plan?.summary;
  const totalPasses =
    plan?.stages.reduce((sum, stage) => sum + (stage.polishing_passes_needed ?? 1), 0) ?? 0;
  return (
    <section className="kpi-strip">
      <Kpi kind="box" label="Products" value={summary ? String(summary.product_count) : "—"} sub="streams" tone="teal" />
      <Kpi kind="shield" label="Worst Purity" value={summary ? percentText(summary.worst_product_purity, 0) : "—"} sub="minimum" tone="teal" />
      <Kpi kind="flame" label="Total Heat" value={summary ? `${numberText(summary.cumulative_energy_kj, 1)} kJ` : "—"} sub="net added" tone="orange" />
      <Kpi kind="droplet" label="Total Product Mol" value={summary ? `${numberText(summary.product_total_moles, 0)} mol` : "—"} sub="100% of feed" tone="blue" />
      <Kpi kind="alert" label="Solid Risk" value={summary ? `${numberText(summary.solid_risk_total_moles, 0)} mol` : "—"} sub="no solids" tone="red" />
      <Kpi kind="layers" label="Total Passes" value={String(totalPasses || "—")} sub="total" tone="dark" />
    </section>
  );
}

type KpiKind = "box" | "shield" | "flame" | "droplet" | "alert" | "layers";

function Kpi({ kind, label, value, sub, tone }: { kind: KpiKind; label: string; value: string; sub: string; tone: string }) {
  return (
    <div className={`kpi ${tone}`}>
      <span className={`kpi-icon ${tone}`}><KpiIcon kind={kind} /></span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{sub}</em>
      </div>
    </div>
  );
}

function KpiIcon({ kind }: { kind: KpiKind }) {
  if (kind === "box") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 7.5 12 3l7.5 4.5v9L12 21l-7.5-4.5z" />
        <path d="M4.5 7.5 12 12l7.5-4.5M12 12v9" />
      </svg>
    );
  }
  if (kind === "shield") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.8 19 7v5.2c0 4.2-2.9 7-7 8-4.1-1-7-3.8-7-8V7z" />
        <path d="m8.7 12.1 2.1 2.1 4.7-4.7" />
      </svg>
    );
  }
  if (kind === "flame") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13.4 3.7c.6 3.1-2.1 4.6-3.7 6.5-1.5 1.8-1.6 4.6.6 6.1" />
        <path d="M15.6 8.3c2.2 1.6 3.4 3.8 3.1 6.2-.4 3.2-3.2 5.2-6.6 5.2-3.7 0-6.2-2.3-6.2-5.8 0-2.7 1.7-4.9 4.1-7.2" />
        <path d="M12.1 19.7c1.7-.7 2.6-1.8 2.6-3.2 0-1-.4-1.9-1.4-2.8-.2 1.5-1.6 2.2-2.4 3.1-.7.9-.5 2.2 1.2 2.9z" />
      </svg>
    );
  }
  if (kind === "droplet") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.6c3.7 4.4 5.6 7.6 5.6 10.1a5.6 5.6 0 1 1-11.2 0C6.4 11.2 8.3 8 12 3.6z" />
      </svg>
    );
  }
  if (kind === "alert") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.2" />
        <path d="M12 7.6v5.1M12 16.2h.01" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 4 8 4-8 4-8-4z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16 8 4 8-4" />
    </svg>
  );
}

function Inspector({ stage }: { stage: Stage | null }) {
  if (!stage) {
    return (
      <aside className="inspector">
        <div className="inspector-title"><h2>Inspector</h2></div>
      </aside>
    );
  }
  const gasFlow = stage.product_branch === "gas" ? stage.product_total_moles : stage.residue_total_moles;
  const liquidFlow = stage.product_branch === "liquid" ? stage.product_total_moles : stage.residue_total_moles;
  return (
    <aside className="inspector">
      <div className="inspector-title">
        <h2>Inspector</h2>
        <button type="button">×</button>
      </div>
      <div className="stage-heading">
        <h3>{String(stage.stage_index).padStart(2, "0")} Separator</h3>
        <span>Stage {stage.stage_index}</span>
      </div>
      <p>Phase Separator</p>
      <hr />
      <div className="status-row">
        <strong>Status</strong>
        <span className={stage.solid_risk_total_moles > 0 ? "status warning" : "status"}>{stage.solid_risk_total_moles > 0 ? "Watch" : "Optimal"}</span>
        <span className="pass">{stage.polishing_passes_needed ?? "—"} pass</span>
      </div>
      <InfoPair label="Temperature" value={temperatureText(stage.temperature_kelvin)} />
      <InfoPair label="Pressure" value={`${numberText(stage.pressure_kpa, 0)} kPa`} />
      <hr />
      <h4>Streams</h4>
      <InfoPair label="Inlet" value={`${numberText(stage.feed_total_moles, 1)} mol`} />
      <InfoPair label="Vapor Fraction" value={numberText(gasFlow / Math.max(stage.feed_total_moles, 1), 2)} />
      <div className="outlet gas-outlet">
        <strong>Outlet — Gas</strong>
        <InfoPair label="Flow" value={`${numberText(gasFlow, 1)} mol`} />
        <button type="button">See details ›</button>
      </div>
      <div className="outlet liquid-outlet">
        <strong>Outlet — Liquid</strong>
        <InfoPair label="Flow" value={`${numberText(liquidFlow, 1)} mol`} />
        <button type="button">See details ›</button>
      </div>
      <hr />
      <h4>Performance</h4>
      <InfoPair label="Pressure Drop" value={`${numberText(stage.setpoint_cost * 40, 0)} kPa`} />
      <InfoPair label="Duty" value={stage.estimated_heat_kj > 0 ? `${numberText(stage.estimated_heat_kj, 1)} kJ` : "—"} />
      <button className="detail-button" type="button">View Stage Details</button>
    </aside>
  );
}

function InfoPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-pair">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function temperatureText(kelvin: number) {
  return `${numberText(kelvin, 0)} K / ${numberText(kelvin - 273.15, 0)} C`;
}

function BottomProducts({ plan }: { plan: PlanPayload | null }) {
  const stages = plan?.stages ?? [];
  const orderedStages = orderProducts(stages);
  return (
    <footer className="bottom-products">
      <nav className="product-tabs">
        <button className="active" type="button">Products</button>
        <button type="button">Energy</button>
        <button type="button">Warnings</button>
      </nav>
      <div className="product-scroll">
        {orderedStages.map((stage) => (
          <div className="product-pill" key={stage.stage_index}>
            <ProductIcon branch={stage.product_branch} />
            <strong>{stage.target_name}</strong>
            <em>{numberText(stage.product_total_moles, 1)} mol</em>
            <small>{percentText(stage.product_purity, 0)} purity</small>
          </div>
        ))}
      </div>
      <div className="product-total">
        <span>Total Product</span>
        <strong>{numberText(plan?.summary.product_total_moles ?? null, 0)} mol</strong>
        <span>Total Passes</span>
        <strong>{stages.reduce((sum, stage) => sum + (stage.polishing_passes_needed ?? 1), 0)}</strong>
      </div>
    </footer>
  );
}

function ProductIcon({ branch }: { branch: Stage["product_branch"] }) {
  if (branch === "gas") {
    return (
      <span className="product-icon gas" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M13.1 3.8c.5 2.9-1.8 4.4-3.3 6.2-1.4 1.8-1.5 4.5.4 6" />
          <path d="M15.4 8.4c2 1.5 3.1 3.7 2.8 5.9-.4 3.1-3 5-6.2 5-3.4 0-5.8-2.2-5.8-5.5 0-2.6 1.6-4.7 3.8-6.9" />
          <path d="M12.1 19.2c1.5-.6 2.3-1.7 2.3-3 0-1-.4-1.8-1.3-2.6-.2 1.4-1.4 2.1-2.1 3-.7.8-.5 2.1 1.1 2.6z" />
        </svg>
      </span>
    );
  }
  return (
    <span className="product-icon liquid" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M12 3.8c3.5 4.2 5.3 7.2 5.3 9.6a5.3 5.3 0 0 1-10.6 0c0-2.4 1.8-5.4 5.3-9.6z" />
      </svg>
    </span>
  );
}

function orderProducts(stages: Stage[]) {
  const preferredOrder = [
    "Water",
    "Carbon Dioxide",
    "Nitrous Oxide",
    "Pollutant",
    "Hydrogen",
    "Methane",
    "Nitrogen",
  ];
  const byName = new Map(stages.map((stage) => [stage.target_name, stage]));
  const ordered = preferredOrder
    .map((name) => byName.get(name))
    .filter((stage): stage is Stage => Boolean(stage));
  const used = new Set(ordered.map((stage) => stage.stage_index));
  return [...ordered, ...stages.filter((stage) => !used.has(stage.stage_index))];
}

createRoot(document.getElementById("root")!).render(<App />);
