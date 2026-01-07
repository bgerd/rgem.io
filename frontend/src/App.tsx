import React, { useEffect, useRef, useState } from "react";
import { RGemGridPage } from "./components/RGemGridPage";
import { RGemSelectorModal } from "./components/RGemSelectorModal";
import { LoadingOverlay } from "./components/LoadingOverlay";
import type {
  AppMode,
  ConnectionStatus,
  GridState,
} from "./types/grid";
import { useWebSocket } from "./lib/WebSocketProvider";

// Hard-coded RGEM IDs for now.
const RGEM_IDS: string[] = ["test-1", "test-2", "default"];

// Convert a 48-byte (16 x 24-bit RGB) gemState payload into a GridState.
function gemStateToGridState(gemState: Uint8Array): GridState {
  const cells: GridState = [];

  for (let idx = 0; idx < 16; idx++) {
    // TODO: Confirm RGB byte-order is correct for HW implementation

    cells.push({
      r: gemState[idx * 3],
      g: gemState[idx * 3 + 1],
      b: gemState[idx * 3 + 2]
    }); 
  }

  return cells;
}

// Helper to create a default "all off" grid.
function createDefaultGrid(): GridState {
  return gemStateToGridState(new Uint8Array(48));
}

export const App: React.FC = () => {

  /////////////
  // Application state
  const [mode, setMode] = useState<AppMode>("configuration");
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [selectedRgemId, setSelectedRgemId] = useState<string | null>(null);
  const [gridState, setGridState] = useState<GridState>(() =>
    createDefaultGrid()
  );
  const [isCellIdVisible, setIsCellIdVisible] = useState<boolean>(false);

  /////////////
  // Import WebSocketProvider state and hooks via useContext
  // Assumes App is wrapped in WebSocketProvider higher in the tree
  const {
    readyState,
    openSocket,
    addMessageHandler,
    sendJson,
    closeSocket,
  } = useWebSocket();

  /////////////
  // Application refs

  // Track the unsubscribe function for the current Update handler.
  const unsubscribeUpdateHandlerRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    // On unmount, remove any registered update handler.
    return () => {
      if (unsubscribeUpdateHandlerRef.current) {
        unsubscribeUpdateHandlerRef.current();
        unsubscribeUpdateHandlerRef.current = null;
      }
    };
  }, []);

  // Ref-to-latest pattern: keep latest state in a ref to avoid stale closures in long-lived callbacks.
  const selectedRgemIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedRgemIdRef.current = selectedRgemId;
  }, [selectedRgemId]);

  /////////////
  // Application functions
  const ensureConnected = async (why: string) : Promise<void> => {
    console.log(`[App ensureConnected] start(${why}) `);

    // Note: We opt to use a ref to avoid stale closures and
    // reregistering ensureConnected as a callback on every selectedRgemId change.
    const currentRgemId = selectedRgemIdRef.current;
    if (currentRgemId === null) {
      console.log( "... No RGEM selected, opening socket only");
      await openSocket(why);
    } else {
      console.log("... RGEM selected, connecting to RGEM");
      await connectToRgem(why);
    }
    console.log(`[App ensureConnected] done(${why})`);

  }

  const connectToRgem = async (why: string) => {
    console.log(`[App connectToRgem] start(${why})`);

    // 1) Ensure the socket is open
    await openSocket("rgem_specified");

    // 2) Remove any prior update stream handler
    if (unsubscribeUpdateHandlerRef.current) {
      unsubscribeUpdateHandlerRef.current();
      unsubscribeUpdateHandlerRef.current = null;
    }

    // 3) Send hello
    sendJson({ type: "hello", gemId: selectedRgemIdRef.current });

    // 4) Await first 'update' with timeout and guaranteed cleanup
    const FIRST_UPDATE_TIMEOUT_MS = 10000;

    const firstUpdatePromise = new Promise<GridState>((resolve, reject) => {

      // Register a one-time message handler for the first update
      const unsubscribeFirstUpdateHandler = addMessageHandler((msg) => {

        // TODO: Reimplement JSON-based messaging protocol as a more efficient binary protocol (encoded as base64 for API Gateway transport) to reduce message size and parsing overhead on the client.
        const typed = msg as { type?: string; gemState?: unknown };
        
        // Guard: only handle the first valid update
        if (typed.type === "update" && typeof typed.gemState === "string") {
          // Convert gemState from base64 string back to Uint8Array
          const decoded = atob(typed.gemState);
          const payload = new Uint8Array(decoded.length);
          for (let i = 0; i < decoded.length; i++) {
            payload[i] = decoded.charCodeAt(i);
          } 
          const initialGrid = gemStateToGridState(payload);

          // Unsubscribe immediately since we only want the first update
          unsubscribeFirstUpdateHandler();
          
          resolve(initialGrid);
        } else {
            reject(new Error(`Received non-update message or invalid initial gemState, ignoring: ${JSON.stringify(msg)}`));
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

      // Because closures capture variables by reference in JavaScript’s lexical scope,
      // we can reassign the local resolve/reject to wrapped versions that clear the timeout;
      // subsequent calls in this scope will invoke the wrappers.
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
      
      // TODO: Revisit FIRST_UPDATE_TIMEOUT_MS strategy based on UX testing.
      console.error("... First update did not arrive:", err);
      // Strategy choice:
      // - Option A: throw to surface error to UI flow
      // - Option B: degrade gracefully and keep default grid
      // Here we choose graceful fallback:
      setGridState(createDefaultGrid());
      // If you prefer hard failure, uncomment:
      // throw err;
    }

    // 5) Register the ongoing inbound stream handler
    const unsubscribeUpdateHandler = addMessageHandler((msg) => {

      // TODO: Reimplement JSON-based messaging protocol as a more efficient binary protocol (encoded as base64 for API Gateway transport) to reduce message size and parsing overhead on the client.
      const typed = msg as { type?: string; gemState?: unknown };
      if (typed.type === "update" && typeof typed.gemState === "string") {
        // Convert gemState from base64 string back to Uint8Array
        const decoded = atob(typed.gemState);
        const payload = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) {
          payload[i] = decoded.charCodeAt(i);
        } 
        const nextGrid = gemStateToGridState(payload);
        setGridState(nextGrid);
      } else if (typed.type === "pong" || typed.type === "hb") {
        // Ignore pong messages in the update handler; they are for connection health monitoring.
      } else {
          console.error("Received non-update message or invalid gemState, ignoring:", msg);
      }
    });
    unsubscribeUpdateHandlerRef.current = unsubscribeUpdateHandler;

    console.log(`[App connectToRgem] done(${why})`);

  }

  // Handle a click on "Connect" in the RgemSelectorModal
  // Attempts to connect to the selected RGEM ID
  const handleConnect = async () => {
    if (!selectedRgemIdRef.current) return;

    setConnectionError(null);
    setConnectionStatus("connecting");

    await connectToRgem("handle_connect").then(() => {
      setConnectionStatus("connected");
      setMode("operation"); // configuration -> operation
    }).catch((err) => {
      
      // TODO: Revisit appropriate error handling strategy
      console.error("Failed to connect to RGEM:", err);
      setConnectionStatus("error");
      setConnectionError("Unable to connect. Please try again.");
      setMode("configuration");
      
    });
  };

  // Handle a click on a grid cell in the RGemGridPage
  // Sends: { type: "toggle", idx: cellId } via WebSocket
  const handleGridClick = (cellId: number) => {
    console.log(`[App handleGridClick] ${cellId}`);
    sendJson({
      type: "toggle",
      idx: cellId,
    });
  };

  /////////////
  // Manage WebSocket lifecycle based on app visibility
  useEffect(() => {
    console.log("-- app_mount --");

    const onVisibility = () => {
      console.log("document.visibilityState:", document.visibilityState);
      if (document.visibilityState === "hidden") {
        closeSocket("visibility_state_hidden");
      } else {
        void ensureConnected("visibility_state_visible");
      }
    };
    const onPageHide = () => closeSocket("pagehide");
    const onPageShow = () => void ensureConnected("pageshow");
    const onOnline = () => void ensureConnected("online");
    const onOffline = () => closeSocket("offline");

    // We add the event listeners after ensuring connection to prevent
    // race conditions during initial mount.
    void ensureConnected("app_mount").then(() => {
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("pagehide", onPageHide);
        window.addEventListener("pageshow", onPageShow);
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
    });

    // Handle ? key to toggle cell ID visibility
    const handleKeyDown = (event: KeyboardEvent) => {
      // Use event.key for modern browser compatibility (2025 standard)
      if (event.key === "?") {
        setIsCellIdVisible((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      console.log("-- app_unmount --");

      closeSocket("app_unmount");

      // On unmount, remove any registered update handler.
      if (unsubscribeUpdateHandlerRef.current) {
        unsubscribeUpdateHandlerRef.current();
        unsubscribeUpdateHandlerRef.current = null;
      }

      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);

      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Determines visibility of LoadingOverlay
  const isConnecting = (connectionStatus === "connecting"
    || readyState === "CONNECTING"
    || readyState === "CLOSING"
    || readyState === "CLOSED");

  return (
    <div className="rgem-app-root">
      {/* Underlying grid is always rendered. Mode simply affects overlay. */}
      <RGemGridPage cells={gridState} onCellClick={handleGridClick} isLabelVisible={isCellIdVisible} />

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
