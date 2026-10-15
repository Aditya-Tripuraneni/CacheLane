import fs from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "packages/audit/src/cli.ts" },
  outDir: "packages/audit/dist",
  format: ["esm"],
  platform: "node",
  target: "node18",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  async onSuccess() {
    // The plugin runs this file directly with node; no npm install, no npx.
    fs.mkdirSync("plugin/bin", { recursive: true });
    fs.copyFileSync("packages/audit/dist/cli.js", "plugin/bin/cachelane-audit.mjs");
  },
});
