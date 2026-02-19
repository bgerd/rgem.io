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

function decodeTimestampString(timestampString: string): number {
  // Convert base64-encoded timestampString into raw bytes
  const timestampRaw = atob(timestampString);

  // Convert a timestampRaw into a Uint8Array.
  const timestampArray = Uint8Array.from(timestampRaw, c => c.charCodeAt(0));

  //  Read as BigInt (Big-Endian)
  const view = new DataView(timestampArray.buffer);
  const timestamp = Number(view.getBigUint64(0));

  return timestamp;
}

// Helper to convert a base64-encoded gemState string into a GridState
function decodeGemStateString(gemStateString: string): GridState {
  const cells: GridState = [];

  // Convert base64-encoded gemStateString into raw bytes
  const gemStateRaw = atob(gemStateString);

  // Convert a 48-byte (16 x 24-bit/3-byte RGB) gemStateRaw into a gemStateBuf.
  const gemStateBuf = Uint8Array.from(gemStateRaw, c => c.charCodeAt(0));

  // Convert gemStateBuf into GridState
  for (let idx = 0; idx < 16; idx++) {
    cells.push({
      r: gemStateBuf[idx * 3],
      g: gemStateBuf[idx * 3 + 1],
      b: gemStateBuf[idx * 3 + 2]
    }); 
  }

  return cells;
}

// Helper to create a default "all off" grid.
function createDefaultGrid(): GridState {
  return Array.from({ length: 16 }, () => ({ r: 0, g: 0, b: 0 }));
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
  // NOTE: Cleanup is handled by the lifecycle useEffect (app_mount/app_unmount).
  const unsubscribeUpdateHandlerRef = useRef<(() => void) | null>(null);

  // Track the latest server-side update timestamp
  const latestUpdateTsRef = useRef<number | null>(null);

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
        const typed = msg as { type?: string; gemState?: string; ts?: string };
        
        // Guard: only handle the first valid update
        if (typed.type === "update" && typeof typed.gemState === "string" && typeof typed.ts === "string") {

          latestUpdateTsRef.current = decodeTimestampString(typed.ts);
          const initialGrid = decodeGemStateString(typed.gemState);

          // Unsubscribe immediately since we only want the first update
          unsubscribeFirstUpdateHandler();
          
          resolve(initialGrid);
        }
        // NOTE:FIX: Ignore pong, hb, and other non-update messages silently.
        // Previously called reject() and threw an error, which broke the connection flow
        // if a pong or heartbeat arrived before the first update.
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

      const typed = msg as { type?: string; gemState?: string; ts?: string };
      
      // Guard: only process valid update messages
      if (typed.type === "update" && typeof typed.gemState === "string" && typeof typed.ts === "string") {

        const timestamp = decodeTimestampString(typed.ts);
        if(latestUpdateTsRef.current === null || timestamp > latestUpdateTsRef.current) {
          latestUpdateTsRef.current = timestamp;
          const nextGrid = decodeGemStateString(typed.gemState);
          setGridState(nextGrid);
          return; 
        } else {
          console.warn(`Ignoring out-of-order update (ts: ${timestamp} <= latest: ${latestUpdateTsRef.current})`);
          return; 
        }
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

    try {
      await connectToRgem("handle_connect");
      setConnectionStatus("connected");
      setMode("operation"); // configuration -> operation
    } catch (err) {
      // TODO: Revisit appropriate error handling strategy
      console.error("Failed to connect to RGEM:", err);
      setConnectionStatus("error");
      setConnectionError("Unable to connect. Please try again.");
      setMode("configuration");
    }
  };

  // Handle a click on a grid cell in the RGemGridPage
  // Sends: { type: "toggle", e: "keydown", num: cellId } via WebSocket
  const handleGridClick = (cellId: number) => {
    console.log(`[App handleGridClick] ${cellId}`);
    sendJson({
      type: "toggle",
      e: "keydown",
      num: cellId,
    });
  };

  // Handle a double click on a grid cell in the RGemGridPage
  // Sends: { type: "toggle", e: "dblclick", num: cellId } via WebSocket
  const handleGridDblClick = (cellId: number) => {
    console.log(`[App handleGridDblClick] ${cellId}`);
    sendJson({
      type: "toggle",
      e: "dblclick",
      num: cellId,
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

    // NOTE:FIX: Register event listeners unconditionally before attempting connection.                                                                                                   
    // Previously these were inside .then() after app_mount, as a workaround until                                                                                                      
    // we fixed openSocket and closeSocket to be idempotent and resilient to multiple calls.                                                                                              
    // The .then() gate meant listeners were never attached if the initial connection failed,                                                                                           
    // preventing auto-recovery on visibility/online events.   
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    void ensureConnected("app_mount").catch((err) =>
      console.warn("[App] Initial connection failed, will retry on visibility/online:", err)
    );

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
    || readyState === "CLOSED");

  return (
    <div className="rgem-app-root">
      {/* Underlying grid is always rendered. Mode simply affects overlay. */}
      <RGemGridPage
        cells={gridState}
        onCellClick={handleGridClick}
        onCellDoubleClick={handleGridDblClick}
        isLabelVisible={isCellIdVisible}
      />

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
