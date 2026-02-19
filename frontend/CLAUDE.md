# CLAUDE.md — virtual-rgem frontend

Frontend-specific supplement to the [root CLAUDE.md](../CLAUDE.md).

For comment conventions, message protocol, environment table, naming rules, and deployment, see the root file.

## Component Tree

```
main.tsx
└── React.StrictMode
    └── WebSocketProvider          # Generic WS transport (Context)
        └── App                    # Orchestrator: modes, connection, grid state
            ├── RGemGridPage       # 4x4 color grid (always rendered)
            ├── RGemSelectorModal  # RGEM ID picker (configuration mode only)
            └── LoadingOverlay     # Connecting spinner overlay
```

### Context contract (`useWebSocket()`)

```ts
{
  readyState: ReadyState;                                    // "CLOSED" | "CONNECTING" | "OPEN"
  openSocket: (why: string) => Promise<void>;                // Opens WS; resolves on OPEN
  addMessageHandler: (handler: (msg: unknown) => void) => () => void;  // Returns unsubscribe fn
  sendJson: (data: unknown) => void;                         // JSON.stringify + send
  closeSocket: (reason: string) => void;                     // Tears down socket + timers
}
```

Data flows down via props; events flow up via callbacks. No external state library. No routing.

## File Responsibilities

### `src/main.tsx`
- Mounts the React tree: `StrictMode > WebSocketProvider > App`
- Imports `globals.css`
- **Do not** add app logic here

### `src/lib/WebSocketProvider.tsx`
- Generic WebSocket transport — manages socket lifecycle, ping/pong, reconnect backoff
- Exposes `WebSocketProvider` (component) and `useWebSocket` (hook)
- Key functions: `openSocket`, `closeSocket`, `sendJson`, `addMessageHandler`, `scheduleNextPing`, `scheduleReconnect`
- **Do not** add app-specific logic (RGEM IDs, grid state, message interpretation) here. This is pure transport.

### `src/App.tsx`
- Top-level orchestrator: owns `mode`, `connectionStatus`, `gridState`, `selectedRgemId`, `isCellIdVisible`
- Key functions: `ensureConnected`, `connectToRgem`, `handleConnect`, `handleGridClick`, `handleGridDblClick`, `decodeGemStateString`, `decodeTimestampString`, `createDefaultGrid`
- Manages visibility/online/offline event listeners
- `?` keydown toggles `isCellIdVisible`
- `RGEM_IDS` is hardcoded here (line 13)

### `src/components/RGemGridPage.tsx`
- Renders the 4x4 grid of `<button>` cells
- Key function: `logicalColorToCss` — converts `RgbColor` to CSS background
- Stateless; receives `cells`, `onCellClick`, `onCellDoubleClick`, `isLabelVisible` via props

### `src/components/RGemSelectorModal.tsx`
- Stateless modal for picking an RGEM ID and clicking Connect
- **Does not** know about WebSockets or grid state

### `src/components/LoadingOverlay.tsx`
- Stateless full-screen spinner; renders nothing when `isVisible` is false

### `src/types/grid.ts`
- Type definitions: `AppMode`, `ConnectionStatus`, `RgbColor`, `GridState`
- **Note:** tsconfig only includes `src/**/*.tsx` — this `.ts` file must be imported from a `.tsx` file to be checked

### `src/styles/globals.css`
- All styles use `.rgem-*` prefix — no unscoped class names
- Imported once in `main.tsx`


## Critical Patterns

### Ref-to-latest
Long-lived callbacks (event listeners, setTimeout) capture stale closure state. The codebase uses refs synced via `useEffect` to access current values:
- `readyStateRef` synced from `readyState` — `WebSocketProvider.tsx:58-61`
- `selectedRgemIdRef` synced from `selectedRgemId` — `App.tsx:100-103`

### WORKAROUND: readyStateRef direct sync
`setReadyState` is async (batched), but `openSocket`/`closeSocket` need the ref to reflect the new state immediately for guard checks. The ref is set **directly alongside** the setState call:
- `WebSocketProvider.tsx:196-197` (CONNECTING)
- `WebSocketProvider.tsx:226-227` (OPEN)
- `WebSocketProvider.tsx:332-333` (CLOSED)

### Message handler pub-sub
`addMessageHandler(fn)` returns an unsubscribe function. **Always call the unsubscribe** in cleanup paths. Handlers are stored in `messageHandlersRef` (a `Set`). All handlers are called for every inbound message — filtering is the handler's responsibility.

### Promise-based openSocket
- If OPEN → returns resolved promise immediately
- If CONNECTING → returns the existing `openPromiseRef` promise (callers share one await)
- If CLOSED → creates new WebSocket, stores resolve/reject refs, returns new promise

### Out-of-order rejection
`latestUpdateTsRef` in `App.tsx:97` tracks the most recent server timestamp. The ongoing update handler (line 216) compares incoming timestamps and discards stale updates.

### First-update promise
`connectToRgem` (App.tsx:124) sends `hello`, then creates a one-shot message handler + `setTimeout` to await the first `update`. On timeout (10s), it falls back to a default grid. The one-shot handler unsubscribes itself on first valid update.

### CSS class naming
All classes use `.rgem-*` prefix. No unscoped selectors. Defined in `src/styles/globals.css`.

## State Machines

### AppMode (`App.tsx`)
```
"configuration"  ──handleConnect success──>  "operation"
                 <──handleConnect failure──
```

### ConnectionStatus (`App.tsx`)
```
"idle" ──handleConnect──> "connecting" ──success──> "connected"
                              │
                              └──failure──> "error"
```
On failure, mode reverts to `"configuration"`.

### ReadyState (`WebSocketProvider.tsx`)
```
"CLOSED" ──openSocket──> "CONNECTING" ──handleOpen──> "OPEN"
   ^                          │                         │
   │                          │                         │
   └──────────────────closeSocket───────────────────────┘
   │                          │
   └──scheduleReconnect───────┘  (on handleClose, handleError, pong timeout)
```

## Data Encoding

### gemState
`base64 string` → `atob()` → 48 raw bytes → 16 cells × 3 bytes (R, G, B)

```
Cell index = byte offset / 3
  r = bytes[idx * 3]
  g = bytes[idx * 3 + 1]
  b = bytes[idx * 3 + 2]
```

### Timestamp
`base64 string` → `atob()` → 8 raw bytes → `DataView.getBigUint64(0)` (big-endian) → `Number()`

### Color display
- Off `(0,0,0)` → `#d3d3d3` (light gray)
- Non-zero → `oklch(from rgb(r,g,b) calc(l + 0.30) c h)` (lightened 30%)

## WebSocket Timing Constants

All defined in `WebSocketProvider.tsx`:

| Constant              | Value    | Line | Purpose                                          |
|-----------------------|----------|------|--------------------------------------------------|
| `PING_IDLE_MS`        | 45,000ms | 44   | Send ping after this idle period                 |
| `PONG_TIMEOUT_MS`     | 5,000ms  | 45   | Declare stale if no inbound within this window   |
| `RECONNECT_BASE_MS`   | 300ms    | 46   | Base delay for exponential backoff reconnect     |
| `RECONNECT_MAX_MS`    | 8,000ms  | 47   | Maximum reconnect delay cap                      |

App-level constant in `App.tsx`:

| Constant                  | Value    | Line | Purpose                                      |
|---------------------------|----------|------|----------------------------------------------|
| `FIRST_UPDATE_TIMEOUT_MS` | 10,000ms | 140  | Timeout waiting for first `update` after hello|

Reconnect uses jittered exponential backoff: `min(MAX, BASE * 2^(attempt-1)) * random(0.8, 1.2)`.

## Gotchas

- **StrictMode double-mount**: The first WebSocket connection fails during dev because unmount tears it down. This produces a console error — do not suppress it.
- **Event listeners registered unconditionally**: In `App.tsx`, visibility/online/offline listeners are registered before `ensureConnected("app_mount")`. Previously they were inside `.then()`, which meant they were never attached if the initial connection failed — preventing auto-recovery.
- **`isConnecting` includes CLOSED state**: `App.tsx:340-343` — the `isConnecting` check includes `readyState === "CLOSED"`. This is intentional for the initial mount where the socket hasn't connected yet.
- **tsconfig `include`**: `tsconfig.app.json` includes both `src/**/*.ts` and `src/**/*.tsx`. 

## Commands

```bash
npm run dev       # Dev server with HMR (localhost:5173)
npm run build     # tsc -b && vite build
npm run lint      # ESLint flat config
npm run preview   # Preview production build
```
