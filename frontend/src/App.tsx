// frontend/src/App.tsx
import React, { Suspense, lazy } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Link,
} from "react-router-dom";

// Lazy-load sub-apps (keeps bundles smaller)
const MainApp = lazy(() => import("./apps/main"));
const DebugApp = lazy(() => import("./apps/debug"));

function Layout({ children }: { children: React.ReactNode }) {
  // Very basic shared layout/header
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <header style={{ marginBottom: "1rem" }}>
        <h1 style={{ marginBottom: "0.5rem" }}>RGEM Pad Console</h1>
        <nav style={{ display: "flex", gap: "1rem" }}>
          <Link to="/main">Main</Link>
          <Link to="/debug">Debug</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Suspense fallback={<div>Loading…</div>}>
          <Routes>
            {/* Redirect root → /main */}
            <Route path="/" element={<Navigate to="/main" replace />} />

            {/* Main app */}
            <Route path="/main/*" element={<MainApp />} />

            {/* Debug app */}
            <Route path="/debug/*" element={<DebugApp />} />

            {/* Catch-all: go back to /main */}
            <Route path="*" element={<Navigate to="/main" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  );
}
