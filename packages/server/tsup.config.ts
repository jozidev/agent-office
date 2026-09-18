import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts", "src/main.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: true,
  noExternal: ["@agent-office/shared"],
});
