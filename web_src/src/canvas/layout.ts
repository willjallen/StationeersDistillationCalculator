import { numberText, percentText, shortName } from "../format";
import type { PlanPayload, Stage } from "../types";
import type { CanvasScene, EdgeTone, Point, Rect, SceneEdge, SceneNode } from "./types";

const DESIGN_W = 1000;
const DESIGN_H = 690;

export function buildPlanScene(
  plan: PlanPayload | null,
  viewport: { width: number; height: number },
  selectedStageIndex: number | null,
): CanvasScene {
  const project = makeProjector(viewport.width, viewport.height);
  if (!plan || plan.stages.length === 0) {
    return {
      width: viewport.width,
      height: viewport.height,
      scale: project.scale,
      nodes: [],
      edges: [],
      stages: [],
      emptyMessage: "Run a plan to draw the separator network",
    };
  }

  const stages = plan.stages.slice(0, 7);
  const selected =
    stages.find((stage) => stage.stage_index === selectedStageIndex) ??
    stages[2] ??
    stages[0];
  const gasProducts = stages.filter((stage) => stage.product_branch === "gas");
  const liquidProducts = stages.filter((stage) => stage.product_branch === "liquid");
  const secondary = liquidProducts.find((stage) => stage.stage_index !== selected.stage_index) ?? stages[3] ?? stages[1] ?? selected;
  const gasResidue = gasProducts[0] ?? stages[0] ?? selected;
  const waterProduct = liquidProducts[0] ?? stages[0] ?? selected;
  const liquidGroupStages = (liquidProducts.length ? liquidProducts : stages).slice(0, 3);
  const polishingProducts = (gasProducts.length >= 3 ? gasProducts : stages).slice(0, 3);
  const total = Math.max(plan.initial_stream.total_moles || 1, 1);

  const feed = project.rect(18, 278, 88, 88);
  const compressor = project.rect(170, 292, 142, 66);
  const cooler = project.rect(336, 292, 124, 66);
  const mainSeparator = project.rect(510, 274, 136, 82);
  const recycle = project.rect(315, 110, 132, 66);
  const valveTop = project.rect(663, 86, 140, 74);
  const heater = project.rect(854, 92, 112, 68);
  const gasResidueNode = project.rect(864, 190, 118, 74);
  const secondarySeparator = project.rect(665, 330, 128, 70);
  const water = project.rect(860, 326, 122, 70);
  const coolerLow = project.rect(665, 462, 112, 68);
  const liquidProduct = project.rect(814, 444, 168, 126);
  const solidRisk = project.rect(676, 585, 132, 62);
  const valveLow = project.rect(496, 518, 146, 68);
  const hydrogen = project.rect(250, 528, 124, 66);
  const methane = project.rect(346, 624, 124, 62);
  const nitrogen = project.rect(552, 624, 124, 62);

  const nodes: SceneNode[] = [
    {
      id: "feed",
      rect: feed,
      tone: "feed",
      icon: "feed",
      title: "Feed",
      subtitle: `${numberText(plan.initial_stream.total_moles, 0)} mol`,
      lines: [
        `${numberText(plan.initial_stream.temperature_kelvin, 0)} K`,
        `${numberText(plan.initial_stream.pressure_kpa, 0)} kPa`,
      ],
    },
    {
      id: "compressor",
      rect: compressor,
      tone: "equipment",
      icon: "compressor",
      title: "01 Compressor",
      subtitle: `${numberText(plan.initial_stream.temperature_kelvin, 0)} K -> ${numberText(selected.pressure_kpa, 0)} kPa`,
    },
    {
      id: "cooler",
      rect: cooler,
      tone: "equipment",
      icon: "cooler",
      title: "02 Cooler",
      subtitle: `${numberText(selected.temperature_kelvin, 0)} K`,
      lines: [`${numberText(selected.pressure_kpa, 0)} kPa`],
    },
    {
      id: "main-separator",
      rect: mainSeparator,
      tone: "separator",
      icon: "separator",
      title: `${pad(selected.stage_index)} Separator`,
      subtitle: `${numberText(selected.temperature_kelvin, 0)} K`,
      lines: [`${numberText(selected.pressure_kpa, 0)} kPa`],
      badge: `Stage ${selected.stage_index}`,
      selected: true,
      stageIndex: selected.stage_index,
    },
    {
      id: "recycle",
      rect: recycle,
      tone: "recycle",
      icon: "recycle",
      title: "08 Recycle",
      subtitle: `${numberText(selected.pressure_kpa, 0)} kPa`,
      lines: [`${numberText(selected.residue_total_moles, 1)} mol`],
    },
    {
      id: "valve-top",
      rect: valveTop,
      tone: "equipment",
      icon: "valve",
      title: "04 Expansion Valve",
      subtitle: `${numberText(selected.product_total_moles, 1)} mol`,
      lines: [`${numberText(selected.pressure_kpa, 0)} -> ${numberText(gasResidue.pressure_kpa, 0)} kPa`],
      stageIndex: gasResidue.stage_index,
    },
    {
      id: "heater",
      rect: heater,
      tone: "equipment",
      icon: "heater",
      title: "05 Heater",
      subtitle: `${numberText(gasResidue.temperature_kelvin, 0)} K`,
      lines: [`${numberText(gasResidue.pressure_kpa, 0)} kPa`],
    },
    {
      id: "gas-residue",
      rect: gasResidueNode,
      tone: "gas",
      icon: "flame",
      title: "Gas Residue",
      subtitle: `${numberText(gasResidue.product_total_moles, 1)} mol`,
      lines: [`${percentText(gasResidue.product_purity, 0)} purity`],
      stageIndex: gasResidue.stage_index,
    },
    {
      id: "secondary-separator",
      rect: secondarySeparator,
      tone: "separator",
      icon: "separator",
      title: `${pad(secondary.stage_index)} Separator`,
      subtitle: `${numberText(secondary.temperature_kelvin, 0)} K`,
      lines: [`${numberText(secondary.pressure_kpa, 0)} kPa`],
      stageIndex: secondary.stage_index,
      selected: secondary.stage_index === selectedStageIndex,
    },
    {
      id: "water",
      rect: water,
      tone: "liquid",
      icon: "droplet",
      title: shortName(waterProduct.target_name),
      subtitle: `${numberText(waterProduct.product_total_moles, 1)} mol`,
      lines: [`${percentText(waterProduct.product_purity, 0)} purity`],
      stageIndex: waterProduct.stage_index,
    },
    {
      id: "cooler-low",
      rect: coolerLow,
      tone: "equipment",
      icon: "cooler",
      title: "07 Cooler",
      subtitle: `${numberText(secondary.temperature_kelvin, 0)} K`,
      lines: [`${numberText(secondary.pressure_kpa, 0)} kPa`],
    },
    {
      id: "liquid-product",
      rect: liquidProduct,
      tone: "liquid",
      icon: "stack",
      title: "Liquid Product",
      rows: liquidGroupStages.map((stage) => ({
        label: shortName(stage.target_name),
        value: `${numberText(stage.product_total_moles, 1)} mol`,
        tone: "liquid" as const,
      })),
      lines: ["All 100% purity"],
      stageIndex: liquidGroupStages[0]?.stage_index,
    },
    {
      id: "solid-risk",
      rect: solidRisk,
      tone: "risk",
      icon: "risk",
      title: "Solid Risk",
      subtitle:
        plan.summary.solid_risk_total_moles > 0
          ? `${numberText(plan.summary.solid_risk_total_moles, 3)} mol`
          : "No solids predicted",
    },
    {
      id: "valve-low",
      rect: valveLow,
      tone: "equipment",
      icon: "valve",
      title: "09 Expansion Valve",
      subtitle: `${numberText(selected.pressure_kpa, 0)} -> ${numberText(polishingProducts[0]?.pressure_kpa, 0)} kPa`,
    },
    productNode("hydrogen", hydrogen, polishingProducts[0], "gas"),
    productNode("methane", methane, polishingProducts[1], "gas"),
    productNode("nitrogen", nitrogen, polishingProducts[2], "gas"),
  ].filter(Boolean) as SceneNode[];

  const edges: SceneEdge[] = [
    edge("feed-compressor", "gas", [
      port(feed, "right"),
      { x: project.x(146), y: centerY(feed) },
      { x: project.x(146), y: centerY(compressor) },
      port(compressor, "left"),
    ], selected.feed_total_moles, total, `${numberText(selected.feed_total_moles, 1)} mol`, project.point(128, 300)),
    edge("compressor-cooler", "gas", [port(compressor, "right"), port(cooler, "left")], selected.feed_total_moles, total),
    edge("cooler-main", "gas", [port(cooler, "right"), port(mainSeparator, "left")], selected.feed_total_moles, total),
    edge("main-to-recycle", "recycle", [
      port(mainSeparator, "top", -40),
      { x: centerX(mainSeparator), y: project.y(194) },
      project.point(468, 194),
      port(recycle, "right"),
    ], selected.residue_total_moles, total),
    edge("recycle-to-compressor", "recycle", [
      port(recycle, "left"),
      { x: project.x(160), y: centerY(recycle) },
      { x: project.x(160), y: centerY(compressor) },
      port(compressor, "left", -22),
    ], selected.residue_total_moles, total, `${numberText(selected.residue_total_moles, 1)} mol`, project.point(210, 205)),
    edge("main-to-valve-top", "gas", [
      port(mainSeparator, "right", -20),
      { x: project.x(635), y: centerY(mainSeparator) - project.scale * 20 },
      { x: project.x(635), y: centerY(valveTop) },
      port(valveTop, "left"),
    ], selected.product_total_moles, total, `${numberText(selected.product_total_moles, 1)} mol`, project.point(654, 234)),
    edge("valve-to-heater", "gas", [port(valveTop, "right"), port(heater, "left")], gasResidue.product_total_moles, total),
    edge("heater-to-residue", "gas", [
      port(heater, "right"),
      { x: project.x(982), y: centerY(heater) },
      { x: project.x(982), y: centerY(gasResidueNode) },
      port(gasResidueNode, "right"),
    ], gasResidue.product_total_moles, total),
    edge("main-to-secondary", "liquid", [
      port(mainSeparator, "right", 22),
      port(secondarySeparator, "left"),
    ], secondary.feed_total_moles, total, `${numberText(secondary.feed_total_moles, 1)} mol`, project.point(708, 346)),
    edge("secondary-to-water", "liquid", [port(secondarySeparator, "right"), port(water, "left")], waterProduct.product_total_moles, total),
    edge("secondary-to-cooler-low", "liquid", [
      port(secondarySeparator, "bottom"),
      { x: centerX(secondarySeparator), y: project.y(432) },
      port(coolerLow, "top"),
    ], secondary.residue_total_moles, total, `${numberText(secondary.residue_total_moles, 1)} mol`, project.point(686, 423)),
    edge("cooler-low-to-liquid-product", "liquid", [port(coolerLow, "right"), port(liquidProduct, "left")], liquidGroupStages[0]?.product_total_moles ?? secondary.residue_total_moles, total),
    edge("solid-risk", "solid", [
      port(coolerLow, "bottom"),
      { x: centerX(coolerLow), y: project.y(565) },
      port(solidRisk, "top"),
    ], plan.summary.solid_risk_total_moles, total, `${numberText(plan.summary.solid_risk_total_moles, 0)} mol`, project.point(694, 555)),
    edge("main-to-valve-low", "gas", [
      port(mainSeparator, "bottom"),
      { x: centerX(mainSeparator), y: project.y(492) },
      { x: centerX(valveLow), y: project.y(492) },
      port(valveLow, "top"),
    ], selected.residue_total_moles, total, `${numberText(selected.residue_total_moles, 1)} mol`, project.point(510, 454)),
    edge("valve-low-to-hydrogen", "gas", [
      port(valveLow, "left"),
      { x: project.x(444), y: centerY(valveLow) },
      { x: project.x(444), y: centerY(hydrogen) },
      port(hydrogen, "right"),
    ], polishingProducts[0]?.product_total_moles ?? selected.product_total_moles, total),
    edge("valve-low-to-methane", "gas", [
      port(valveLow, "bottom", -28),
      project.point(558, 612),
      project.point(502, 612),
      { x: project.x(502), y: centerY(methane) },
      port(methane, "right"),
    ], polishingProducts[1]?.product_total_moles ?? selected.product_total_moles, total),
    edge("valve-low-to-nitrogen", "gas", [
      port(valveLow, "bottom", 28),
      project.point(590, 612),
      { x: project.x(590), y: centerY(nitrogen) },
      port(nitrogen, "left"),
    ], polishingProducts[2]?.product_total_moles ?? selected.product_total_moles, total),
  ];

  return {
    width: viewport.width,
    height: viewport.height,
    scale: project.scale,
    nodes,
    edges,
    stages,
  };
}

function productNode(id: string, rect: Rect, stage: Stage | undefined, tone: "gas" | "liquid"): SceneNode | null {
  if (!stage) {
    return null;
  }
  return {
    id,
    rect,
    tone,
    icon: tone === "gas" ? "flame" : "droplet",
    title: shortName(stage.target_name),
    subtitle: `${numberText(stage.product_total_moles, 1)} mol`,
    lines: [`${percentText(stage.product_purity, 0)} purity`],
    stageIndex: stage.stage_index,
  };
}

function edge(
  id: string,
  tone: EdgeTone,
  points: Point[],
  moles: number,
  total: number,
  label?: string,
  labelPoint?: Point,
): SceneEdge {
  return {
    id,
    tone,
    points,
    width: pipeWidth(moles, total),
    label,
    labelPoint,
    arrow: true,
  };
}

function makeProjector(width: number, height: number) {
  const scale = Math.min(width / DESIGN_W, height / DESIGN_H);
  const offsetX = (width - DESIGN_W * scale) / 2;
  const offsetY = (height - DESIGN_H * scale) / 2;
  return {
    scale,
    x: (value: number) => offsetX + value * scale,
    y: (value: number) => offsetY + value * scale,
    point: (x: number, y: number): Point => ({
      x: offsetX + x * scale,
      y: offsetY + y * scale,
    }),
    rect: (x: number, y: number, w: number, h: number): Rect => ({
      x: offsetX + x * scale,
      y: offsetY + y * scale,
      w: w * scale,
      h: h * scale,
    }),
  };
}

function port(rect: Rect, side: "left" | "right" | "top" | "bottom", offset = 0): Point {
  if (side === "left") {
    return { x: rect.x, y: rect.y + rect.h / 2 + offset };
  }
  if (side === "right") {
    return { x: rect.x + rect.w, y: rect.y + rect.h / 2 + offset };
  }
  if (side === "top") {
    return { x: rect.x + rect.w / 2 + offset, y: rect.y };
  }
  return { x: rect.x + rect.w / 2 + offset, y: rect.y + rect.h };
}

function centerX(rect: Rect) {
  return rect.x + rect.w / 2;
}

function centerY(rect: Rect) {
  return rect.y + rect.h / 2;
}

function pipeWidth(moles: number, total: number) {
  const fraction = Math.max(0, moles || 0) / Math.max(total, 1);
  return clamp(2.8 + 9 * Math.sqrt(fraction), 3, 12);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
