import { DEFAULT_MODEL } from "./models.js";
import type { RoleId, UiMode } from "./schemas.js";

export interface RolePreset {
  id: RoleId;
  label: string;
  blurb: string;
  uiMode: UiMode;
  model: string;
  allowedTools: string[];
  permissionMode: "default" | "acceptEdits" | "plan" | "bypassPermissions";
  systemPrompt: string;
  /** visual props for the character */
  look: { prop: "keyboard" | "headset" | "glasses" | "clipboard" | "none"; color: string };
}

export const ROLE_PRESETS: Record<RoleId, RolePreset> = {
  coder: {
    id: "coder",
    label: "Coder",
    blurb: "Full tools, edits accepted inside the project.",
    uiMode: "terminal",
    model: DEFAULT_MODEL,
    allowedTools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob", "Agent"],
    permissionMode: "acceptEdits",
    systemPrompt: "",
    look: { prop: "keyboard", color: "#4aa3df" },
  },
  reviewer: {
    id: "reviewer",
    label: "Reviewer",
    blurb: "Read-only. Reviews and reports, never edits.",
    uiMode: "terminal",
    model: DEFAULT_MODEL,
    allowedTools: ["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)"],
    permissionMode: "plan",
    systemPrompt: "You are a code reviewer. Report findings; do not modify files.",
    look: { prop: "glasses", color: "#e07b7b" },
  },
  chat: {
    id: "chat",
    label: "Chat",
    blurb: "No tools. Plain conversation.",
    uiMode: "chat",
    model: DEFAULT_MODEL,
    allowedTools: [],
    permissionMode: "default",
    systemPrompt: "You are a helpful conversational assistant.",
    look: { prop: "headset", color: "#b48ede" },
  },
  assistant: {
    id: "assistant",
    label: "Assistant",
    blurb: "Files and web in a chosen folder. Chat interface.",
    uiMode: "chat",
    model: DEFAULT_MODEL,
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"],
    permissionMode: "acceptEdits",
    systemPrompt: "You help with documents and everyday tasks in the working folder.",
    look: { prop: "clipboard", color: "#f0a35e" },
  },
  custom: {
    id: "custom",
    label: "Custom",
    blurb: "Start from scratch.",
    uiMode: "terminal",
    model: DEFAULT_MODEL,
    allowedTools: [],
    permissionMode: "default",
    systemPrompt: "",
    look: { prop: "none", color: "#8fa3b0" },
  },
};

export const AGENT_COLORS = ["#4aa3df", "#e07b7b", "#b48ede", "#f0a35e", "#7bd88f", "#f2c14e", "#5ec8c0", "#d68fd6"];
