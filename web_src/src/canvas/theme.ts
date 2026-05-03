import type { EdgeTone, NodeTone } from "./types";

export const canvasTheme = {
  ink: "#121a2a",
  muted: "#5f6b7b",
  line: "#dfe6ee",
  grid: "#edf2f6",
  panel: "#ffffff",
  gas: "#d99300",
  liquid: "#0b8c9b",
  recycle: "#7a8795",
  solid: "#df2525",
  teal: "#0b8582",
  blue: "#237fe8",
  node: {
    feed: { fill: "#fbfdfe", stroke: "#d8e4ea", accent: "#7ba7ad" },
    equipment: { fill: "#ffffff", stroke: "#dce5ec", accent: "#1882a3" },
    separator: { fill: "#fafdff", stroke: "#8ccbd0", accent: "#0b8c9b" },
    gas: { fill: "#fffaf1", stroke: "#efb047", accent: "#d99300" },
    liquid: { fill: "#f3fcfd", stroke: "#89d3da", accent: "#0b8c9b" },
    risk: { fill: "#fff8f8", stroke: "#ff9f9f", accent: "#df2525" },
    recycle: { fill: "#fbfdff", stroke: "#dce5ec", accent: "#0b8582" },
  } satisfies Record<NodeTone, { fill: string; stroke: string; accent: string }>,
  edge: {
    gas: "#d99300",
    liquid: "#0b8c9b",
    recycle: "#7a8795",
    solid: "#df2525",
  } satisfies Record<EdgeTone, string>,
};
