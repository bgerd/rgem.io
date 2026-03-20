# rgem.io

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**A shared light you can touch from anywhere.**

**[Try the live demo →](#try-it-now)**

---

rgem.io is an ongoing project exploring shared presence across distance — how simple, tangible interactions can connect people who aren't in the same room.

Its current form is a real-time collaborative light grid: sixteen colored cells, synchronized across web browsers and multiple custom-built hardware devices. Each device is battery-powered and WiFi-connected — fully wireless, fully mobile — navigating real constraints around power, connectivity, and reliability.

The system is live. Tap a cell in the [web demo](#try-it-now) right now and physical LEDs on devices in Brooklyn light up. Every connected client — web or hardware — sees the same state, instantly.

The premise started with a question about physical proximity: the way shared objects create presence between people. A candle burning in two rooms. A stone split in half and carried apart. The first working version was an anniversary gift — a small physical object on each of our desks that we could touch to signal each other across distance. No words, no notifications, just shared light.

## Try It Now

1. Open [app.rgem.io](https://app.rgem.io) in two or more browser windows
2. Select the same rgem (e.g. "default") in both and hit **Connect**
3. Tap any cell in one window and watch the other update in real time

## Project Status

This is an active project. The web frontend and serverless backend are deployed and fully functional. The hardware component — a custom-built device using an [Adafruit NeoTrellis](https://learn.adafruit.com/adafruit-neotrellis/overview) keypad and [Adafruit Feather M0 WiFi](https://www.adafruit.com/product/3010) (ATSAMD21 + ATWINC1500), modified with battery power — is manufactured and operational. The codebase can be read, reviewed, and understood as-is, but the repository is not yet self-contained enough to reproduce from scratch.

**Known gaps for reproducibility:**

- **AWS infrastructure** — Deployment requires a pre-existing AWS account with Route 53 hosted zones, ACM certificates, and configured credentials. These are referenced by `samconfig.toml` (gitignored) but not provisioned by the repo itself.
- **WINC1500 firmware tooling** — The hardware device uses an Atmel WINC1500 WiFi module with upgraded firmware and a custom WiFi provisioning page. The x86-specific scripts and binary tools used to flash the module are not included in this repo.
- **Patched WiFi101_Generic library** — The device firmware depends on a custom-patched version of the WiFi101_Generic Arduino library, which is not published or included here.

Contributions and questions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Architecture

```
                      Hardware                          RGem App
          (NeoTrellis + ATSAMD21 + ATWINC1500)          (React)
                          |                                |
                          |  WebSocket                     |  WebSocket
                          v                                v
                        ┌──────────────────────────────────────┐
                        │         AWS Serverless Backend       │
                        │  Lambda  ·  API Gateway  ·  DynamoDB │
                        └──────────────────────────────────────┘
```

The system has three components:

- **RGem App** (`app/`) — React + TypeScript + Vite web app. Connects to the backend over WebSocket, renders the 4x4 grid, and sends click/double-click events.
- **Landing Page** (`landing/`) — Static HTML page served at `rgem.io` (prod only). Links to the app.
- **Backend** (`backend/` + `template.yaml`) — AWS SAM stack with WebSocket and HTTP API Gateways, Lambda functions (Node.js 20, ES modules), a shared Lambda layer, and two DynamoDB tables (connection tracking and grid state). Broadcasts state updates to all clients subscribed to the same "gem."
- **Hardware** (`device/`) — Arduino sketch for an [Adafruit NeoTrellis](https://learn.adafruit.com/adafruit-neotrellis/overview) keypad and [Adafruit Feather M0 WiFi](https://www.adafruit.com/product/3010) (ATSAMD21 + ATWINC1500). Connects to WiFi, communicates with the backend over WebSocket, and displays the shared grid state on its 4x4 RGB button matrix.

### How It Works

1. A client (web or hardware) connects and sends a `hello` message to subscribe to a named gem.
2. The backend responds with the current grid state (base64-encoded, 48 bytes = 16 cells x 3 RGB bytes).
3. When any client clicks a cell, a `toggle` message is sent to the backend.
4. The backend updates the state in DynamoDB and broadcasts the new state to all subscribers.
5. Every client renders the updated grid in real time.

### Tech Stack

| Component    | Technologies |
|--------------|-------------|
| RGem App     | React 19, TypeScript, Vite |
| Landing Page | Static HTML |
| Backend      | AWS Lambda (Node.js 20), API Gateway (HTTP + WebSocket), DynamoDB, SAM/CloudFormation |
| Hardware     | [Adafruit NeoTrellis](https://learn.adafruit.com/adafruit-neotrellis/overview) keypad + [Adafruit Feather M0 WiFi](https://www.adafruit.com/product/3010) (ATSAMD21 + ATWINC1500) |

## Project Structure

```
.
├── README.md
├── backend/
│   ├── gempost/                <-- HTTP route handler
│   ├── ondisconnect/           <-- WebSocket disconnect handler
│   ├── onhello/                <-- WebSocket hello/subscribe handler
│   ├── onping/                 <-- WebSocket ping handler
│   ├── ontoggle/               <-- WebSocket toggle handler
│   ├── schedhb/                <-- scheduled heartbeat function
│   ├── layers/common/nodejs/   <-- shared Lambda layer (DDB, WS, gem-state utils)
│   └── update-dependencies.sh  <-- updates node_modules across handlers
├── app/                        <-- React + TypeScript app SPA
├── device/                     <-- Arduino hardware sketches
├── infra/                      <-- deployment scripts
├── landing/                    <-- static landing page (prod: rgem.io)
├── samconfig.toml.example      <-- SAM CLI environment config template (copy to samconfig.toml)
└── template.yaml               <-- SAM template for Lambda + DynamoDB
```

## Remote Deployment

### Prerequisites

- [Node.js 20](https://nodejs.org/)
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) (configured with credentials)
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html)
- [Python 3](https://www.python.org/) (required by SAM CLI)
- [Arduino IDE](https://www.arduino.cc/en/software) (for hardware development only)

Three environments `dev`, `stage`, `prod` with their own CloudFormation stacks (e.g. `rgem-dev`, `rgem-stage` and `rgem-prod`) are defined by `samconfig.toml`.

### Deployment Steps

#### 1. Create SAM config

Copy the example and fill in your AWS-specific values (Hosted Zone ID, ACM Certificate ARN):

```bash
cp samconfig.toml.example samconfig.toml
# Edit samconfig.toml — replace YOUR_HOSTED_ZONE_ID, YOUR_ACCOUNT_ID, and YOUR_CERTIFICATE_ID
```

> **Note:** `samconfig.toml` is gitignored because it contains account-specific infrastructure identifiers.

#### 2. Configure environment

Run once after cloning (or to switch environments):

```bash
./configure.sh dev      # or stage, prod
```

This generates gitignored config files (`.env`, `app/.env`, `device/core/config.h`) that all other scripts and builds consume.

> **Picking the project back up?** All deploy scripts read `RGEM_ENV` from `.env`. Check which environment is currently stamped before running anything:
> ```bash
> cat .env
> ```
> If it's wrong, re-run `./configure.sh <env>` before proceeding.

#### 3. Lint

```bash
sam validate --lint
```

#### 4. Deploy backend

```bash
./infra/scripts/deploy-backend.sh
```

> **Note:** If the `gemState` structure changes, clear DynamoDB tables before deploying: `./infra/scripts/clear-tables.sh`

#### 5. Deploy RGem App

```bash
./infra/scripts/deploy-app.sh
```

#### 6. Deploy landing page (prod only)

```bash
./infra/scripts/deploy-landing.sh
```

#### 7. Tear down an environment (optional)

To delete all AWS resources for an environment and start fresh:

```bash
./infra/scripts/force-delete-stack.sh
```

This empties S3 buckets, disables CloudFront, and deletes the CloudFormation stack. It reads the target environment from `.env` (set by `configure.sh`). After deletion completes, you can redeploy with steps 4, 5, and (for prod) 6.

## Infrastructure Operations

Not all changes to `template.yaml` behave the same way in CloudFormation. Use the table below to choose the right action before deploying.

### Change Decision Table

| Change type | Action required | Commands |
|---|---|---|
| Lambda code, env vars, memory/timeout | `sam deploy` only | `deploy-backend.sh` |
| IAM policies, CloudFront cache/error settings | `sam deploy` only | `deploy-backend.sh` |
| API Gateway route or integration changes | Bump `Description` rev in `template.yaml` + `sam deploy` | edit `template.yaml` → `deploy-backend.sh` |
| API Gateway `RouteSelectionExpression` | Full stack tear-down | `force-delete-stack.sh` → redeploy ¹ |
| `gemState` encoding or structure change | Clear tables → `sam deploy` | `clear-tables.sh` → `deploy-backend.sh` |
| DynamoDB primary key change (`gemId`, `connectionId`) | Full stack tear-down | `force-delete-stack.sh` → redeploy ¹ |
| S3 bucket name change | Manually empty old bucket → Full stack tear-down | `force-delete-stack.sh` → redeploy ¹ |

> ¹ After tear-down, follow [Deployment Steps](#deployment-steps) to redeploy backend, app, and (for prod) landing page.

### API Gateway: Forcing a New Deployment

`AWS::ApiGatewayV2::Deployment` resources are immutable snapshots. CloudFormation will **not** automatically create a new deployment when routes or integrations change — it only does so when the `Deployment` resource's own properties change.

**Rule:** whenever you modify a route key, integration URI, or `RouteSelectionExpression` in `template.yaml`, increment the `Description` field on the affected `Deployment` resource before running `sam deploy`:

```yaml
# Before
Description: "rev: 1"

# After any route or integration change
Description: "rev: 2"
```

This applies to both `RGempadHttpApiDeployment` and `RGempadWSApiDeployment`. Skipping this step means Lambda receives the updated code but API Gateway continues routing to the old integration.

### Clearing DynamoDB Tables

Required when the `gemState` encoding or structure changes (see Key Gotchas in CLAUDE.md), or when you want a clean slate without tearing down the stack.

```bash
./infra/scripts/clear-tables.sh
```

This clears both `GEM_STATE_TABLE` (gem state) and `CONNECTIONS_TABLE` (active WebSocket connections). Connected clients will be dropped and will reconnect automatically.

### Full Stack Tear-Down

Required when CloudFormation must **replace** a resource that cannot be updated in-place: DynamoDB primary key changes, `RouteSelectionExpression` changes, S3 bucket name changes, or a stack stuck in a rollback state.

```bash
./infra/scripts/force-delete-stack.sh
```

`force-delete-stack.sh` handles the two preconditions that cause a normal `cloudformation delete-stack` to fail:

1. **Non-empty S3 buckets** — CloudFormation cannot delete them; the script empties them first.
2. **Enabled CloudFront distributions** — CloudFormation cannot delete them; the script disables each distribution and waits for propagation before proceeding.

After deletion, redeploy from scratch using steps 4–6 in the [Deployment Steps](#deployment-steps) section above.

## Testing

### RGem App

Navigate your browser to:

- Dev: [app-dev.rgem.io](https://app-dev.rgem.io)
- Stage: [app-stage.rgem.io](https://app-stage.rgem.io)
- Prod: [app.rgem.io](https://app.rgem.io)

### Unit Tests

```bash
cd app
npm run test
```

### Local Development

> **Prerequisite:** `app/.env` must exist before the dev server will connect to the backend. It is generated by `configure.sh` and is gitignored. If you skip this step the app will start but every connection attempt will time out.
>
> ```bash
> ./configure.sh dev   # run once after cloning, or to switch environments
> ```

Start the dev server:

```bash
cd app
npm run dev
```

Then open a browser to http://localhost:5173/

Remember that in **React Strict Mode** components intentionally render twice in **development mode** to help find accidental side-effects and ensure components are resilient to being mounted and unmounted. When running locally, the first WebSocket connection is expected to fail because it is closed before the connection is established.

### Landing Page

Navigate to [rgem.io](https://rgem.io) (prod only). `www.rgem.io` should redirect to `rgem.io`.

### Backend

The rgempad API has two separate API Gateways: one for HTTP connections (`RGempadHttpApi`) and one for WebSocket connections (`RGempadWSApi`) per environment / CloudFormation stack.

To test the WebSocket API, use [wscat](https://github.com/websockets/wscat):

#### 1. Install wscat

```bash
npm install -g wscat
```

#### 2. Connect

```bash
wscat -c wss://<RGempadWSApi-ID>.execute-api.<YOUR-REGION>.amazonaws.com/Prod
```

> **Note:** Fixed custom domains can be used in place of `execute-api` endpoints. When using custom domains, omit the `/Prod` suffix (e.g., `wss://ws-dev.rgem.io`).

#### 3. Test ping

```
> { "type": "ping" }
< { "type": "pong" }
```

Note that an app-level ping is distinct from a protocol/control-level ping. The former is sent by the virtual RGEM pad because there is no JavaScript API for sending control-level pings. Hardware devices only send control-level pings, which are handled by API Gateway.

#### 4. Test hello (subscribe)

```
> { "type": "hello", "gemId": "<gemId>" }
< { "type": "update", "gemState": "<base64-48-bytes>", "ts": "<base64-8-bytes>" }
```

The connection will be subscribed to `<gemId>` and will immediately receive its current state.

> `gemState` is a base64-encoded 48-byte payload representing 16 RGB triplets (16×3 bytes). `ts` is a base64-encoded 8-byte Big-Endian timestamp (milliseconds since epoch) used by clients to discard out-of-order updates.

#### 5. Test toggle

```
> { "type": "toggle", "e": "keydown", "num": 0 }
```

- `"num"`: cell index (0–15)
- `"e"`: event type — `"keydown"` cycles the cell through colors 1–8, `"dblclick"` turns the cell off

All connected websockets subscribed to `<gemId>` should immediately receive:

```
< { "type": "update", "gemState": "<base64-48-bytes>", "ts": "<base64-8-bytes>" }
```

#### 6. Test scheduled heartbeat

All connected websockets subscribed to **any** `<gemId>` should receive the following every 9 minutes:

```
< { "type": "hb" }
```

#### 7. Test gempost (HTTP)

While connected and subscribed to `<gemId>` via wscat, POST a gem state from a separate terminal:

```
# dev:   api-dev.rgem.io
# stage: api-stage.rgem.io
# prod:  api.rgem.io
```

```bash
curl -X POST \
  https://<rest_api_host>/gem/<gemId> \
  -H "Content-Type: application/json" \
  --data-raw '[0,6,6,0,6,2,2,6,0,4,4,0,2,5,5,1]'
```

Response:

```json
{ "gemId": "<gemId>", "echo": <gemState> }
```

All connected websockets subscribed to `<gemId>` should immediately receive:

```
< { "type": "update", "gemState": "<base64-48-bytes>", "ts": "<base64-8-bytes>" }
```

> The HTTP response echoes the raw array, while WebSocket clients receive the encoded grid payload.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding conventions, and pull request guidelines.

## License

This project is licensed under the Apache License 2.0 — see the [LICENSE](LICENSE) file for details.
