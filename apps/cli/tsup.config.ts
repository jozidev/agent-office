import { defineConfig } from "tsup";

// Single-file bundle so `npx agent-office` has no runtime deps besides Node.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  // Bundle every dependency except node-pty, which ships a native addon and
  // cannot be bundled into a single file (its .node binary is loaded via a
  // path relative to node-pty's own package, not the bundle).
  noExternal: [/^(?!node-pty$).+/],
  external: ["node-pty"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
