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

export function AskCard({ agentName, question, onSend }: { agentName: string; question: string; onSend: (text: string) => void }) {
  const [reply, setReply] = useState("");
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // You opened this panel to answer, so put the cursor where the answer goes.
  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setReply("");
  };

  return (
    <section className="ask">
      <header>
        <span className="ask-dot" />
        {agentName} is asking
      </header>
      <div className="ask-body">
        <Markdown text={question} />
      </div>
      <div className="ask-reply">
        <textarea
          ref={boxRef}
          value={reply}
          placeholder="your answer — Enter to send, Shift+Enter for a new line"
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(reply);
            }
          }}
        />
        <div className="ask-actions">
          {/* Most asks are a plan waiting for a yes, so make that one click. */}
          <button onClick={() => send("Go ahead.")}>Go ahead</button>
          <button onClick={() => send("No — stop here.")}>Stop</button>
          <button className="primary" disabled={!reply.trim()} onClick={() => send(reply)}>
            Send
          </button>
        </div>
      </div>
    </section>
  );
}
