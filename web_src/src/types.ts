export type Preset = {
  name: string;
  substances: string[];
};

export type Substance = {
  name: string;
  formula: string;
  phase_change_enabled: boolean;
  hazard_tags: string[];
};

export type MetaPayload = {
  presets: Preset[];
  substances: Substance[];
  defaults: Record<string, unknown>;
};

export type StreamComposition = {
  name: string;
  moles: number;
  fraction: number;
};

export type Stream = {
  phase_hint: string;
  temperature_kelvin: number | null;
  pressure_kpa: number | null;
  total_moles: number;
  composition: StreamComposition[];
};

export type Stage = {
  stage_index: number;
  target_name: string;
  product_branch: "gas" | "liquid";
  operation_kind: string;
  temperature_kelvin: number;
  temperature_celsius: number;
  pressure_kpa: number;
  product_purity: number;
  target_recovery: number;
  target_loss_to_residue: number;
  feed_total_moles: number;
  product_total_moles: number;
  residue_total_moles: number;
  solid_risk_total_moles: number;
  estimated_heat_kj: number;
  setpoint_cost: number;
  limiting_impurity_name: string | null;
  polishing_passes_needed: number | null;
  polishing_final_purity: number;
  polishing_final_yield: number;
  hazards: Array<{
    name: string;
    severity: string;
    reactants: string[];
    threshold_temperature_kelvin: number;
  }>;
  product_stream: Stream;
  residue_stream: Stream;
  solid_risk_by_name: Array<{ name: string; moles: number }>;
};

export type PlanSummary = {
  product_count: number;
  worst_product_purity: number;
  cumulative_score: number;
  cumulative_energy_kj: number;
  cumulative_setpoint_cost: number;
  input_total_moles: number;
  product_total_moles: number;
  solid_risk_total_moles: number;
  solid_risk_fraction: number;
  solid_risk_by_name: Array<{ name: string; moles: number }>;
  products_below_target: Array<{ name: string; final_purity: number }>;
  remaining_targets: string[];
};

export type GraphParameter = string | number | boolean | null;

export type ProcessGraphNode = {
  node_id: string;
  node_kind: string;
  parameters: Record<string, GraphParameter>;
};

export type ProcessGraphEdge = {
  source_node_id: string;
  destination_node_id: string;
  parameters: Record<string, GraphParameter>;
  stream: Stream | null;
};

export type ProcessGraph = {
  nodes: ProcessGraphNode[];
  edges: ProcessGraphEdge[];
};

export type PlanPayload = {
  request: Record<string, unknown>;
  initial_stream: Stream;
  summary: PlanSummary;
  stages: Stage[];
  graph: ProcessGraph;
};

export type PlanRequest = {
  preset: string;
  substances: string[];
  composition: Record<string, number>;
  total_moles: number;
  initial_temperature_kelvin: number;
  initial_pressure_kpa: number;
  pressure_model: "total" | "partial";
  maximum_pressure_kpa: number;
  temperature_error_kelvin: number;
  pressure_error_fraction: number;
  target_purity: number;
  maximum_polishing_passes: number;
  temperature_grid: number;
  pressure_grid: number;
  search_mode: "greedy" | "beam";
};
