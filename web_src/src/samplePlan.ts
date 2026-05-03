import type { PlanPayload, Stage, Stream } from "./types";

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
  stages: [
    stage(1, "Water", "liquid", 11.1, 88.9, 294, 200, 42),
    stage(2, "Carbon Dioxide", "liquid", 33.3, 55.6, 294, 200, 86),
    stage(3, "Hydrogen", "gas", 16.7, 83.3, 294, 600, 122),
    stage(4, "Methane", "gas", 20, 63.3, 157, 50, 98),
    stage(5, "Nitrogen", "gas", 20.3, 43, 139, 491, 108),
    stage(6, "Nitrous Oxide", "liquid", 16.7, 26.3, 270, 200, 71),
    stage(7, "Pollutant", "liquid", 12.2, 14.1, 270, 200, 54),
  ],
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
    operation_kind: "separator",
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
    polishing_passes_needed: index === 3 ? 1 : index % 2 === 0 ? 2 : 1,
    polishing_final_purity: 1,
    polishing_final_yield: 1,
    hazards: [],
    product_stream: stream(product, target, temperature, pressure),
    residue_stream: stream(residue, "Residue", temperature, pressure),
    solid_risk_by_name: [],
  };
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
