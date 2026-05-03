import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { numberText, percentText, shortName } from "./format";
import { PlanCanvas } from "./PlanCanvas";
import { samplePlan } from "./samplePlan";
import type { MetaPayload, PlanPayload, PlanRequest, Stage, Substance } from "./types";
import "./styles.css";

const targetSelection = [
  "Carbon Dioxide",
  "Nitrogen",
  "Oxygen",
  "Hydrogen",
  "Methane",
  "Ozone",
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
  const snapshotMode = new URLSearchParams(window.location.search).has("snapshot");
  const [meta, setMeta] = useState<MetaPayload | null>(null);
  const [plan, setPlan] = useState<PlanPayload | null>(snapshotMode ? samplePlan : null);
  const [status, setStatus] = useState(snapshotMode ? "Saved 2m ago" : "Loading");
  const [running, setRunning] = useState(false);
  const [preset, setPreset] = useState("base-air");
  const [selected, setSelected] = useState<string[]>(targetSelection);
  const [composition, setComposition] = useState<Record<string, number>>(initialComposition);
  const [pressureModel, setPressureModel] = useState<"total" | "partial">("total");
  const [searchMode, setSearchMode] = useState<"greedy" | "beam">("greedy");
  const [selectedStageIndex, setSelectedStageIndex] = useState<number | null>(3);
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
        setStatus(snapshotMode ? "Saved 2m ago" : "Ready");
      })
      .catch((error: Error) => setStatus(error.message));
  }, [snapshotMode]);

  useEffect(() => {
    if (meta && !snapshotMode) {
      void runPlan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, snapshotMode]);

  const selectedStage = useMemo(() => {
    if (!plan?.stages.length) {
      return null;
    }
    return (
      plan.stages.find((stage) => stage.stage_index === selectedStageIndex) ?? plan.stages[0]
    );
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

  function requestPayload(): PlanRequest {
    const filteredComposition = Object.fromEntries(
      selected.map((name) => [name, composition[name] ?? 1]),
    );
    return {
      substances: selected,
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
      setSelectedStageIndex(payload.stages[2]?.stage_index ?? payload.stages[0]?.stage_index ?? null);
      setStatus("Saved 2m ago");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Planner failed");
    } finally {
      setRunning(false);
    }
  }

  const substances = meta?.substances ?? (snapshotMode ? fallbackSubstances : []);

  return (
    <div className="shell">
      <Header
        preset={preset}
        presets={meta?.presets.map((item) => item.name) ?? ["base-air"]}
        status={status}
        running={running}
        onPreset={setPreset}
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
              <button type="button">☝</button>
              <button type="button">□</button>
              <button type="button">−</button>
              <span>100%</span>
              <button type="button">+</button>
            </div>
          </div>
          <div className="canvas-wrap">
            <PlanCanvas
              plan={plan}
              selectedStageIndex={selectedStage?.stage_index ?? null}
              onSelectStage={setSelectedStageIndex}
            />
          </div>
        </section>
      </main>
      <Inspector stage={selectedStage} />
      <BottomProducts plan={plan} />
    </div>
  );
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
      <div className="brand-mark">⚗</div>
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
        <button type="button">Compare Plans</button>
        <button type="button">Export⌄</button>
        <button className="run-plan" type="button" onClick={onRun} disabled={running}>
          ▷ {running ? "Planning" : "Run Plan"}
        </button>
      </div>
    </header>
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
  const visible = visibleOrder
    .map((name) => substances.find((substance) => substance.name === name))
    .filter((substance): substance is Substance => Boolean(substance));
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
              <span>{substance.name} <small>({substance.formula})</small></span>
              <input
                className="mol-input"
                type="number"
                value={composition[substance.name] ?? 0}
                step="0.001"
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
        <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <em>{suffix}</em>
      </span>
    </label>
  );
}

function Optimization({
  pressureModel,
  searchMode,
  setPressureModel,
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
      <div className="mode-pills">
        <button className={pressureModel === "total" ? "active" : ""} type="button" onClick={() => setPressureModel("total")}>▣ Total P</button>
        <button className={pressureModel === "partial" ? "active" : ""} type="button" onClick={() => setPressureModel("partial")}>◌ Partial P</button>
      </div>
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
      <Kpi icon="▧" label="Products" value={summary ? String(summary.product_count) : "—"} sub="streams" tone="teal" />
      <Kpi icon="◇" label="Worst Purity" value={summary ? percentText(summary.worst_product_purity, 0) : "—"} sub="minimum" tone="teal" />
      <Kpi icon="♨" label="Total Heat" value={summary ? `${numberText(summary.cumulative_energy_kj, 1)} kJ` : "—"} sub="net added" tone="orange" />
      <Kpi icon="💧" label="Total Product Mol" value={summary ? `${numberText(summary.product_total_moles, 0)} mol` : "—"} sub="100% of feed" tone="blue" />
      <Kpi icon="!" label="Solid Risk" value={summary ? `${numberText(summary.solid_risk_total_moles, 0)} mol` : "—"} sub="no solids" tone="red" />
      <Kpi icon="▰" label="Total Passes" value={String(totalPasses || "—")} sub="total" tone="dark" />
    </section>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: string; label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="kpi">
      <span className={`kpi-icon ${tone}`}>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{sub}</em>
      </div>
    </div>
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
      <InfoPair label="Temperature" value={`${numberText(stage.temperature_kelvin, 0)} K`} />
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
      <InfoPair label="Duty" value={`${numberText(stage.estimated_heat_kj, 1)} kJ`} />
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

function BottomProducts({ plan }: { plan: PlanPayload | null }) {
  const stages = plan?.stages ?? [];
  return (
    <footer className="bottom-products">
      <nav className="product-tabs">
        <button className="active" type="button">Products</button>
        <button type="button">Energy</button>
        <button type="button">Warnings</button>
      </nav>
      <div className="product-scroll">
        {stages.slice(0, 7).map((stage) => (
          <div className="product-pill" key={stage.stage_index}>
            <span className={stage.product_branch}>{stage.product_branch === "gas" ? "♨" : "💧"}</span>
            <strong>{shortName(stage.target_name)}</strong>
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

createRoot(document.getElementById("root")!).render(<App />);
