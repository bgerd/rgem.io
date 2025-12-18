import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

// Helper to read the WebSocket URL from environment config.
function getWebSocketUrl(): string {
  const url = import.meta.env.VITE_WS_URL as string | undefined;
  if (!url) {
    console.warn(
      "[RGEM] VITE_WS_URL is not defined; WebSocket connection will fail."
    );
    return "";
  }
  return url;
}

type ReadyState = "CLOSED" | "CONNECTING" | "OPEN" | "CLOSING";

// Defines Context's shared attributes and their types.
type WebSocketContextValue = {
  readyState: ReadyState;
  sendJson: (data: unknown) => void;
  addMessageHandler: (handler: (msg: unknown) => void) => () => void;
  openSocket: (why: string) => Promise<void>;
  closeSocket: (reason: string) => void;
};
 
const WebSocketContext = createContext<WebSocketContextValue | undefined>(
  undefined
);

// Browser SPA heartbeat tuning (you can tweak without touching protocol)
// const PING_IDLE_MS = 10_000;      // send ping if we haven't sent anything recently
const PING_IDLE_MS = 45_000;      // send ping if we haven't sent anything recently
const PONG_TIMEOUT_MS = 5_000;    // declare stale if no inbound within this window after ping
const RECONNECT_BASE_MS = 300;
const RECONNECT_MAX_MS = 8_000;

// Returns a Provider that manages the WebSocket lifecycle and exposes memoized callbacks
// via its Context to children.
export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // readyState informs consumers about the connection status
  const [readyState, setReadyState] = React.useState<ReadyState>("CLOSED");

  // Ref-to-latest pattern: keep latest readyState in a ref to avoid stale closures in long-lived callbacks.
  const readyStateRef = useRef<ReadyState>("CLOSED");
  useEffect(() => {
    readyStateRef.current = readyState;
  }, [readyState]);

  // Track connection state internally via ref for sync access in callbacks.
  const socketRef = useRef<WebSocket | null>(null);

  // Define a set of message handlers to be called on incoming messages.
  const messageHandlersRef = useRef<Set<(msg: unknown) => void>>(new Set());

  // Open promise bookkeeping 
  const openResolveRef = useRef<(() => void) | null>(null);
  const openRejectRef = useRef<((err: unknown) => void) | null>(null);

  // Liveness bookkeeping
  const lastTxAtRef = useRef<number>(0);
  const lastRxAtRef = useRef<number>(0);

  // Ping Pong Timers
  const pingTimerRef = useRef<number | null>(null);
  const pongTimerRef = useRef<number | null>(null);

  // Reconnect bookkeeping
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef<number>(0);

  const clearTimers = useCallback(() => {
    if (pingTimerRef.current) window.clearTimeout(pingTimerRef.current);
    if (pongTimerRef.current) window.clearTimeout(pongTimerRef.current);
    if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
    pingTimerRef.current = null;
    pongTimerRef.current = null;
    reconnectTimerRef.current = null;
  }, []);

  const closeSocket = useCallback(
    (reason: string) => {
      console.log("[RGEM] Closing WebSocket:", reason);
      setReadyState("CLOSING");

      clearTimers();

      // Remember socket.readyState = CONNECTING | OPEN | CLOSING | CLOSED
      const socket = socketRef.current;
      if (socket && (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)) {
        try {
          socket.close(1000, reason);
        } catch {}
      }

      // Reset open promise if someone awaits it later.
      openResolveRef.current = null;
      openRejectRef.current = null;

      // Should trigger the onClose handler for cleanup 
      // which requires socketRef.current
      // socketRef.current = null;
    },
    [clearTimers]
  );

  // Define scheduleNextPing and openSocket callbacks together to avoid circular self-deps.
  const { scheduleNextPing, openSocket } = useMemo(() => {

    function scheduleReconnect() {
      console.log("[RGEM] Scheduling WebSocket reconnect");

      // Avoid multiple scheduled reconnects
      console.assert(reconnectTimerRef.current == null);

      reconnectAttemptRef.current += 1;
      const exp = Math.min(
        RECONNECT_MAX_MS,
        RECONNECT_BASE_MS * 2 ** (reconnectAttemptRef.current - 1)
      );
      const delay = Math.floor(exp * (0.8 + Math.random() * 0.4));

      // TODO: Test reconnect path
      reconnectTimerRef.current = window.setTimeout(() => {
        // Fire-and-forget; log errors to avoid unhandled rejections
        void openSocket("reconnect").catch((err) =>
          console.warn("[RGEM] Reconnect open failed:", err)
        );
        reconnectTimerRef.current = null;
      }, delay);
    }

    function scheduleNextPing() {
      console.log("[RGEM] Scheduling next ping");

      if (pingTimerRef.current)
        window.clearTimeout(pingTimerRef.current);

      const elapsedSinceTx = Date.now() - lastTxAtRef.current;
      const waitMs = Math.max(0, PING_IDLE_MS - elapsedSinceTx);

      pingTimerRef.current = window.setTimeout(() => {
      
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN){
          console.log("[RGEM] Ping aborted; socket not open");
          return;
        }

        console.log("[RGEM] Sending ping");
        socket.send(JSON.stringify({ type: "ping" }));
        lastTxAtRef.current = Date.now();

        // Start pong timeout
        if (pongTimerRef.current)
          window.clearTimeout(pongTimerRef.current);

        // Close socket and reconnect on pong timeout
        pongTimerRef.current = window.setTimeout(() => {
          closeSocket("pong_timeout");
          scheduleReconnect();
        }, PONG_TIMEOUT_MS);
      }, waitMs);
    }

    async function openSocket(why: string): Promise<void> {
      console.log(`[RGEM] openSocket called (${why})`);

      // Ref-to-latest pattern: Check readyStateRef instead of readyState to avoid dependent re-renders
      if (readyStateRef.current === "OPEN" || readyStateRef.current === "CONNECTING") {
        console.log("[RGEM] WebSocket already open or connecting.");
        return Promise.resolve();
      }

      // Remember this will trigger renders in consumers subscribing to readyState
      setReadyState("CONNECTING");

      clearTimers();

      const WS_URL = getWebSocketUrl();
      console.log(`[RGEM] Opening WebSocket (${why}) to:`, WS_URL);

      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      // This promise will be resolved or rejected, when the socket opens or fails
      // to open providing a way for consumers to await the open event
      let openPromise = new Promise<void>((resolve, reject) => {

        // Store the resolve/reject functions to be called later by event handlers
        openResolveRef.current = resolve;
        openRejectRef.current = reject;
      });

      /////////////
      // Define WebSocket event handlers.
      // Remember these handlers respond to inbound events from the server.

      const handleOpen = () => {
        console.log("[RGEM] WebSocket opened.");
        setReadyState("OPEN");

        // Reset reconnect backoff on success
        reconnectAttemptRef.current = 0;
        
        // Update liveness timestamps
        lastRxAtRef.current = Date.now();
        lastTxAtRef.current = Date.now();
        
        // Success! Resolve and clean-up the open promise refs.
        console.assert(openResolveRef.current !== null);
        openResolveRef.current?.();
        openResolveRef.current = null;
        openRejectRef.current = null;

        scheduleNextPing();
      };

      const handleMessage = (event: MessageEvent) => {
        console.log("[RGEM] WebSocket message received:", event.data);

        // Update liveness timestamps
        lastRxAtRef.current = Date.now();

        // Any inbound traffic satisfies liveness for a pending ping
        if (pongTimerRef.current) {
          window.clearTimeout(pongTimerRef.current);
          pongTimerRef.current = null;
        }

        let parsed: unknown = event.data;
        if (typeof event.data === "string") {
          try {
            parsed = JSON.parse(event.data);
          } catch {
            // leave parsed as raw string
          }
        }

        // Call all registered message handlers with the parsed message.
        messageHandlersRef.current.forEach((handler) => {
          handler(parsed);
        });

        scheduleNextPing();
      };

      // TODO: Test error handling path
      const handleError = (event: Event) => {
        console.error("[RGEM] WebSocket error:", event);

        // If the socket errored before opening, reject the open promise.
        if (openRejectRef.current) {
          openRejectRef.current(event);
          openResolveRef.current = null;
          openRejectRef.current = null;
        }
        console.assert(openResolveRef.current === null);
        console.assert(openRejectRef.current === null);
        closeSocket("websocket_error");
      }

      const handleClose = (event: CloseEvent) => {
        console.log(
          "[RGEM] WebSocket closed:",
          `code=${event.code} reason=${event.reason} wasClean=${event.wasClean}`
        );
        setReadyState("CLOSED");

        // If the socket closed before opening, reject the open promise.
        if (openRejectRef.current) {
          openRejectRef.current(
            new Error(
              `WebSocket closed before connection established (code=${event.code}).`
            )
          );
          openResolveRef.current = null;
          openRejectRef.current = null;
        }
        console.assert(openResolveRef.current === null);
        console.assert(openRejectRef.current === null);
      
        console.assert(socketRef.current !== null);
        socketRef.current?.removeEventListener("open", handleOpen);
        socketRef.current?.removeEventListener("message", handleMessage);
        socketRef.current?.removeEventListener("error", handleError);
        socketRef.current?.removeEventListener("close", handleClose);

        socketRef.current = null;
        clearTimers();
      };

      /////////////
      // Attach WebSocket event handlers
      socket.addEventListener("open", handleOpen);
      socket.addEventListener("message", handleMessage);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleClose);

      return openPromise;
    }

    return { scheduleNextPing, openSocket };

  }, [clearTimers, closeSocket]);

  // Sends a JSON-serializable object via the WebSocket.
  const sendJson = useCallback((data: unknown) => {
    const socket = socketRef.current;
    if (!socket) {
      console.warn("[RGEM] No active WebSocket; cannot send message.", data);
      return;
    }
    if (socket.readyState !== WebSocket.OPEN) {
      console.warn(
        `[RGEM] WebSocket not open (readyState=${socket.readyState}); cannot send message.`,
        data
      );
      return;
    }
    socket.send(JSON.stringify(data));
    lastTxAtRef.current = Date.now();
    scheduleNextPing();
  }, [scheduleNextPing]);

  // Registers a message handler to be called on incoming messages.
  const addMessageHandler = useCallback(
    (handler: (msg: unknown) => void) => {
      messageHandlersRef.current.add(handler);

      // Return an unsubscribe function to remove the handler.
      return () => {
        messageHandlersRef.current.delete(handler);
      };
    },
    []
  );

  useEffect(() => {
    return () => {
      messageHandlersRef.current.clear();
    };
  }, []);

  const value: WebSocketContextValue = useMemo(
    () => ({
      readyState,
      openSocket,
      addMessageHandler,
      sendJson,
      closeSocket,
    }),
    [readyState, openSocket, addMessageHandler, sendJson, closeSocket]
  );

  /////////////
  // Return the Context Provider wrapping children.
  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
};

// Custom hook to access the WebSocketContext values via useContext
export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error("useWebSocket must be used within a WebSocketProvider");
  }
  return ctx;
}
