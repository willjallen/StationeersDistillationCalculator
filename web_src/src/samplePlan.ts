import type { PlanPayload, Stage, Stream } from "./types";

const stages = [
  stage(1, "Water", "liquid", 11.1, 88.9, 294, 200, 42),
  stage(2, "Carbon Dioxide", "liquid", 33.3, 55.6, 294, 200, 86),
  stage(3, "Hydrogen", "gas", 16.7, 83.3, 294, 600, 0),
  stage(4, "Methane", "gas", 20, 63.3, 157, 50, 98),
  stage(5, "Nitrogen", "gas", 20.3, 43, 139, 491, 108),
  stage(6, "Nitrous Oxide", "liquid", 16.7, 26.3, 270, 200, 71),
  stage(7, "Pollutant", "liquid", 12.2, 14.1, 270, 200, 54),
];

export const samplePlan: PlanPayload = {
  request: {},
  initial_stream: stream(100, "Feed", 294.39, 100),
  summary: {
    product_count: 6,
    worst_product_purity: 1,
    cumulative_score: 0,
    cumulative_energy_kj: 581.4,
    cumulative_setpoint_cost: 0.3,
    input_total_moles: 100,
    product_total_moles: 100,
    solid_risk_total_moles: 0,
    solid_risk_fraction: 0,
    solid_risk_by_name: [],
    products_below_target: [],
    remaining_targets: [],
  },
  stages,
  graph: graphFromStages(stages),
};

function stage(
  index: number,
  target: string,
  branch: "gas" | "liquid",
  product: number,
  residue: number,
  temperature: number,
  pressure: number,
  heat: number,
): Stage {
  const feed = product + residue;
  return {
    stage_index: index,
    target_name: target,
    product_branch: branch,
    operation_kind: branch === "liquid" ? "condense" : "evaporate",
    temperature_kelvin: temperature,
    temperature_celsius: temperature - 273.15,
    pressure_kpa: pressure,
    product_purity: 1,
    target_recovery: 1,
    target_loss_to_residue: 0,
    feed_total_moles: feed,
    product_total_moles: product,
    residue_total_moles: residue,
    solid_risk_total_moles: 0,
    estimated_heat_kj: heat,
    setpoint_cost: pressure / 2000,
    limiting_impurity_name: null,
    polishing_passes_needed: passesFor(index),
    polishing_final_purity: 1,
    polishing_final_yield: 1,
    hazards: [],
    product_stream: stream(product, target, temperature, pressure),
    residue_stream: stream(residue, "Residue", temperature, pressure),
    solid_risk_by_name: [],
  };
}

function graphFromStages(items: Stage[]): PlanPayload["graph"] {
  const nodes: PlanPayload["graph"]["nodes"] = [{ node_id: "source", node_kind: "source", parameters: {} }];
  const edges: PlanPayload["graph"]["edges"] = [];
  let previous = "source";
  items.forEach((item) => {
    const stageId = `stage_${String(item.stage_index).padStart(2, "0")}`;
    const operationKind = item.product_branch === "liquid" ? "condensation_valve" : "evaporation_heater";
    const operationId = `${operationKind}_${String(item.stage_index).padStart(2, "0")}`;
    const productId = `product_${item.target_name.toLowerCase().replaceAll(" ", "_")}`;
    const residueId = `residue_${String(item.stage_index).padStart(2, "0")}`;
    const feed = stream(item.feed_total_moles, "Feed", item.temperature_kelvin, item.pressure_kpa);
    nodes.push({
      node_id: operationId,
      node_kind: operationKind,
      parameters: {
        stage_index: item.stage_index,
        target_substance: item.target_name,
        operation_kind: item.operation_kind,
        selected_branch: item.product_branch,
        output_temperature_kelvin: item.temperature_kelvin,
        output_pressure_kpa: item.pressure_kpa,
      },
    });
    nodes.push({
      node_id: stageId,
      node_kind: "phase_splitter",
      parameters: {
        stage_index: item.stage_index,
        target_substance: item.target_name,
        operation_kind: item.operation_kind,
        selected_branch: item.product_branch,
        temperature_kelvin: item.temperature_kelvin,
        pressure_kpa: item.pressure_kpa,
      },
    });
    nodes.push({
      node_id: productId,
      node_kind: "product_storage",
      parameters: {
        stage_index: item.stage_index,
        substance: item.target_name,
        selected_branch: item.product_branch,
        product_total_moles: item.product_total_moles,
        product_purity: item.product_purity,
      },
    });
    edges.push({ source_node_id: previous, destination_node_id: operationId, stream: feed });
    edges.push({ source_node_id: operationId, destination_node_id: stageId, stream: feed });
    edges.push({ source_node_id: stageId, destination_node_id: productId, stream: item.product_stream });
    if (item.residue_total_moles > 0) {
      nodes.push({
        node_id: residueId,
        node_kind: "residue",
        parameters: {
          stage_index: item.stage_index,
          residue_total_moles: item.residue_total_moles,
          temperature_kelvin: item.residue_stream.temperature_kelvin,
          pressure_kpa: item.residue_stream.pressure_kpa,
        },
      });
      edges.push({ source_node_id: stageId, destination_node_id: residueId, stream: item.residue_stream });
      previous = residueId;
    }
  });
  return { nodes, edges };
}

function passesFor(index: number) {
  return ({ 1: 1, 2: 1, 3: 1, 4: 2, 5: 1, 6: 2, 7: 1 } as Record<number, number>)[index] ?? 1;
}

function stream(total: number, name: string, temperature: number, pressure: number): Stream {
  return {
    phase_hint: "mixed",
    temperature_kelvin: temperature,
    pressure_kpa: pressure,
    total_moles: total,
    composition: [{ name, moles: total, fraction: 1 }],
  };
}
