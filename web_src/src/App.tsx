import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { numberText, percentText, shortName } from "./format";
import { PlanCanvas } from "./PlanCanvas";
import { samplePlan } from "./samplePlan";
import { canonicalGraph, canonicalNodeCount } from "./buildPlanGraph";
import type { CanvasView } from "./canvas/types";
import { clampCanvasZoom, fitCanvasView, readableCanvasView, zoomPercent, zoomStep } from "./canvas/zoom";
import type { BuildPlanEdge, BuildPlanNode, MetaPayload, PlanPayload, PlanRequest, Stage, Substance } from "./types";
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
  const [status, setStatus] = useState(snapshotMode ? "Snapshot loaded" : "Loading");
  const [running, setRunning] = useState(false);
  const [preset, setPreset] = useState("base-air");
  const [selected, setSelected] = useState<string[]>(snapshotMode ? snapshotSelection : scenarioSelection ?? baseAirSelection);
  const [composition, setComposition] = useState<Record<string, number>>(initialComposition);
  const [searchMode, setSearchMode] = useState<"greedy" | "beam">("greedy");
  const [selectedStageIndex, setSelectedStageIndex] = useState<number | null>(snapshotMode ? 3 : null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
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
        setStatus(snapshotMode ? "Snapshot loaded" : "Ready");
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

  const selectedBuildNode = useMemo((): BuildPlanNode | null => {
    if (!plan?.build_plan.nodes.length) {
      return null;
    }
    if (selectedNodeId) {
      return plan.build_plan.nodes.find((node) => node.node_id === selectedNodeId) ?? null;
    }
    if (selectedStageIndex !== null) {
      return plan.build_plan.nodes.find(
        (node) =>
          node.stage_index === selectedStageIndex &&
          ["condensation_chamber", "evaporation_chamber", "phase_separator"].includes(node.node_kind),
      ) ?? null;
    }
    return null;
  }, [plan, selectedNodeId, selectedStageIndex]);

  const selectedBuildEdge = useMemo((): BuildPlanEdge | null => {
    if (!plan?.build_plan.edges.length || !selectedEdgeId) {
      return null;
    }
    return plan.build_plan.edges.find((edge) => edge.edge_id === selectedEdgeId || edge.id === selectedEdgeId) ?? null;
  }, [plan, selectedEdgeId]);

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
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
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
      pressure_model: "total",
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
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setCanvasView(readableCanvasView(payload));
      setStatus("Plan ready");
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

  function exportPlan() {
    if (!plan) {
      return;
    }
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `stationeers-phase-sort-${safeFilenamePart(preset)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
    setStatus("Plan exported");
  }

  function clearInspector() {
    setSelectedStageIndex(null);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }

  async function runFunctionalSmoke() {
    try {
      const baseProducts = plan?.stages.length ?? 0;
      const baseGraphNodes = canonicalNodeCount(plan);
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
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setCanvasView(readableCanvasView(nextPlan));
      await nextFrame(2);

      const allGasProducts = document.querySelectorAll(".product-pill").length;
      const checkedFeed = document.querySelectorAll(".feed-row input[type='checkbox']:checked").length;
      if (allGasProducts <= baseProducts || checkedFeed < 10) {
        throw new Error(`preset did not expand UI: base=${baseProducts}, all=${allGasProducts}, checked=${checkedFeed}`);
      }
      const nextGraph = canonicalGraph(nextPlan);
      if (nextGraph.nodes.length <= baseGraphNodes) {
        throw new Error(`preset did not expand graph: base=${baseGraphNodes}, all=${nextGraph.nodes.length}`);
      }
      if (!nextGraph.nodes.some((node) => node.node_kind === "condensation_valve")) {
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
        `allGasGraphNodes=${nextGraph.nodes.length}`,
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
        canExport={Boolean(plan)}
        onPreset={handlePresetChange}
        onExport={exportPlan}
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
          inputs={inputs}
          searchMode={searchMode}
          updateInput={updateInput}
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
              onSelectNode={setSelectedNodeId}
              onSelectEdge={setSelectedEdgeId}
              view={canvasView}
              onViewChange={setCanvasView}
            />
          </div>
        </section>
      </main>
      <Inspector plan={plan} stage={selectedStage} node={selectedBuildNode} edge={selectedBuildEdge} onClear={clearInspector} />
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

function safeFilenamePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plan";
}

function statusTone(status: string, running: boolean) {
  if (running || status === "Loading" || status === "Planning") {
    return "working";
  }
  if (["Ready", "Plan ready", "Plan exported", "Snapshot loaded"].includes(status)) {
    return "ok";
  }
  return "warning";
}

function statusSymbol(status: string, running: boolean) {
  if (running || status === "Loading" || status === "Planning") {
    return "…";
  }
  return statusTone(status, running) === "ok" ? "✓" : "!";
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
  canExport,
  onPreset,
  onExport,
  onRun,
}: {
  preset: string;
  presets: string[];
  status: string;
  running: boolean;
  canExport: boolean;
  onPreset: (value: string) => void;
  onExport: () => void;
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
      <div className={`save-state ${statusTone(status, running)}`}><span>{statusSymbol(status, running)}</span>{status}</div>
      <div className="top-actions">
        <button type="button" onClick={onExport} disabled={!canExport}><UiIcon kind="download" />Export JSON</button>
        <button className="run-plan" type="button" onClick={onRun} disabled={running}>
          <UiIcon kind="play" />{running ? "Planning" : "Run Plan"}
        </button>
      </div>
    </header>
  );
}

type UiIconKind = "download" | "play" | "fit";

function UiIcon({ kind }: { kind: UiIconKind }) {
  if (kind === "download") {
    return (
      <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4v10" />
        <path d="m8.5 10.5 3.5 3.5 3.5-3.5" />
        <path d="M5 19h14" />
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
      <h2>Feed Composition <span>(relative mol)</span></h2>
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
      <CompactInput label="Feed Amount" value={inputs.totalMoles} suffix="mol" onChange={(value) => updateInput("totalMoles", value)} />
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
  inputs,
  searchMode,
  updateInput,
  setSearchMode,
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
  searchMode: "greedy" | "beam";
  updateInput: (key: keyof typeof inputs, value: number) => void;
  setSearchMode: (value: "greedy" | "beam") => void;
}) {
  return (
    <section className="side-card optimization-card">
      <h2>Planner Settings</h2>
      <span className="setting-label">Search Strategy</span>
      <div className="mode-pills secondary">
        <button className={searchMode === "greedy" ? "active" : ""} type="button" onClick={() => setSearchMode("greedy")}>Greedy</button>
        <button className={searchMode === "beam" ? "active" : ""} type="button" onClick={() => setSearchMode("beam")}>Beam</button>
      </div>
      <InfoPair label="Pressure Basis" value="Total network pressure" />
      <CompactInput label="Target Purity" value={inputs.targetPurity} suffix="%" onChange={(value) => updateInput("targetPurity", value)} />
    </section>
  );
}

function KpiStrip({ plan }: { plan: PlanPayload | null }) {
  const summary = plan?.summary;
  const totalPasses = totalPolishingPasses(plan?.stages ?? []);
  const productFraction =
    summary && summary.input_total_moles > 0
      ? summary.product_total_moles / summary.input_total_moles
      : null;
  const solidRiskSub = summary
    ? summary.solid_risk_total_moles > 0
      ? `${percentText(summary.solid_risk_fraction, 1)} of feed`
      : "none predicted"
    : "—";
  return (
    <section className="kpi-strip">
      <Kpi kind="box" label="Products" value={summary ? String(summary.product_count) : "—"} sub="streams" tone="teal" />
      <Kpi kind="shield" label="Worst Purity" value={summary ? percentText(summary.worst_product_purity, 0) : "—"} sub="minimum" tone="teal" />
      <Kpi kind="flame" label="Total Heat" value={summary ? `${numberText(summary.cumulative_energy_kj, 1)} kJ` : "—"} sub="estimated duty" tone="orange" />
      <Kpi kind="droplet" label="Total Product Mol" value={summary ? `${numberText(summary.product_total_moles, 0)} mol` : "—"} sub={productFraction === null ? "—" : `${percentText(productFraction, 0)} of feed`} tone="blue" />
      <Kpi kind="alert" label="Solid Risk" value={summary ? `${numberText(summary.solid_risk_total_moles, 2)} mol` : "—"} sub={solidRiskSub} tone="red" />
      <Kpi kind="layers" label="Total Passes" value={numberText(totalPasses, 0)} sub={totalPasses === null && plan?.stages.length ? "target unmet" : "polishing"} tone="dark" />
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

function totalPolishingPasses(stages: Stage[]) {
  if (!stages.length || stages.some((stage) => stage.polishing_passes_needed === null)) {
    return null;
  }
  return stages.reduce((sum, stage) => sum + (stage.polishing_passes_needed ?? 0), 0);
}

function Inspector({
  plan,
  stage,
  node,
  edge,
  onClear,
}: {
  plan: PlanPayload | null;
  stage: Stage | null;
  node: BuildPlanNode | null;
  edge: BuildPlanEdge | null;
  onClear: () => void;
}) {
  if (edge) {
    return (
      <aside className="inspector">
        <div className="inspector-title">
          <h2>Inspector</h2>
          <button type="button" aria-label="Clear inspector" onClick={onClear}>×</button>
        </div>
        <div className="stage-heading">
          <h3>{titleCase(edge.edge_kind)}</h3>
          <span>{edge.network ?? "Stream"}</span>
        </div>
        <p>{edge.direction}</p>
        <hr />
        <h4>Stream</h4>
        <InfoPair label="Flow" value={`${numberText(edge.stream?.total_moles ?? null, 1)} mol`} />
        <InfoPair label="Temperature" value={temperatureTextNullable(edge.stream?.temperature_kelvin ?? null)} />
        <InfoPair label="Pressure" value={`${numberText(edge.stream?.pressure_kpa ?? null, 0)} kPa`} />
        <InfoPair label="Controls" value={edge.controlled_by.length ? edge.controlled_by.join(", ") : "—"} />
        <hr />
        <h4>Hazards</h4>
        {edge.hazards.length ? edge.hazards.slice(0, 4).map((hazard) => (
          <InfoPair key={hazard.id} label={titleCase(hazard.severity)} value={hazard.message} />
        )) : <InfoPair label="Status" value="No edge hazards" />}
      </aside>
    );
  }

  if (node) {
    const selectedStage = stage ?? plan?.stages.find((item) => item.stage_index === node.stage_index) ?? null;
    const status = node.hazards.some((hazard) => hazard.severity === "blocking")
      ? "Blocked"
      : node.hazards.length
        ? "Watch"
        : "Ready";
    return (
      <aside className="inspector">
        <div className="inspector-title">
          <h2>Inspector</h2>
          <button type="button" aria-label="Clear inspector" onClick={onClear}>×</button>
        </div>
        <div className="stage-heading">
          <h3>{node.label}</h3>
          <span>{node.stage_index ? `Stage ${node.stage_index}` : "Plan"}</span>
        </div>
        <p>{node.equipment ?? titleCase(node.node_kind)}</p>
        <hr />
        <div className="status-row">
          <strong>Status</strong>
          <span className={status === "Ready" ? "status" : "status warning"}>{status}</span>
          <span className="pass">{node.controls.length} ctl</span>
        </div>
        <InfoPair label="Network" value={node.network ?? "—"} />
        <InfoPair label="Input T" value={temperatureTextNullable(stateNumber(node.state_in, "temperature_kelvin"))} />
        <InfoPair label="Output T" value={temperatureTextNullable(stateNumber(node.state_out, "temperature_kelvin"))} />
        <InfoPair label="Input P" value={`${numberText(stateNumber(node.state_in, "pressure_kpa"), 0)} kPa`} />
        <InfoPair label="Output P" value={`${numberText(stateNumber(node.state_out, "pressure_kpa"), 0)} kPa`} />
        {selectedStage ? (
          <>
            <hr />
            <h4>Stage Result</h4>
            <InfoPair label="Target" value={selectedStage.target_name} />
            <InfoPair label="Purity" value={percentText(selectedStage.polishing_final_purity, 2)} />
            <InfoPair label="Product" value={`${numberText(selectedStage.product_total_moles, 1)} mol`} />
          </>
        ) : null}
        <hr />
        <h4>Ramp</h4>
        <InfoPair label="Path" value={node.ramp ? titleCase(node.ramp.selected_path) : "No state change"} />
        <InfoPair label="Required" value={node.ramp?.required_equipment.join(", ") || "—"} />
        <InfoPair label="Blocking" value={node.ramp?.blocking ? "Yes" : "No"} />
        <hr />
        <h4>Controls</h4>
        {node.controls.length ? node.controls.slice(0, 3).map((rule) => (
          <InfoPair key={rule.id} label={titleCase(rule.variable)} value={rule.action} />
        )) : <InfoPair label="Rules" value="No active controls" />}
        <hr />
        <h4>Hazards</h4>
        {node.hazards.length ? node.hazards.slice(0, 4).map((hazard) => (
          <InfoPair key={hazard.id} label={titleCase(hazard.severity)} value={hazard.message} />
        )) : <InfoPair label="Status" value="No node hazards" />}
      </aside>
    );
  }

  if (!stage) {
    return (
      <aside className="inspector">
        <div className="inspector-title"><h2>Inspector</h2></div>
      </aside>
    );
  }
  const productPhase = streamPhaseLabel(stage.product_stream.phase_hint);
  const residuePhase = streamPhaseLabel(stage.residue_stream.phase_hint);
  const vaporMoles =
    (stage.product_stream.phase_hint === "gas" ? stage.product_stream.total_moles : 0) +
    (stage.residue_stream.phase_hint === "gas" ? stage.residue_stream.total_moles : 0);
  const stageStatus = stage.solid_risk_total_moles > 0 || stage.hazards.length
    ? "Watch"
    : stage.polishing_passes_needed === null
      ? "Below target"
      : "Ready";
  return (
    <aside className="inspector">
      <div className="inspector-title">
        <h2>Inspector</h2>
        <button type="button" aria-label="Clear inspector" onClick={onClear}>×</button>
      </div>
      <div className="stage-heading">
        <h3>{String(stage.stage_index).padStart(2, "0")} Separator</h3>
        <span>Stage {stage.stage_index}</span>
      </div>
      <p>Phase Separator</p>
      <hr />
      <div className="status-row">
        <strong>Status</strong>
        <span className={stageStatus === "Ready" ? "status" : "status warning"}>{stageStatus}</span>
        <span className="pass">{stage.polishing_passes_needed ?? "—"} pass</span>
      </div>
      <InfoPair label="Temperature" value={temperatureText(stage.temperature_kelvin)} />
      <InfoPair label="Pressure" value={`${numberText(stage.pressure_kpa, 0)} kPa`} />
      <hr />
      <h4>Streams</h4>
      <InfoPair label="Inlet" value={`${numberText(stage.feed_total_moles, 1)} mol`} />
      <InfoPair label="Vapor Fraction" value={percentText(vaporMoles / Math.max(stage.feed_total_moles, 1), 1)} />
      <div className={`outlet ${stage.product_stream.phase_hint === "liquid" ? "liquid-outlet" : "gas-outlet"}`}>
        <strong>Product — {productPhase}</strong>
        <InfoPair label="Flow" value={`${numberText(stage.product_stream.total_moles, 1)} mol`} />
        <InfoPair label="Purity" value={percentText(stage.product_purity, 1)} />
        <InfoPair label="Main" value={compositionSummary(stage.product_stream)} />
      </div>
      <div className={`outlet ${stage.residue_stream.phase_hint === "liquid" ? "liquid-outlet" : "gas-outlet"}`}>
        <strong>Residue — {residuePhase}</strong>
        <InfoPair label="Flow" value={`${numberText(stage.residue_stream.total_moles, 1)} mol`} />
        <InfoPair label="Main" value={compositionSummary(stage.residue_stream)} />
      </div>
      <hr />
      <h4>Performance</h4>
      <InfoPair label="Setpoint Cost" value={numberText(stage.setpoint_cost, 2)} />
      <InfoPair label="Duty" value={stage.estimated_heat_kj > 0 ? `${numberText(stage.estimated_heat_kj, 1)} kJ` : "—"} />
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

function temperatureTextNullable(kelvin: number | null) {
  if (kelvin === null) {
    return "—";
  }
  return temperatureText(kelvin);
}

function stateNumber(state: Record<string, unknown> | null, key: string) {
  const value = state?.[key];
  return typeof value === "number" ? value : null;
}

function titleCase(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function streamPhaseLabel(phaseHint: string) {
  return phaseHint === "unknown" ? "Unspecified" : titleCase(phaseHint);
}

function compositionSummary(stream: Stage["product_stream"]) {
  if (!stream.composition.length || stream.total_moles <= 0) {
    return "Empty";
  }
  return stream.composition
    .slice(0, 2)
    .map((item) => `${shortName(item.name)} ${percentText(item.fraction, 0)}`)
    .join(", ");
}

type BottomTab = "products" | "energy" | "warnings";

function BottomProducts({ plan }: { plan: PlanPayload | null }) {
  const [activeTab, setActiveTab] = useState<BottomTab>("products");
  const stages = plan?.stages ?? [];
  const orderedStages = orderProducts(stages);
  const warningRows = planWarningRows(plan);

  useEffect(() => {
    setActiveTab("products");
  }, [plan]);

  return (
    <footer className="bottom-products">
      <nav className="product-tabs">
        <button className={activeTab === "products" ? "active" : ""} type="button" onClick={() => setActiveTab("products")}>Products</button>
        <button className={activeTab === "energy" ? "active" : ""} type="button" onClick={() => setActiveTab("energy")}>Energy</button>
        <button className={activeTab === "warnings" ? "active" : ""} type="button" onClick={() => setActiveTab("warnings")}>Warnings</button>
      </nav>
      {activeTab === "products" ? (
        <div className="product-scroll">
          {orderedStages.map((stage) => (
            <div className="product-pill" key={stage.stage_index}>
              <ProductIcon branch={stage.product_branch} />
              <strong>{stage.target_name}</strong>
              <em>{numberText(stage.product_total_moles, 1)} mol</em>
              <small>{percentText(stage.polishing_final_purity, 0)} final purity</small>
            </div>
          ))}
        </div>
      ) : null}
      {activeTab === "energy" ? (
        <div className="product-scroll">
          {orderedStages.map((stage) => (
            <div className="product-pill" key={stage.stage_index}>
              <span className="product-icon energy" aria-hidden="true"><KpiIcon kind="flame" /></span>
              <strong>{stage.target_name}</strong>
              <em>{`${numberText(stage.estimated_heat_kj, 1)} kJ`}</em>
              <small>{numberText(stage.setpoint_cost, 2)} setpoint cost</small>
            </div>
          ))}
        </div>
      ) : null}
      {activeTab === "warnings" ? (
        warningRows.length ? (
          <div className="warning-scroll">
            {warningRows.map((warning) => (
              <div className={`warning-pill ${warning.severity}`} key={warning.id}>
                <strong>{warning.title}</strong>
                <em>{warning.detail}</em>
              </div>
            ))}
          </div>
        ) : (
          <div className="bottom-empty">
            <strong>No current warnings</strong>
            <em>The returned build plan has no hazards or below-target products.</em>
          </div>
        )
      ) : null}
      <BottomSummary plan={plan} stages={stages} tab={activeTab} warnings={warningRows.length} />
    </footer>
  );
}

function BottomSummary({
  plan,
  stages,
  tab,
  warnings,
}: {
  plan: PlanPayload | null;
  stages: Stage[];
  tab: BottomTab;
  warnings: number;
}) {
  const totalPasses = totalPolishingPasses(stages);
  if (tab === "energy") {
    return (
      <div className="product-total">
        <span>Total Heat</span>
        <strong>{plan ? `${numberText(plan.summary.cumulative_energy_kj, 1)} kJ` : "—"}</strong>
        <span>Setpoint Cost</span>
        <strong>{numberText(plan?.summary.cumulative_setpoint_cost ?? null, 2)}</strong>
      </div>
    );
  }
  if (tab === "warnings") {
    const blocking = plan?.build_plan.hazards.filter((hazard) => hazard.severity === "blocking").length ?? 0;
    return (
      <div className="product-total">
        <span>Warnings</span>
        <strong>{warnings}</strong>
        <span>Blocking</span>
        <strong>{blocking}</strong>
      </div>
    );
  }
  return (
    <div className="product-total">
      <span>Total Product</span>
      <strong>{numberText(plan?.summary.product_total_moles ?? null, 0)} mol</strong>
      <span>Total Passes</span>
      <strong>{numberText(totalPasses, 0)}</strong>
    </div>
  );
}

function planWarningRows(plan: PlanPayload | null) {
  if (!plan) {
    return [];
  }
  const hazardRows = plan.build_plan.hazards.map((hazard) => ({
    id: hazard.id,
    severity: hazard.severity,
    title: `${titleCase(hazard.severity)}: ${titleCase(hazard.kind)}`,
    detail: hazard.stage_index ? `Stage ${hazard.stage_index} - ${hazard.message}` : hazard.message,
  }));
  const stageRows = plan.stages.flatMap((stage) => [
    ...stage.hazards.map((hazard, index) => ({
      id: `stage:${stage.stage_index}:hazard:${index}`,
      severity: hazard.severity === "blocking" ? "blocking" : "warning",
      title: `${stage.target_name}: ${hazard.name}`,
      detail: `${numberText(hazard.threshold_temperature_kelvin, 0)} K threshold`,
    })),
    ...stage.solid_risk_by_name.map((risk) => ({
      id: `stage:${stage.stage_index}:solid:${risk.name}`,
      severity: "blocking",
      title: `${stage.target_name}: solid risk`,
      detail: `${risk.name} ${numberText(risk.moles, 2)} mol`,
    })),
  ]);
  const belowTargetRows = plan.summary.products_below_target.map((product) => ({
    id: `below-target:${product.name}`,
    severity: "warning",
    title: `${product.name}: below target purity`,
    detail: `${percentText(product.final_purity, 2)} final purity`,
  }));
  return [...hazardRows, ...stageRows, ...belowTargetRows];
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
