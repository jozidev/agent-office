import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { StandaloneTerminal } from "./ui/StandaloneTerminal";
import { connect } from "./store";
import "./styles.css";

// No router: the server falls back to index.html for unknown paths, and the
// only second page is the popped-out terminal window.
const terminalMatch = /^\/terminal\/([^/]+)/.exec(location.pathname);

if (!terminalMatch) connect();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{terminalMatch ? <StandaloneTerminal agentId={terminalMatch[1]!} /> : <App />}</React.StrictMode>,
);
