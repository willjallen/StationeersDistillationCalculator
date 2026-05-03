const state = {
  meta: null,
  result: null,
  running: false,
};

const els = {
  runStatus: document.querySelector("#runStatus"),
  runButton: document.querySelector("#runButton"),
  presetSelect: document.querySelector("#presetSelect"),
  substanceList: document.querySelector("#substanceList"),
  compositionRows: document.querySelector("#compositionRows"),
  totalMoles: document.querySelector("#totalMoles"),
  maximumPressure: document.querySelector("#maximumPressure"),
  initialTemperature: document.querySelector("#initialTemperature"),
  initialPressure: document.querySelector("#initialPressure"),
  targetPurity: document.querySelector("#targetPurity"),
  maxPasses: document.querySelector("#maxPasses"),
  temperatureGrid: document.querySelector("#temperatureGrid"),
  pressureGrid: document.querySelector("#pressureGrid"),
  temperatureError: document.querySelector("#temperatureError"),
  pressureError: document.querySelector("#pressureError"),
  summaryStrip: document.querySelector("#summaryStrip"),
  diagramLegend: document.querySelector("#diagramLegend"),
  treeDiagram: document.querySelector("#treeDiagram"),
  stageCards: document.querySelector("#stageCards"),
  productTable: document.querySelector("#productTable"),
};

const pipeColors = {
  gas: "#c7952b",
  liquid: "#237c8f",
  residue: "#6e7780",
  solid: "#b94038",
};

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "n/a";
  }
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function pct(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "n/a";
  }
  return `${fmt(Number(value) * 100, digits)}%`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function selectedRadio(name) {
  const selected = document.querySelector(`input[name="${name}"]:checked`);
  return selected ? selected.value : "";
}

function numberValue(element, fallback) {
  const value = Number(element.value);
  return Number.isFinite(value) ? value : fallback;
}

async function loadMeta() {
  const response = await fetch("/api/meta");
  if (!response.ok) {
    throw new Error(`metadata ${response.status}`);
  }
  state.meta = await response.json();
  renderControls();
  await runPlan();
}

function renderControls() {
  els.presetSelect.innerHTML = state.meta.presets
    .map((preset) => `<option value="${escapeHtml(preset.name)}">${escapeHtml(preset.name)}</option>`)
    .join("");
  els.presetSelect.value = state.meta.defaults.preset;
  renderSubstanceList();
  renderCompositionRows();
}

function presetNames() {
  const preset = state.meta.presets.find((item) => item.name === els.presetSelect.value);
  return new Set(preset ? preset.substances : []);
}

function renderSubstanceList() {
  const selected = presetNames();
  els.substanceList.innerHTML = state.meta.substances
    .map((substance) => {
      const checked = selected.has(substance.name) ? "checked" : "";
      const disabledText = substance.phase_change_enabled ? "" : "terminal";
      return `
        <label class="substance-toggle">
          <input type="checkbox" class="substance-check" value="${escapeHtml(substance.name)}" ${checked} />
          <span>${escapeHtml(substance.name)} <span class="formula">${escapeHtml(substance.formula)}</span></span>
          <span class="formula">${disabledText}</span>
        </label>
      `;
    })
    .join("");
  document.querySelectorAll(".substance-check").forEach((checkbox) => {
    checkbox.addEventListener("change", renderCompositionRows);
  });
}

function selectedSubstances() {
  return [...document.querySelectorAll(".substance-check:checked")].map((checkbox) => checkbox.value);
}

function renderCompositionRows() {
  const selected = selectedSubstances();
  const equal = selected.length ? Math.round((100 / selected.length) * 1000) / 1000 : 0;
  const previous = new Map(
    [...document.querySelectorAll(".composition-input")].map((input) => [input.dataset.name, input.value])
  );
  els.compositionRows.innerHTML = selected
    .map((name) => {
      const value = previous.get(name) || String(equal);
      return `
        <label class="composition-row">
          <span>${escapeHtml(name)}</span>
          <input class="composition-input" data-name="${escapeHtml(name)}" type="number" min="0" step="0.1" value="${escapeHtml(value)}" />
        </label>
      `;
    })
    .join("");
}

function buildRequest() {
  const composition = {};
  document.querySelectorAll(".composition-input").forEach((input) => {
    composition[input.dataset.name] = numberValue(input, 0);
  });
  return {
    substances: selectedSubstances(),
    composition,
    total_moles: numberValue(els.totalMoles, 100),
    initial_temperature_kelvin: numberValue(els.initialTemperature, 293.15),
    initial_pressure_kpa: numberValue(els.initialPressure, 100),
    pressure_model: selectedRadio("pressureModel") || "total",
    maximum_pressure_kpa: numberValue(els.maximumPressure, 6000),
    temperature_error_kelvin: numberValue(els.temperatureError, 0.5),
    pressure_error_fraction: numberValue(els.pressureError, 1) / 100,
    target_purity: numberValue(els.targetPurity, 99.99) / 100,
    maximum_polishing_passes: Math.round(numberValue(els.maxPasses, 80)),
    temperature_grid: Math.round(numberValue(els.temperatureGrid, 16)),
    pressure_grid: Math.round(numberValue(els.pressureGrid, 16)),
    search_mode: selectedRadio("searchMode") || "greedy",
  };
}

async function runPlan() {
  if (state.running) {
    return;
  }
  state.running = true;
  els.runButton.disabled = true;
  els.runStatus.textContent = "Planning";

  try {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRequest()),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `plan ${response.status}`);
    }
    state.result = payload;
    els.runStatus.textContent = `Ready: ${payload.summary.product_count} products`;
    renderResult(payload);
  } catch (error) {
    els.runStatus.textContent = "Planner error";
    els.treeDiagram.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  } finally {
    state.running = false;
    els.runButton.disabled = false;
  }
}

function renderResult(result) {
  renderSummary(result.summary);
  renderLegend();
  renderTree(result);
  renderStages(result.stages);
  renderProducts(result.stages);
}

function renderSummary(summary) {
  const belowTarget = summary.products_below_target.length;
  els.summaryStrip.innerHTML = [
    metric("Products", summary.product_count),
    metric("Worst purity", pct(summary.worst_product_purity, 4), belowTarget ? "warning" : ""),
    metric("Heat", `${fmt(summary.cumulative_energy_kj, 1)} kJ`),
    metric("Product mol", fmt(summary.product_total_moles, 3)),
    metric("Solid risk", `${fmt(summary.solid_risk_total_moles, 4)} mol`, summary.solid_risk_total_moles > 0 ? "danger" : ""),
  ].join("");
}

function metric(label, value, tone = "") {
  return `
    <div class="metric ${tone}">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(value)}</div>
    </div>
  `;
}

function renderLegend() {
  els.diagramLegend.innerHTML = [
    ["Gas", pipeColors.gas],
    ["Liquid", pipeColors.liquid],
    ["Residue", pipeColors.residue],
    ["Solid risk", pipeColors.solid],
  ]
    .map(([label, color]) => `<span class="legend-item"><i class="legend-swatch" style="background:${color}"></i>${label}</span>`)
    .join("");
}

function pipeWidth(moles, total) {
  const fraction = total > 0 ? Math.max(0, Number(moles || 0)) / total : 0;
  return Math.max(4, Math.min(16, 4 + 18 * Math.sqrt(fraction)));
}

function renderTree(result) {
  const stages = result.stages;
  if (!stages.length) {
    els.treeDiagram.innerHTML = `<div class="empty-state">No product stages</div>`;
    return;
  }
  const width = 1120;
  const rowHeight = 166;
  const height = 120 + stages.length * rowHeight;
  const total = result.initial_stream.total_moles || 1;
  const stageX = 380;
  const productX = 840;
  const sourceX = 96;
  const riskX = 650;
  const boxW = 250;
  const boxH = 86;

  const parts = [];
  parts.push(`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Refining tree">`);
  parts.push(nodeBox(sourceX - 56, 32, 136, 58, "Feed", `${fmt(total, 3)} mol`, "#f8fbf9"));

  stages.forEach((stage, index) => {
    const y = 128 + index * rowHeight;
    const previousY = index === 0 ? 61 : 128 + (index - 1) * rowHeight + boxH / 2;
    const stageCenterY = y + boxH / 2;
    const branchColor = stage.product_branch === "liquid" ? pipeColors.liquid : pipeColors.gas;
    const residueWidth = pipeWidth(stage.residue_total_moles, total);
    const productWidth = pipeWidth(stage.product_total_moles, total);
    const stageLabel = `${fmt(stage.temperature_kelvin, 1)} K  ${fmt(stage.pressure_kpa, 0)} kPa`;

    parts.push(pipe(sourceX + 80, previousY, stageX, stageCenterY, pipeColors.residue, residueWidth));
    parts.push(pipeLabel((sourceX + stageX) / 2 - 20, stageCenterY - 14, `${fmt(stage.feed_total_moles, 2)} mol`));
    parts.push(nodeBox(stageX, y, boxW, boxH, `${pad(index + 1)} ${stage.target_name}`, stageLabel, "#ffffff"));
    parts.push(pressureChip(stageX + 142, y + 54, `${fmt(stage.pressure_kpa, 0)} kPa`));
    parts.push(pipe(stageX + boxW, stageCenterY, productX, stageCenterY - 42, branchColor, productWidth));
    parts.push(pipeLabel(stageX + boxW + 110, stageCenterY - 56, `${pct(stage.product_purity, 3)}  ${fmt(stage.product_total_moles, 2)} mol`));
    parts.push(nodeBox(productX, stageCenterY - 82, 208, 74, stage.target_name, `${stage.product_branch} product`, "#fbfffd"));

    if (stage.solid_risk_total_moles > 0.000001) {
      parts.push(pipe(stageX + boxW - 12, stageCenterY + 12, riskX, stageCenterY + 60, pipeColors.solid, pipeWidth(stage.solid_risk_total_moles, total)));
      parts.push(nodeBox(riskX, stageCenterY + 34, 172, 58, "Solid risk", `${fmt(stage.solid_risk_total_moles, 4)} mol`, "#fff8f6"));
    }

    if (index < stages.length - 1) {
      const nextY = 128 + (index + 1) * rowHeight + boxH / 2;
      parts.push(pipe(stageX + 54, y + boxH, sourceX + 80, nextY, pipeColors.residue, residueWidth));
      parts.push(pipeLabel(sourceX + 112, y + boxH + 44, `${fmt(stage.residue_total_moles, 2)} mol residue`));
    }
  });
  parts.push("</svg>");
  els.treeDiagram.innerHTML = parts.join("");
}

function nodeBox(x, y, w, h, title, subtitle, fill) {
  return `
    <rect class="node-box" x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" />
    <text class="node-title" x="${x + 16}" y="${y + 27}">${escapeHtml(title)}</text>
    <text class="node-subtitle" x="${x + 16}" y="${y + 50}">${escapeHtml(subtitle)}</text>
  `;
}

function pressureChip(x, y, text) {
  return `
    <rect class="pressure-chip" x="${x}" y="${y}" width="86" height="22" rx="11" />
    <text class="node-subtitle" x="${x + 43}" y="${y + 15}" text-anchor="middle">${escapeHtml(text)}</text>
  `;
}

function pipe(x1, y1, x2, y2, color, width) {
  const midX = (x1 + x2) / 2;
  return `<path class="pipe" d="M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" stroke="${color}" stroke-width="${width}" />`;
}

function pipeLabel(x, y, text) {
  return `<text class="pipe-label" x="${x}" y="${y}">${escapeHtml(text)}</text>`;
}

function renderStages(stages) {
  els.stageCards.innerHTML = stages
    .map((stage) => {
      const passBadge = stage.polishing_passes_needed === null
        ? `<span class="badge danger">target missed</span>`
        : `<span class="badge">${stage.polishing_passes_needed} pass</span>`;
      const riskBadge = stage.solid_risk_total_moles > 0.000001
        ? `<span class="badge warn">${fmt(stage.solid_risk_total_moles, 4)} mol solid</span>`
        : "";
      return `
        <article class="stage-card">
          <header>
            <h3>${pad(stage.stage_index)} ${escapeHtml(stage.target_name)}</h3>
            <div>${passBadge} ${riskBadge}</div>
          </header>
          <div class="stage-grid">
            ${smallMetric("Branch", stage.product_branch)}
            ${smallMetric("Temp", `${fmt(stage.temperature_kelvin, 2)} K`)}
            ${smallMetric("Pressure", `${fmt(stage.pressure_kpa, 1)} kPa`)}
            ${smallMetric("Purity", pct(stage.product_purity, 4))}
            ${smallMetric("Recovery", pct(stage.target_recovery, 4))}
            ${smallMetric("Product", `${fmt(stage.product_total_moles, 4)} mol`)}
            ${smallMetric("Residue", `${fmt(stage.residue_total_moles, 4)} mol`)}
            ${smallMetric("Heat", `${fmt(stage.estimated_heat_kj, 2)} kJ`)}
          </div>
        </article>
      `;
    })
    .join("");
}

function smallMetric(label, value) {
  return `<div class="small-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderProducts(stages) {
  const rows = stages
    .map((stage) => {
      const contaminants = stage.product_stream.composition
        .filter((item) => item.name !== stage.target_name && item.fraction > 0.0000001)
        .slice(0, 3)
        .map((item) => `${item.name} ${pct(item.fraction, 4)}`)
        .join(", ");
      const passes = stage.polishing_passes_needed === null ? "miss" : String(stage.polishing_passes_needed);
      return `
        <tr>
          <td>${escapeHtml(stage.target_name)}</td>
          <td>${escapeHtml(stage.product_branch)}</td>
          <td>${pct(stage.product_purity, 4)}</td>
          <td>${pct(stage.target_recovery, 4)}</td>
          <td>${escapeHtml(passes)}</td>
          <td>${escapeHtml(contaminants || "-")}</td>
        </tr>
      `;
    })
    .join("");
  els.productTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Product</th>
          <th>Branch</th>
          <th>Purity</th>
          <th>Recovery</th>
          <th>Passes</th>
          <th>Impurities</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

els.runButton.addEventListener("click", runPlan);
els.presetSelect.addEventListener("change", () => {
  renderSubstanceList();
  renderCompositionRows();
});

loadMeta().catch((error) => {
  els.runStatus.textContent = "Metadata error";
  els.treeDiagram.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
});
