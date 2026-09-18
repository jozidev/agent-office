import { defineConfig } from "tsup";

// Single-file bundle so `npx agent-office` has no runtime deps besides Node.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  noExternal: [/.*/],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
