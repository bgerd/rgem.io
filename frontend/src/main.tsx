// frontend/src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  // Note: React.StrictMode causes double rendering of components in dev mode
  //       which can affect components with side effects (e.g., WebSocket connections).
  // see: https://react.dev/reference/react/StrictMode
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
