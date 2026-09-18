import { useState } from "react";
import { ROLE_PRESETS, type RoleId } from "@agent-office/shared";
import { useOffice } from "../store";

const NAMES = ["Ada", "Rex", "Mia", "Bo", "Kai", "Nia", "Otto", "Zed", "Lu", "Ivy", "Max", "Uma"];

export function HireModal() {
  const open = useOffice((s) => s.hireOpen);
  if (!open) return null;
  return <HireForm />;
}

/** Mounted fresh each time the modal opens, so defaults reflect current agents. */
function HireForm() {
  const setOpen = useOffice((s) => s.setHireOpen);
  const send = useOffice((s) => s.send);
  const agents = useOffice((s) => s.agents);
  const taken = new Set(Object.values(agents).map((a) => a.name));
  const [name, setName] = useState(() => NAMES.find((n) => !taken.has(n)) ?? `Agent ${taken.size + 1}`);
  const [role, setRole] = useState<RoleId>("coder");
  const [cwd, setCwd] = useState("~/code/project");
  const [prompt, setPrompt] = useState("");
  const preset = ROLE_PRESETS[role];

  return (
    <div className="modal-bg" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Hire an agent</h3>
        <label>Role</label>
        <div className="roles">
          {(Object.keys(ROLE_PRESETS) as RoleId[]).map((r) => (
            <button key={r} className={r === role ? "sel" : ""} onClick={() => setRole(r)}>
              {ROLE_PRESETS[r].label}
              <small>{ROLE_PRESETS[r].blurb}</small>
            </button>
          ))}
        </div>
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <label>Working folder</label>
        <input value={cwd} onChange={(e) => setCwd(e.target.value)} />
        <label>Extra instructions (optional)</label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={preset.systemPrompt || "..."} />
        <div className="actions">
          <button onClick={() => setOpen(false)}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              send({ type: "agent.hire", payload: { name, role, cwd, ...(prompt && { systemPrompt: prompt }) } });
              setOpen(false);
            }}
          >
            Hire
          </button>
        </div>
      </div>
    </div>
  );
}
