import { Html } from "@react-three/drei";
import type { Subagent } from "@agent-office/shared";

const TYPE_COLORS: Record<string, string> = {
  Explore: "#5ec8c0",
  Plan: "#b48ede",
  "general-purpose": "#4aa3df",
};

const MAX_TILES = 3;

/** A "video call" above the agent: one tile per live subagent. */
export function CallBubble({ subagents }: { subagents: Subagent[] }) {
  const shown = subagents.slice(0, MAX_TILES);
  const extra = subagents.length - shown.length;
  return (
    <Html position={[0, 2.1, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: 4,
          background: "#12141a",
          border: "1px solid #3a4050",
          borderRadius: 8,
          boxShadow: "0 4px 12px rgba(0,0,0,.5)",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {shown.map((s) => (
          <div
            key={s.id}
            style={{
              width: 54,
              height: 44,
              background: "#1f2330",
              borderRadius: 4,
              border: `1px solid ${TYPE_COLORS[s.type] ?? "#8fa3b0"}`,
              position: "relative",
              overflow: "hidden",
            }}
            title={s.description}
          >
            <div
              style={{
                position: "absolute",
                left: 19,
                top: 6,
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: TYPE_COLORS[s.type] ?? "#8fa3b0",
              }}
            />
            <div style={{ position: "absolute", left: 14, top: 22, width: 26, height: 14, borderRadius: "6px 6px 0 0", background: "#3a4050" }} />
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                fontSize: 8,
                color: "#cfd5dd",
                background: "rgba(0,0,0,.55)",
                padding: "1px 3px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {s.metrics.lastToolName ?? s.type}
            </div>
            <div
              style={{
                position: "absolute",
                top: 3,
                right: 3,
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: s.status === "tool_use" ? "#7bd88f" : "#f2c14e",
              }}
            />
          </div>
        ))}
        {extra > 0 && (
          <div
            style={{
              width: 34,
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#9aa3ad",
              fontSize: 11,
              background: "#1f2330",
              borderRadius: 4,
            }}
          >
            +{extra}
          </div>
        )}
      </div>
      <div
        style={{
          width: 0,
          height: 0,
          margin: "0 auto",
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderTop: "6px solid #3a4050",
        }}
      />
    </Html>
  );
}
