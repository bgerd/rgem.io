import React, { useEffect, useRef, useState } from "react";
import { RGemGridPage } from "./components/RGemGridPage";
import { RGemSelectorModal } from "./components/RGemSelectorModal";
import { LoadingOverlay } from "./components/LoadingOverlay";
import type {
  AppMode,
  ConnectionStatus,
  GridState,
  RgbColor,
} from "./types/grid";
import { useWebSocket } from "./lib/WebSocketProvider";

// Hard-coded RGEM IDs for now.
const RGEM_IDS: string[] = ["default"];

// Convert a 16-bit gemState bitmask into a GridState.
function gemStateToGridState(gemState: number): GridState {
  const clamped = gemState & 0xffff; // ensure 16 bits
  const cells: GridState = [];

  for (let idx = 0; idx < 16; idx++) {
    const mask = 1 << idx;
    const isOn = (clamped & mask) !== 0;

    if (isOn) {
      cells.push({ r: 255, g: 0, b: 0 }); // on => red
    } else {
      cells.push({ r: 0, g: 0, b: 0 }); // off => black (displayed as light gray)
    }
  }

  return cells;
}

// Helper to create a default "all off" grid (gemState = 0).
function createDefaultGrid(): GridState {
  return gemStateToGridState(0);
}

export const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>("configuration");
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [selectedRgemId, setSelectedRgemId] = useState<string | null>(null);
  const [gridState, setGridState] = useState<GridState>(() =>
    createDefaultGrid()
  );

  const { sendJson, addMessageHandler, whenOpen } = useWebSocket();

  // Track the unsubscribe function for the current Update handler.
  const unsubscribeUpdateHandlerRef = useRef<(() => void) | null>(null);

  // On unmount, remove any registered update handler.
  useEffect(() => {
    return () => {
      if (unsubscribeUpdateHandlerRef.current) {
        unsubscribeUpdateHandlerRef.current();
        unsubscribeUpdateHandlerRef.current = null;
      }
    };
  }, []);

  const connectToRgem = async (rgemId: string) => {
    // 1) Ensure the socket is open
    await whenOpen();

    // 2) Remove any prior update stream handler
    if (unsubscribeUpdateHandlerRef.current) {
      unsubscribeUpdateHandlerRef.current();
      unsubscribeUpdateHandlerRef.current = null;
    }

    // 3) Send hello
    const helloMsg = { type: "hello", gemId: rgemId };
    console.log("[RGEM] Sending hello:", helloMsg);
    sendJson(helloMsg);

    // 4) Await first 'update' with timeout and guaranteed cleanup
    const FIRST_UPDATE_TIMEOUT_MS = 10000;

    const firstUpdatePromise = new Promise<GridState>((resolve, reject) => {

      // Register a one-time message handler for the first update
      const unsubscribeFirstUpdateHandler = addMessageHandler((msg) => {
        const typed = msg as { type?: string; gemState?: unknown };

        // Guard: only handle the first valid update
        if (typed.type === "update" && typeof typed.gemState === "number") {
          const nextGrid = gemStateToGridState(typed.gemState);
          // Unsubscribe immediately since we only want the first update
          unsubscribeFirstUpdateHandler();
          resolve(nextGrid);
        }
      });

      // Attach timeout; remember to clear it on resolve/reject
      const timer = setTimeout(() => {
        try {
          unsubscribeFirstUpdateHandler();
        } catch {}
        reject(new Error("Timed out waiting for first update from server."));
      }, FIRST_UPDATE_TIMEOUT_MS);

      // Patch resolve/reject to clear timeout
      const originalResolve = resolve;
      const originalReject = reject;

      resolve = (value: GridState | PromiseLike<GridState>) => {
        clearTimeout(timer);
        originalResolve(value);
      };

      reject = (err: unknown) => {
        clearTimeout(timer);
        originalReject(err as Error);
      };
    });

    try {
      const initialGrid = await firstUpdatePromise;
      setGridState(initialGrid);
    } catch (err) {
      console.warn("[RGEM] First update did not arrive:", err);
      // Strategy choice:
      // - Option A: throw to surface error to UI flow
      // - Option B: degrade gracefully and keep default grid
      // Here we choose graceful fallback:
      setGridState(createDefaultGrid());
      // If you prefer hard failure, uncomment:
      // throw err;
    }

    // 5) Register the ongoing update stream handler (same as your current one)
    const unsubscribeUpdateHandler = addMessageHandler((msg) => {
      const typed = msg as { type?: string; gemState?: unknown };
      if (typed.type === "update" && typeof typed.gemState === "number") {
        const nextGrid = gemStateToGridState(typed.gemState);
        setGridState(nextGrid);
      }
    });
    unsubscribeUpdateHandlerRef.current = unsubscribeUpdateHandler;
  }

  const handleConnect = async () => {
    if (!selectedRgemId) return;

    setConnectionError(null);
    setConnectionStatus("connecting");

    try {
      await connectToRgem(selectedRgemId);
      setConnectionStatus("connected");
      setMode("operation"); // configuration -> operation
    } catch (err) {
      console.error("Failed to connect to RGEM:", err);
      setConnectionStatus("error");
      setConnectionError("Unable to connect. Please try again.");
      setMode("configuration");
    }
  };

  /**
   * Handle a click on a grid cell.
   *
   * - Logs the cellId and color to the console.
   * - Sends: { type: "toggle", idx: cellId }.
   */
  const handleGridClick = (cellId: number, color: RgbColor) => {
    console.log("Grid cell clicked:", {
      cellId,
      color,
      rgemId: selectedRgemId,
    });

    const msg = {
      type: "toggle",
      idx: cellId,
    };

    console.log("[RGEM] Sending toggle:", msg);
    sendJson(msg);
  };

  const isConnecting = connectionStatus === "connecting";

  return (
    <div className="rgem-app-root">
      {/* Underlying grid is always rendered. Mode simply affects overlay. */}
      <RGemGridPage cells={gridState} onCellClick={handleGridClick} />

      {/* Configuration mode: show selector modal over the grid */}
      {mode === "configuration" && (
        <RGemSelectorModal
          rgemIds={RGEM_IDS}
          selectedRgemId={selectedRgemId}
          onSelectRgemId={setSelectedRgemId}
          onConnect={handleConnect}
          isConnecting={isConnecting}
          error={connectionError}
        />
      )}

      {/* Connecting overlay */}
      <LoadingOverlay isVisible={isConnecting} message="Connecting to RGEM…" />
    </div>
  );
};
