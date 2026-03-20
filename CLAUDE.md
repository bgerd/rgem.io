# CLAUDE.md — rgem.io

## Project Overview

Real-time collaborative RGB LED grid. Users interact with a shared 4x4 (16-cell) light pad via browser or physical NeoTrellis M4 keypad. Click cycles through 8 colors; double-click turns off. Changes broadcast instantly to all connected clients.

## Architecture

Three-tier serverless: React frontend <-> AWS API Gateway (WebSocket + HTTP) + Lambda + DynamoDB <-> Arduino hardware. See README.md for full details.

## Quick Reference Commands

### Check current environment
```bash
cat .env             # shows RGEM_ENV, RGEM_WS_HOST, RGEM_API_HOST
./configure.sh dev   # re-stamp to a different environment (dev | stage | prod)
```

### Backend
```bash
sam validate --lint
sam build && sam deploy --config-env dev   # or stage, prod
```

### App
```bash
cd app
export VITE_WS_URL=wss://ws-dev.rgem.io
npm run dev          # localhost:5173
npm run build        # Production build (includes tsc -b)
npm run lint         # ESLint
npm run test         # Vitest unit tests
```

### Deploy App
```bash
./infra/scripts/deploy-app.sh   # S3 + CloudFront invalidation
```

### Deploy Landing (prod only)
```bash
./infra/scripts/deploy-landing.sh   # S3 sync + CloudFront invalidation
```

### Hardware
Compile and upload via Arduino IDE.

## Environments

| Env   | WebSocket        | HTTP API          | App               | Landing   |
|-------|------------------|-------------------|-------------------|-----------|
| dev   | ws-dev.rgem.io   | api-dev.rgem.io   | app-dev.rgem.io   | —         |
| stage | ws-stage.rgem.io | api-stage.rgem.io | app-stage.rgem.io | —         |
| prod  | ws.rgem.io       | api.rgem.io       | app.rgem.io       | rgem.io   |

## Branch Strategy

| Branch  | Environment | Deployed via                  |
|---------|-------------|-------------------------------|
| `main`  | dev         | manual after PR merge         |
| `stage` | stage       | manual after `main → stage` PR |
| `prod`  | prod        | manual after `stage → prod` PR |

Changes flow one direction: `main → stage → prod`. Never push directly to `stage` or `prod`.

**Hotfixes** (including all Landing Page changes): cut `hotfix/*` from `prod`, PR into `prod`, then mandatory back-merge PR into `main`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## Code Conventions

### Backend (Node.js 20)
- ES modules (`import`/`export`), async/await for all I/O
- Layer imports use absolute paths: `/opt/nodejs/...`
- Standard API Gateway response: `{ statusCode, body }`
- camelCase variables/functions, UPPER_CASE constants
- No linting configured

### App (TypeScript / React 19)
- Strict TypeScript, no `any`
- Functional components with hooks, Context API for state
- PascalCase components/types, camelCase variables/functions
- ESLint flat config with react-hooks and react-refresh plugins

### UX & Styling
- All styles use the `.rgem-*` CSS class prefix — no unscoped selectors
- **Match existing styling when adding or modifying UI elements.** New elements must use the established dark-theme palette (`#1f2933` modal background, `#111827` input background, `#4b5563` borders, `#f9fafb` text, `#2563eb` primary button) and follow existing spacing, border-radius, and font-size patterns from `app/src/styles/globals.css`.
- Before adding a new CSS class, check `globals.css` for an existing class that can be reused or extended (e.g. new inputs should mirror `.rgem-modal-select`).
- Do not introduce inline styles, CSS-in-JS, or additional stylesheets. All styles belong in `globals.css`.
- Deviations from these defaults require explicit instruction.

### Arduino (C++)
- UPPER_CASE constants, camelCase functions
- Legacy `Td.` markers exist — migrate to `TODO:` when touching those files
- Enum-based state machine: BOOT -> PROVISIONING -> WIFI_DISCONNECTED -> WIFI_CONNECTED -> WSOCKET_CONNECTED

## Comment & Annotation Conventions

### Standard Markers
- `TODO:` — Work to be done. Be specific about what and why.
- `NOTE:` — Lessons learned, gotchas, non-obvious behavior, architectural decisions. Especially important for bug fixes and design trade-offs.
- `HACK:` — Intentional workaround. Explain the constraint being worked around.
- `FIXME:` — Known broken behavior that needs fixing.

### When Editing Code
- **Preserve existing comments** — Never silently remove a TODO, NOTE, HACK, or FIXME unless the change makes it provably obsolete
- **Flag inconsistencies** — When touching code with non-standard markers (e.g., `Td.`, `Note.`), normalize them to the standard format above
- **Annotate bug fixes** — Add a `NOTE:` explaining what was wrong and why, not just what changed
- **Annotate design decisions** — Add a `NOTE:` explaining the trade-off or rationale for architectural choices
- **Annotate refactors** — Add a `NOTE:` explaining the motivation and any behavioral changes
- **Resolve TODOs** — If a change addresses a TODO, remove it. If partial, update the text.

## Key Gotchas

- React Strict Mode double-renders in dev; first WebSocket connection will fail (expected)
- `gemState` is a 16-element int array (0 = off, 1-8 = color positions), encoded as base64 (48 bytes = 16 cells x 3 RGB bytes) over the wire
- If the structure of `gemState` changes, clear both DynamoDB tables before deploying: `./infra/scripts/clear-tables.sh`
- API Gateway `Deployment` resources are immutable — bump `Description: "rev: N"` in `template.yaml` on any route/integration change or API Gateway will ignore it. See README.md Infrastructure Operations.
- Shared Lambda layer lives at `backend/layers/common/nodejs/` — contains DDB client, WS client, gem-state encoding, and broadcast utility
- `backend/update-dependencies.sh` updates node_modules across all handlers

## Message Protocol

Client -> Server:
```jsonc
{ "type": "hello", "gemId": "test-1" }           // Subscribe
{ "type": "toggle", "e": "keydown", "num": 0 }   // Click cell (0-15); "dblclick" turns off
{ "type": "ping" }                                // App-level ping
```

Server -> Client:
```jsonc
{ "type": "update", "gemState": "<base64-48B>", "ts": "<base64-8B>" }  // State update
{ "type": "pong" }                                                      // Pong response
{ "type": "hb" }                                                        // Heartbeat (9-min)
```

HTTP POST `/gem/{gemId}`: body is int array `[0,1,2,...,7]` (16 elements, values 0-8).

## Testing

### App (Unit)
```bash
cd app
npm run test         # Vitest (28 tests across gem-state, color utilities)
```

### Manual
- **wscat**: `wscat -c wss://ws-dev.rgem.io` then send JSON messages above
- **curl**: `curl -X POST https://api-dev.rgem.io/gem/test-1 -d '[0,1,2,3,4,5,6,7,0,1,2,3,4,5,6,7]'`
- **Frontend**: `npm run dev` with `VITE_WS_URL` env var
