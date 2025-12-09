// frontend/src/apps/main/index.tsx
import React from "react";
import { Routes, Route, Link } from "react-router-dom";
import { API_BASE_URL } from "../../lib/config";

function MainHome() {
  return (
    <div>
      <h2>Main App</h2>
      <p>
        This is the primary UI. It can talk to your REST backend at:
      </p>
      <pre>{API_BASE_URL || "(API base URL not configured)"}</pre>

      <p style={{ marginTop: "1rem" }}>
        Example next steps:
      </p>
      <ul>
        <li>Show live RGEM Pad grid states</li>
        <li>Provide controls for sending commands via REST</li>
        <li>Link to protocol debug sessions</li>
      </ul>

      <p style={{ marginTop: "1rem" }}>
        Try the debug console: <Link to="/debug">Go to Debug App</Link>
      </p>
    </div>
  );
}

export default function MainApp() {
  return (
    <Routes>
      <Route path="/" element={<MainHome />} />
      {/* you can add more nested routes here, e.g. /main/settings */}
    </Routes>
  );
}
