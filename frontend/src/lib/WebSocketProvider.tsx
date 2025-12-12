import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  // useState,
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

// Defines Context's shared attributes and their types.
type WebSocketContextValue = {
  sendJson: (data: unknown) => void;
  addMessageHandler: (handler: (msg: unknown) => void) => () => void;
  whenOpen: () => Promise<void>;
};

const WebSocketContext = createContext<WebSocketContextValue | undefined>(
  undefined
);

// Returns a Provider that manages the WebSocket lifecycle and exposes memoized callbacks
// (sendJson, addMessageHandler, whenOpen) via its Context to children.
export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const socketRef = useRef<WebSocket | null>(null);
  // const [readyState, setReadyState] = useState<number | null>(null);

  // Define a set of message handlers to be called on incoming messages.
  const messageHandlersRef = useRef<Set<(msg: unknown) => void>>(new Set());

  // Promise that resolves when the socket reaches OPEN.
  const openPromiseRef = useRef<Promise<void> | null>(null);
  const openResolveRef = useRef<(() => void) | null>(null);
  const openRejectRef = useRef<((err: unknown) => void) | null>(null);

  useEffect(() => {
    const WS_URL = getWebSocketUrl();
    if (!WS_URL) {
      return;
    }

    console.log("[RGEM] Opening WebSocket to:", WS_URL);
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;
    // setReadyState(socket.readyState);

    // This promise will be resolved/rejected when the socket opens/errors
    // providing a way for consumers to await the open event. It is returned 
    // to consumers via the whenOpen() callback.
    openPromiseRef.current = new Promise<void>((resolve, reject) => {
      openResolveRef.current = resolve;
      openRejectRef.current = reject;
    });

    /////////////
    // Define WebSocket event handlers.
    // Remember these handlers respond to inbound events from the server.

    // This handler is called when the WebSocket connection is established
    // successfully.
    const handleOpen = () => {
      console.log("[RGEM] WebSocket opened.");
      // setReadyState(WebSocket.OPEN);

      // Success! Resolve and clean-up the open promise refs.  
      if (openResolveRef.current) {
        openResolveRef.current();
      }
      openResolveRef.current = null;
      openRejectRef.current = null;
   
    };

    const handleMessage = (event: MessageEvent) => {
      console.log("[RGEM] WebSocket message received:", event.data);

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
    };

    const handleError = (event: Event) => {
      console.error("[RGEM] WebSocket error:", event);

      // If the socket errored before opening, reject the open promise.
      if (openRejectRef.current) {
        openRejectRef.current(event);
      }
      openResolveRef.current = null;
      openRejectRef.current = null;      
      // setReadyState(WebSocket.CLOSED);
    };

    const handleClose = (event: CloseEvent) => {
      console.log(
        "[RGEM] WebSocket closed:",
        `code=${event.code} reason=${event.reason} wasClean=${event.wasClean}`
      );

      // If the socket closed before opening, reject the open promise.
      if (
        socket.readyState !== WebSocket.OPEN &&
        openRejectRef.current &&
        openResolveRef.current
      ) {
        openRejectRef.current(
          new Error(
            `WebSocket closed before connection established (code=${event.code}).`
          )
        );
        openResolveRef.current = null;
        openRejectRef.current = null;
      }
      // setReadyState(WebSocket.CLOSED);
    };

    /////////////
    // Attach WebSocket event handlers
    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", handleError);
    socket.addEventListener("close", handleClose);

    /////////////
    // Cleanup on unmount.

    return () => {
      console.log("[RGEM] Cleaning up WebSocket in provider.");
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);

      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }

      socketRef.current = null;
      messageHandlersRef.current.clear();
      openPromiseRef.current = null;
      openResolveRef.current = null;
      openRejectRef.current = null;
    };
  }, []);

  /////////////
  // Creates the callbacks that are memoized and then passed as the Context's Provider values
  // that children can consume.

  // Returns a Promise that resolves when the WebSocket is open.
  const whenOpen = useCallback((): Promise<void> => {
    const socket = socketRef.current;

    // If already open, resolve immediately.
    if (socket && socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    // Otherwise, return the existing open promise.
    if (openPromiseRef.current) {
      return openPromiseRef.current;
    }

    // If no socket, return rejected promise.
    return Promise.reject(new Error("WebSocket not initialized."));
  }, []);

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
  }, []);

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

  const value: WebSocketContextValue = useMemo(
    () => ({
      sendJson,
      addMessageHandler,
      whenOpen,
    }),
    [sendJson, addMessageHandler, whenOpen]
  );

  /////////////
  // Return the Context Provider wrapping children.

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
};

export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error("useWebSocket must be used within a WebSocketProvider");
  }
  return ctx;
}
