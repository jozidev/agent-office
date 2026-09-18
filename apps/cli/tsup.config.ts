import { defineConfig } from "tsup";

// Single-file bundle so `npx agent-office` has no runtime deps besides Node.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  // Bundle every dependency except the native addons: their .node binaries are
  // resolved relative to their own package, not the bundle. better-sqlite3 also
  // drags in `bindings`, whose __filename use cannot coexist with the top-level
  // await in this ESM bundle.
  noExternal: [/^(?!node-pty$|better-sqlite3$).+/],
  external: ["node-pty", "better-sqlite3"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
