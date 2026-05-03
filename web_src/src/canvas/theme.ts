import type { EdgeTone, NodeTone } from "./types";

export const canvasTheme = {
  ink: "#253044",
  muted: "#6f7a89",
  line: "#e7edf3",
  grid: "#f8fafc",
  panel: "#ffffff",
  gas: "#d18a00",
  liquid: "#118491",
  recycle: "#98a3af",
  solid: "#d43636",
  teal: "#168984",
  blue: "#237fe8",
  node: {
    feed: { fill: "#fcfdfe", stroke: "#e1e9ef", accent: "#7ba6ad" },
    equipment: { fill: "#ffffff", stroke: "#e5ebf1", accent: "#1b82a0" },
    separator: { fill: "#fcfeff", stroke: "#a6d7da", accent: "#118491" },
    gas: { fill: "#fffaf2", stroke: "#edc77f", accent: "#d18a00" },
    liquid: { fill: "#f8fdfe", stroke: "#b0dde0", accent: "#118491" },
    risk: { fill: "#fffafa", stroke: "#f4c0c0", accent: "#d43636" },
    recycle: { fill: "#fcfdff", stroke: "#e5ebf1", accent: "#168984" },
  } satisfies Record<NodeTone, { fill: string; stroke: string; accent: string }>,
  edge: {
    gas: "#d18a00",
    liquid: "#118491",
    recycle: "#98a3af",
    solid: "#d43636",
  } satisfies Record<EdgeTone, string>,
};
