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
function TerminalAsk({ agentName, question }: { agentName: string; question: string }) {
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
        <p>{question}</p>
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
  onReject,
}: {
  agentName: string;
  question: string;
  answerIn: "panel" | "terminal" | null;
  /** The agent's working folder: what a relative path in its output means. */
  baseDir: string;
  onSend: (text: string) => void;
  /** Focuses the steer bar's reply box, for when Reject needs a reason. */
  onReject: () => void;
}) {
  const terminalOwned = answerIn === "terminal";

  if (terminalOwned) return <TerminalAsk agentName={agentName} question={question} />;

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
        <div className="ask-actions">
          {/* Both go through the runner like any other reply; Reject moves you
              to the reply box, because "no" is rarely the whole answer. */}
          <button className="primary" onClick={() => onSend("Approved — go ahead.")}>
            Approve
          </button>
          <button onClick={onReject}>Reject</button>
          <span className="ask-hint">or answer below</span>
        </div>
      </div>
    </section>
  );
}
