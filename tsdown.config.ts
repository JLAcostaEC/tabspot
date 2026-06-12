import { defineConfig } from "tsdown/config";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: "esm",
  target: "esnext",
  dts: true,
  publint: true,
  // Unbundle mode: emit one file per source module instead of a single bundle.
  unbundle: true,
  // Keep plain .js / .d.ts extensions (the package is already "type": "module"),
  // so output paths stay dist/src/index.js — matching package.json main/exports.
  fixedExtension: false,
});
