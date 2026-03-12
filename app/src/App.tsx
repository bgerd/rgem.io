import React, { useEffect, useRef, useState } from "react";
import { RGemGridPage } from "./components/RGemGridPage";
import { RGemSelectorModal } from "./components/RGemSelectorModal";
import { LoadingOverlay } from "./components/LoadingOverlay";
import type {
  ConnectionStatus,
  GridState,
} from "./types/grid";
import { useWebSocket } from "./lib/WebSocketProvider";
import { decodeTimestampString, decodeGemStateString, createDefaultGrid } from "./lib/gem-state";
import { useRoute } from "./lib/useRoute";
import { parseGemIdFromPathname } from "./lib/gem-id";

const RECONNECT_TIMEOUT_MS = 15000;

export const App: React.FC = () => {

  /////////////
  // URL-based routing
  const pathname = useRoute();
  const gemId = parseGemIdFromPathname(pathname);

  /////////////
  // Application state
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [modalError, setModalError] = useState<string | null>(null);
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
  // NOTE: Synced from URL-derived gemId in the routing effect rather than from state.
  const selectedRgemIdRef = useRef<string | null>(null);

  // Holds the active background-reconnect timeout handle.
  // A ref is used so the timer is not restarted on each WebSocketProvider backoff cycle
  // (CLOSED → CONNECTING → CLOSED), which would prevent it from ever firing.
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /////////////
  // Application functions
  const ensureConnected = async (why: string): Promise<void> => {
    console.log(`[App ensureConnected] start(${why}) `);

    // Note: We opt to use a ref to avoid stale closures and
    // reregistering ensureConnected as a callback on every selectedRgemId change.
    const currentRgemId = selectedRgemIdRef.current;
    if (currentRgemId === null) {
      console.log("... No RGEM selected, opening socket only");
      await openSocket(why);
    } else {
      console.log("... RGEM selected, connecting to RGEM");
      await connectToRgem(why);
    }
    console.log(`[App ensureConnected] done(${why})`);
  };

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
          // NOTE:FIX:LINT no-empty — catch is intentionally empty; unsubscribe may
          // already have been called by the resolve path, and double-unsubscribe is harmless.
        } catch { /* ignored */ }
        reject(new Error("Timed out waiting for first update from server."));
      }, FIRST_UPDATE_TIMEOUT_MS);

      // Patch resolve/reject to clear timeout
      const originalResolve = resolve;
      const originalReject = reject;

      // Because closures capture variables by reference in JavaScript's lexical scope,
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
  };

  /////////////
  // Routing effect: sync ref, redirect invalid paths, auto-connect on valid gemId
  useEffect(() => {
    // Sync ref immediately so connectToRgem reads the correct gemId without a stale closure.
    selectedRgemIdRef.current = gemId;

    // Invalid path (e.g. /bad!!id): redirect to / and surface a validation error via React state.
    // NOTE: history.state cannot be used here because gemId === null on the first render
    // (invalid path fails parseGemIdFromPathname), so the modal is already mounted before
    // this effect runs — its lazy useState initializer would read history.state too early.
    if (pathname !== "/" && gemId === null) {
      setModalError("Gem ID can only contain letters, numbers, and hyphens (max 24 characters)");
      history.replaceState(null, "", "/");
      // NOTE: replaceState does not fire popstate. Dispatch manually to trigger useRoute re-read.
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }

    if (gemId === null) {
      // At /: clear any routing error and reset connection status.
      setModalError(null);
      setConnectionStatus("idle");
      return;
    }

    // Valid gemId in URL: auto-connect
    // NOTE: stale flag prevents the failure handler from redirecting to / if this effect
    // is cleaned up before the async catch fires. This handles two cases:
    // 1. React StrictMode double-mount in dev: the first mount's socket is torn down by
    //    the lifecycle cleanup, causing connectToRgem to reject. Without stale guard,
    //    the catch would redirect to / before the second mount can reconnect successfully.
    // 2. User navigates away mid-connect: the catch should not redirect if gemId has changed.
    let stale = false;
    setConnectionStatus("connecting");
    void connectToRgem("url_mount")
      .then(() => {
        if (!stale) setConnectionStatus("connected");
      })
      .catch(() => {
        if (stale) return;
        // NOTE: On failure, redirect to / with error state so the modal can pre-populate
        // the input and show a contextual error message on mount.
        history.replaceState({ gemId, error: "connection_failed" }, "", "/");
        window.dispatchEvent(new PopStateEvent("popstate"));
        setConnectionStatus("idle");
      });
    return () => { stale = true; };
    // NOTE:FIX:LINT react-hooks/exhaustive-deps — connectToRgem is intentionally omitted.
    // It uses the ref-to-latest pattern (selectedRgemIdRef) so the stale closure is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gemId]);

  // Handle modal submit: push URL so useRoute picks up the new gemId, triggering the routing effect.
  const handleModalSubmit = (id: string) => {
    history.pushState(null, "", `/${id}`);
    // NOTE: pushState does not fire popstate. Dispatch manually to trigger useRoute re-read.
    window.dispatchEvent(new PopStateEvent("popstate"));
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

    // NOTE: On mount, only open the socket. The routing effect (useEffect([gemId])) handles
    // connectToRgem when a gemId is present in the URL. Calling ensureConnected here would
    // duplicate the hello/first-update flow and register duplicate update handlers.
    void openSocket("app_mount").catch((err) =>
      console.warn("[App] Initial socket open failed, will retry on visibility/online:", err)
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
    // NOTE:FIX:LINT react-hooks/exhaustive-deps — ensureConnected and openSocket are
    // intentionally omitted. Both use the ref-to-latest pattern (selectedRgemIdRef) so
    // stale closures are safe. Adding them would re-register all event listeners on every render.
    // closeSocket is stable (from useMemo) and included.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeSocket]);

  // Background reconnect timeout: if already connected at /{gemId} and the socket drops,
  // redirect to / with an error after RECONNECT_TIMEOUT_MS.
  // NOTE: readyState cycles CLOSED → CONNECTING → CLOSED on each WebSocketProvider backoff
  // retry. The reconnectTimerRef prevents restarting the timer on each cycle — it is only
  // started once per drop event and cancelled only if readyState returns to OPEN.
  useEffect(() => {
    const socketDown = readyState !== "OPEN";
    const atConnectedGem = gemId !== null && connectionStatus === "connected";

    if (atConnectedGem && socketDown) {
      if (reconnectTimerRef.current !== null) return; // timer already running — don't restart
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        history.replaceState({ gemId, error: "connection_failed" }, "", "/");
        window.dispatchEvent(new PopStateEvent("popstate"));
        setConnectionStatus("idle");
      }, RECONNECT_TIMEOUT_MS);
    } else {
      // Reconnected or navigated away — cancel any pending redirect
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    return () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [gemId, connectionStatus, readyState]);

  // NOTE: Show the overlay when actively connecting (any mode), or when at /{gemId} and
  // the socket is reconnecting in the background. gemId === null (at /) is excluded to
  // prevent the overlay from blocking the modal.
  const showOverlay = connectionStatus === "connecting"
    || (gemId !== null && (readyState === "CONNECTING" || readyState === "CLOSED"));

  return (
    <div className="rgem-app-root">
      {/* Underlying grid is always rendered. gemId presence determines modal visibility. */}
      <RGemGridPage
        cells={gridState}
        onCellClick={handleGridClick}
        onCellDoubleClick={handleGridDblClick}
        isLabelVisible={isCellIdVisible}
      />

      {/* No gemId in URL: show selector modal */}
      {gemId === null && (
        <RGemSelectorModal
          onSubmit={handleModalSubmit}
          // NOTE: Only disable during active user-initiated connect, not background socket setup.
          isConnecting={connectionStatus === "connecting"}
          error={modalError}
        />
      )}

      {/* Connecting overlay */}
      <LoadingOverlay isVisible={showOverlay} message="Connecting to RGEM…" />
    </div>
  );
};
