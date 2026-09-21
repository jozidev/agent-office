import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";

/**
 * What an agent is waiting to hear, and the box to answer it in.
 *
 * This used to be the last log line in amber, truncated at 300 characters and
 * sitting under six rows of config — so the one thing you had to read was the
 * smallest, least readable element on the panel, and usually cut off
 * mid-sentence. Now it leads the panel and shows the whole thing.
 */

/**
 * An interactive terminal owns its own prompt — Claude Code is sitting there
 * with numbered options, and only keystrokes in that pty answer it. Offering a
 * reply box here would duplicate a prompt we cannot answer, and sending it
 * would start a second session against the same conversation. So point at the
 * terminal instead.
 */
function TerminalAsk({ agentName, question, baseDir }: { agentName: string; question: string; baseDir: string }) {
  const focusTerminal = () => {
    const host = document.querySelector(".terminal-panel");
    host?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    // xterm takes keystrokes through a hidden textarea; focusing it puts the
    // caret where the answer actually goes.
    (host?.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement | null)?.focus();
  };

  return (
    <section className="ask ask--terminal">
      <header>
        <span className="ask-dot" />
        {agentName} is waiting in the terminal
      </header>
      <div className="ask-body">
        {/* Usually one generic line, but a Notification can carry a whole
            report; it should read the same either way. */}
        <Markdown text={question} baseDir={baseDir} />
        <p className="ask-hint">Answer it in the terminal below — it is asking there, and only that session can hear you.</p>
      </div>
      <div className="ask-reply">
        <div className="ask-actions">
          <button className="primary" onClick={focusTerminal}>
            Go to terminal
          </button>
        </div>
      </div>
    </section>
  );
}

export function AskCard({
  agentName,
  question,
  answerIn,
  baseDir,
  onSend,
}: {
  agentName: string;
  question: string;
  answerIn: "panel" | "terminal" | null;
  /** The agent's working folder: what a relative path in its output means. */
  baseDir: string;
  onSend: (text: string) => void;
}) {
  const terminalOwned = answerIn === "terminal";
  const [reply, setReply] = useState("");
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setReply("");
  };

  if (terminalOwned) return <TerminalAsk agentName={agentName} question={question} baseDir={baseDir} />;

  return (
    <section className="ask">
      <header>
        <span className="ask-dot" />
        {agentName} is asking
      </header>
      <div className="ask-body">
        <Markdown text={question} baseDir={baseDir} />
      </div>
      <div className="ask-reply">
        {/* The box lives with the question it answers. Anywhere else it is a
            control that does nothing most of the time. */}
        <textarea
          ref={boxRef}
          value={reply}
          placeholder="or answer in your own words — Enter to send, Shift+Enter for a new line"
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(reply);
            }
          }}
        />
        <div className="ask-actions">
          {/* Both go through the runner like any other reply; Reject puts the
              cursor in the box, because "no" is rarely the whole answer. */}
          <button className="primary" onClick={() => send("Approved — go ahead.")}>
            Approve
          </button>
          <button onClick={() => boxRef.current?.focus()}>Reject</button>
          <button className="primary" disabled={!reply.trim()} onClick={() => send(reply)}>
            Send
          </button>
        </div>
      </div>
    </section>
  );
}
