// frontend/src/apps/debug/WsConsole.tsx
import React, { useEffect, useRef, useState } from "react";
import { WS_URL } from "../../lib/config";

type LogEntry = {
  direction: "in" | "out" | "info" | "error";
  message: string;
};

export function WsConsole() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  // Append a log entry
  const pushLog = (entry: LogEntry) =>
    setLog((prev) => [...prev, entry]);

  // Setup WebSocket connection when component mounts
  // Note: When running in StrictMode (per main.tsx), this effect runs twice in dev!!!
  useEffect(() => {
    if (!WS_URL) {
      pushLog({
        direction: "error",
        message: "WS_URL is not configured.",
      });
      return;
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      pushLog({
        direction: "info",
        message: `Connected to ${WS_URL}`,
      });
    };

    ws.onmessage = (event) => {
      pushLog({
        direction: "in",
        message: event.data,
      });
    };

    ws.onerror = () => {
      pushLog({
        direction: "error",
        message: "WebSocket error occurred.",
      });
    };

    ws.onclose = (event) => {
      pushLog({
        direction: "info",
        message: `Disconnected (code=${event.code})`,
      });
    };

    // Cleanup on unmount
    return () => {
      ws.close();
    };
  }, []);

  const send = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pushLog({
        direction: "error",
        message: "Cannot send: socket not open.",
      });
      return;
    }
    if (!input.trim()) return;

    ws.send(input);
    pushLog({
      direction: "out",
      message: input,
    });
    setInput("");
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (
    e
  ) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div>
      <h3>WebSocket Console</h3>
      <p>
        Connected to: <code>{WS_URL || "(not set)"}</code>
      </p>

      <div style={{ marginBottom: "0.5rem" }}>
        <textarea
          readOnly
          rows={12}
          value={log
            .map((entry) => {
              const prefix =
                entry.direction === "in"
                  ? "< "
                  : entry.direction === "out"
                  ? "> "
                  : entry.direction === "error"
                  ? "! "
                  : "- ";
              return prefix + entry.message;
            })
            .join("\n")}
          style={{ width: "100%", fontFamily: "monospace" }}
        />
      </div>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          style={{ flex: 1 }}
          placeholder='Type raw message, e.g. {"type":"PING"}'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button onClick={send}>Send</button>
      </div>
    </div>
  );
}
