// frontend/src/apps/debug/index.tsx
import React from "react";
import { Routes, Route } from "react-router-dom";
import { WsConsole } from "./WsConsole";

function DebugHome() {
  return (
    <div>
      <h2>Debug App</h2>
      <p>
        Use this console to send and inspect WebSocket messages
        to your backend.
      </p>
      <WsConsole />
    </div>
  );
}

export default function DebugApp() {
  return (
    <Routes>
      <Route path="/" element={<DebugHome />} />
      {/* Later you can add /debug/sessions, /debug/logs, etc. */}
    </Routes>
  );
}