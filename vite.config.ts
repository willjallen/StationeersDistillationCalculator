import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web_src",
  base: "/",
  plugins: [react()],
  build: {
    outDir: "../src/stationeers_phase_sort/web_static",
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "[name].js",
        assetFileNames: (assetInfo) =>
          assetInfo.names.some((name) => name.endsWith(".css")) ? "app.css" : "[name][extname]",
      },
    },
  },
});
