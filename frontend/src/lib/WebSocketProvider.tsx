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
      "[WSprovider] VITE_WS_URL is not defined; WebSocket connection will fail."
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

  const handleOpenRef = useRef<(() => void) | null>(null);
  const handleMessageRef = useRef<((event: MessageEvent) => void) | null>(null);
  const handleErrorRef = useRef<((event: Event) => void) | null>(null);
  const handleCloseRef = useRef<((event: CloseEvent) => void) | null>(null);

  // Define a set of message handlers to be called on incoming messages.
  const messageHandlersRef = useRef<Set<(msg: unknown) => void>>(new Set());

  // Open promise bookkeeping 
  const openPromiseRef = useRef<Promise<void> | null>(null);
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


  // Define scheduleNextPing and openSocket callbacks together to avoid circular self-deps.
  const { scheduleNextPing, openSocket, closeSocket } = useMemo(() => {

    // TODO: Test reconnect path
    function scheduleReconnect() {
      console.log("[WSProvider scheduleReconnect]");

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
          console.warn("... Reconnect Failed:", err)
        );
        reconnectTimerRef.current = null;
      }, delay);
    }

    function scheduleNextPing() {
      console.log("[WSProvider scheduleNextPing]");

      if (pingTimerRef.current)
        window.clearTimeout(pingTimerRef.current);

      const elapsedSinceTx = Date.now() - lastTxAtRef.current;
      const waitMs = Math.max(0, PING_IDLE_MS - elapsedSinceTx);

      pingTimerRef.current = window.setTimeout(() => {
      
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN){
          console.log("... Ping aborted. Socket not open");
          return;
        }

        console.log("... Sending ping");
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
      console.log(`[WSProvider openSocket] start(${why})`);

      // Ref-to-latest pattern: Check readyStateRef instead of readyState to avoid dependent re-renders
      if (readyStateRef.current === "OPEN") {
        console.log("... WebSocket already open or connecting: ", readyStateRef.current);
        console.log(socketRef.current ? "... Socket exists" : "... Socket does not exist");
        console.log(`... Socket readyState: ${socketRef.current?.readyState}`);
        return Promise.resolve();
      }
      // Ref-to-latest pattern: Check readyStateRef instead of readyState to avoid dependent re-renders
      if (readyStateRef.current === "CONNECTING") {
        console.log("... WebSocket already open or connecting: ", readyStateRef.current);
        console.log(socketRef.current ? "... Socket exists" : "... Socket does not exist");
        console.log(`... Socket readyState: ${socketRef.current?.readyState}`);
        
        if( !openPromiseRef.current ) {
          return Promise.reject(new Error("Inconsistent WebSocket state: CONNECTING but no openPromiseRef"));
        } 
        return openPromiseRef.current;
      }      

      // Remember this will trigger renders in consumers subscribing to readyState
      // WORKAROUND: Also set readyStateRef to CONNECTING here because setState is async
      // and readyStateRef.current is only synced via useEffect after re-render.
      // TODO: look into useSyncExternalStore for better state-ref sync
      setReadyState("CONNECTING");
      readyStateRef.current = "CONNECTING";

      clearTimers();

      const WS_URL = getWebSocketUrl();
      console.log(`... Connecting: ${WS_URL}`);

      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      // This promise will be resolved or rejected, when the socket opens or fails
      // to open providing a way for consumers to await the open event
      const openPromise = new Promise<void>((resolve, reject) => {
        // Store the resolve/reject functions to be called later by event handlers
        openResolveRef.current = resolve;
        openRejectRef.current = reject;
      });
      openPromiseRef.current = openPromise;

      /////////////
      // Define WebSocket event handlers.
      // Remember these handlers respond to inbound events from the server.
      handleOpenRef.current = () => {
        console.log("[WS-Event handleOpen]: Socket opened");

        // Remember this will trigger renders in consumers subscribing to readyState
        // WORKAROUND: Also set readyStateRef to OPEN here because setState is async
        // and readyStateRef.current is only synced via useEffect after re-render.
        // TODO: look into useSyncExternalStore for better state-ref sync
        setReadyState("OPEN");
        readyStateRef.current = "OPEN";

        // Reset reconnect backoff on success
        reconnectAttemptRef.current = 0;
        
        // Update liveness timestamps
        lastRxAtRef.current = Date.now();
        lastTxAtRef.current = Date.now();
        
        // Success! Resolve and clean-up the open promise refs.
        console.assert(openResolveRef.current !== null, "openResolveRef should not be null on handleOpen");
        openResolveRef.current?.();
        openResolveRef.current = null;
        openRejectRef.current = null;
        openPromiseRef.current = null;

        scheduleNextPing();
      };

      handleMessageRef.current = (event: MessageEvent) => {
        console.log("[WS-Event handleMessage]:", event.data);

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
      handleErrorRef.current = (event: Event) => {
        console.error("[WS-Event handleError]:", event);

        // If the socket errored before opening, reject the open promise.
        openRejectRef.current?.(new Error("WebSocket error before connection established.") );
        openResolveRef.current = null;
        openRejectRef.current = null;
        openPromiseRef.current = null;

        closeSocket("websocket_closed_due_to_error");
      };

      handleCloseRef.current = (event: CloseEvent) => {
        console.log(
          "[WS-Event handleClose]:",
          `code=${event.code} reason=${event.reason} wasClean=${event.wasClean}`
        );

        openRejectRef.current?.(new Error("WebSocket closed by server before connection established."));
        openResolveRef.current = null;
        openRejectRef.current = null;
        openPromiseRef.current = null;

        closeSocket("websocket_closed_by_server");
      };

      /////////////
      // Attach WebSocket event handlers
      socketRef.current?.addEventListener("open", handleOpenRef.current!);
      socketRef.current?.addEventListener("message", handleMessageRef.current!);
      socketRef.current?.addEventListener("error", handleErrorRef.current!);
      socketRef.current?.addEventListener("close", handleCloseRef.current!);

      console.log(`[WSProvider openSocket] done: ${why}`);
      return openPromise;
    }

    function closeSocket(why: string) {
      console.log(`[WSProvider closeSocket] start(${why})`);
      
      // Remember this will trigger renders in consumers subscribing to readyState
      // WORKAROUND: Also set readyStateRef to CLOSED here because setState is async
      // and readyStateRef.current is only synced via useEffect after re-render.
      setReadyState("CLOSED");
      readyStateRef.current = "CLOSED";
      console.log(readyStateRef.current === "CLOSED" ? "... ReadyState is CLOSED" : `... ReadyState is ${readyStateRef.current}`);      
      
      clearTimers();

      const socket = socketRef.current;
      socketRef.current = null;

      // Important: Remove event listeners before closing to avoid handling events
      // triggered by the close() call below.
      socket?.removeEventListener("open", handleOpenRef.current!);
      socket?.removeEventListener("message", handleMessageRef.current!);
      socket?.removeEventListener("error", handleErrorRef.current!);
      socket?.removeEventListener("close", handleCloseRef.current!);

      // Remember socket.readyState = CONNECTING | OPEN | CLOSING | CLOSED
      if (socket && (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)) {
        try {
          // Note: This will trigger a warning running in StrictMode when socketClose() is called
          // during unmount while a connection initiated during mount is still in progress.
          console.log("... Closing socket");
          socket.close(1000, why);
        } catch {}
      }

      // Note: oppenRejectRef will be null if the socket had already opened successfully
      // OR if closeSocket is called by handleError or handleClose.

      // Note: This error will be triggered running in StrictMode when closeSocket() is called
      // during unmount while a connection initiated during mount is still in progress.
      openRejectRef.current?.(new Error(`closeSocket called before connection established (${why})`) );
      openResolveRef.current = null;
      openRejectRef.current = null;
      openPromiseRef.current = null;

      // console.log(readyStateRef.current === "CLOSED" ? "... ReadyState is CLOSED" : `... ReadyState is ${readyStateRef.current}`);
      // console.log(socketRef.current ? "... Socket still exists" : "... Socket no longer exists");

      console.log(`[WSProvider closeSocket] done(${why})`);
    }  

    return { scheduleNextPing, openSocket, closeSocket };

  }, [clearTimers]);

  // Sends a JSON-serializable object via the WebSocket.
  const sendJson = useCallback((data: unknown) => {
    console.log(`[WSProvider sendJson] ${JSON.stringify(data)}`);
    const socket = socketRef.current;
    if (!socket) {
      console.warn("... No active WebSocket; cannot send message.", data);
      return;
    }
    if (socket.readyState !== WebSocket.OPEN) {
      console.warn(
        `... WebSocket not open (readyState=${socket.readyState}); cannot send message.`,
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
