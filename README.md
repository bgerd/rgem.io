# RGEM.io

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

A real-time collaborative RGB LED grid. Multiple users can interact with a shared 4x4 (16-cell) light pad simultaneously — through a web browser or a physical hardware keypad — and see each other's changes instantly. Clicking a cell cycles it through 8 colors; double-clicking turns it off.

> **Note:** This is a portfolio/demo project. The code is fully functional and deployed, but the repository is not yet self-contained enough to reproduce from scratch. Known gaps:
>
> - **AWS infrastructure** — Deployment requires a pre-existing AWS account with Route 53 hosted zones, ACM certificates, and configured credentials. These are referenced by `samconfig.toml` (gitignored) but not provisioned by the repo itself.
> - **WINC1500 firmware tooling** — The hardware device uses an Atmel WINC1500 WiFi module with upgraded firmware and a custom WiFi provisioning page. The x86-specific scripts and binary tools used to flash the module are not included in this repo.
> - **Patched WiFi101_Generic library** — The device firmware depends on a custom-patched version of the WiFi101_Generic Arduino library, which is not published or included here.
>
> The frontend and backend code can be read, reviewed, and understood as-is. Contributions and questions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Architecture

```
  Hardware (NeoTrellis)              Frontend (React)
         |                                |
         |  HTTP POST                     |  WebSocket
         v                                v
       ┌──────────────────────────────────────┐
       │         AWS Serverless Backend       │
       │  Lambda  ·  API Gateway  ·  DynamoDB │
       └──────────────────────────────────────┘
```

The system has three components:

- **Frontend** (`frontend/`) — React + TypeScript + Vite web app. Connects to the backend over WebSocket, renders the 4x4 grid, and sends click/double-click events.
- **Backend** (`backend/` + `template.yaml`) — AWS SAM stack with WebSocket and HTTP API Gateways, Lambda functions (Node.js 20, ES modules), a shared Lambda layer, and two DynamoDB tables (connection tracking and grid state). Broadcasts state updates to all clients subscribed to the same "gem."
- **Hardware** (`device/`) — Arduino sketch for an Adafruit NeoTrellis M4 (SAMD21). Connects to WiFi, communicates with the backend over WebSocket, and displays the shared grid state on its 4x4 RGB button matrix.

### How It Works

1. A client (web or hardware) connects and sends a `hello` message to subscribe to a named gem.
2. The backend responds with the current grid state (base64-encoded, 48 bytes = 16 cells x 3 RGB bytes).
3. When any client clicks a cell, a `toggle` message is sent to the backend.
4. The backend updates the state in DynamoDB and broadcasts the new state to all subscribers.
5. Every client renders the updated grid in real time.

### Tech Stack

| Component | Technologies |
|-----------|-------------|
| Frontend  | React 19, TypeScript, Vite |
| Backend   | AWS Lambda (Node.js 20), API Gateway (HTTP + WebSocket), DynamoDB, SAM/CloudFormation |
| Hardware  | Arduino (SAMD21), Adafruit NeoTrellis, ArduinoJson |

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
├── device/                     <-- Arduino hardware sketches
├── frontend/                   <-- React + TypeScript frontend
├── infra/                      <-- deployment scripts
├── samconfig.toml.example      <-- SAM CLI environment config template (copy to samconfig.toml)
└── template.yaml               <-- SAM template for Lambda + DynamoDB
```

# Remote Deployment

## Prerequisites

- [Node.js 20](https://nodejs.org/)
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) (configured with credentials)
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html)
- [Python 3](https://www.python.org/) (required by SAM CLI)
- [Arduino IDE](https://www.arduino.cc/en/software) (for hardware development only)

Three environments `dev`, `stage`, `prod` with their own CloudFormation stacks (E.g. `rgem-dev`, `rgem-stage` and `rgem-prod`) are defined by `samconfig.toml`.

## Deployment Steps

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

This generates gitignored config files (`.env`, `frontend/.env`, `device/core/config.h`) that all other scripts and builds consume.

#### 3. Lint
```bash
sam validate --lint
```

#### 4. Deploy backend

```bash
./infra/scripts/deploy-backend.sh
```

> **Note:** If the structure of `gemState` changes, you must clear the `GEM_STATE_TABLE` in DynamoDB before deploying.

#### 5. Deploy frontend

```bash
./infra/scripts/deploy-frontend.sh
```

#### 6. Tear down an environment (optional)

To delete all AWS resources for an environment and start fresh:

```bash
./infra/scripts/force-delete-stack.sh
```

This empties S3 buckets, disables CloudFront, and deletes the CloudFormation stack. It reads the target environment from `.env` (set by `configure.sh`). After deletion completes, you can redeploy with steps 4 and 5.

# Testing

## Frontend
Navigate your browser to
- Dev: [app-dev.rgem.io](app-dev.rgem.io)
- Stage: [app-stage.rgem.io](app-stage.rgem.io)
- Prod: [app.rgem.io](app.rgem.io)

## Frontend (Unit Tests)

```bash
cd frontend
npm run test
```

## Frontend (Local)

After running `./configure.sh <env>`, `frontend/.env` is generated with the correct `VITE_WS_URL`. Start the dev server:

```bash
cd frontend
npm run dev
```

Then open a browser to http://localhost:5173/

Remember that in **React Strict Mode** components intentionally render twice in **development mode** to help find accidental side-effects and ensure components are resilient to being mounted and unmounted.

So that when running locally: we expect an initial WebSocket connection to fail, because it is closed before the connection is established 

## Backend

The rgempad API has two seperate ``ApiGateways``, one for `HTTP` connections (E.g. `RGempadHttpApi`) and another for `WEBSOCKET` connections (E.g. `RGempadWSApi`) per Environment / CloudFormation Stack.

To test the WebSocket API, you can use [wscat](https://github.com/websockets/wscat), an open-source command line tool.

#### 1. [Install NPM](https://www.npmjs.com/get-npm).
#### 2. Install wscat:

```bash
$ npm install -g wscat
```

#### 3. On the console, connect to your published websocket API endpoint by executing the following command:

```bash
$ wscat -c wss://<RGempadWSApi-ID>.execute-api.<YOUR-REGION>.amazonaws.com/Prod
```

#### 4.a. To test the app-level **ping** function, send the following JSON messages over a connected websocket. 

```
> { "type": "ping" }
< { "type": "pong"}
```

Note that an app-level ping is distinct from a protocol/control-level ping. 
- The former is sent by the virtual RGEM pad instead of the latter, because there is no JavaScript API for sending control-level pings. 
- RGEM pad devices only send control-level pings, which are handled by the API Gateway

#### 4.b. To test the **hello** function, send the following JSON messages over a connected websocket. 
The connection will then be subscribed to  `<gemId>` and it will immediately receive its current state.

```
> { "type": "hello", "gemId": "<gemId>" }
< { "type":"update", "gemState": "<base64-48-bytes>", "ts": "<base64-8-bytes>" }
```
Note: `gemState` is a base64-encoded 48-byte payload representing 16 RGB triplets (16×3 bytes). `ts` is a base64-encoded 8-byte Big-Endian timestamp (milliseconds since epoch) used by clients to discard out-of-order updates.

#### 4.c. To test **toggle** websocket function send the following JSON messages over a connected websocket subscribed to `<gemId>`

```
> { "type": "toggle", "e": "keydown", "num": 0 }
```

- `"num"`: cell index (0–15)
- `"e"`: event type — `"keydown"` cycles the cell through colors 1–8, `"dblclick"` turns the cell off

All connected websockets subscribed to `<gemId>` should immediately receive the following:

```
< { "type":"update", "gemState": "<base64-48-bytes>", "ts": "<base64-8-bytes>" }
```

#### 5. To test the **schedhb** function, all connected websockets subscribed to **ANY** `<gemId>` should receive the following every 9 minutes:

```
< { "type":"hb" }
```

#### 6. To test the **gempost** HTTP function, while connected and subscribed to `<gemID>` via `wscat` as show above, in a seperate terminal POST a JSON message like the following example 

```
# dev rest_api_host: api-dev.rgem.io
# stage rest_api_host: api-stage.rgem.io
# prod rest_api_host: api.rgem.io
```

```bash
$ curl -X POST \ 
  https://<rest_api_host>/gem/<gemId> \
  -H "Content-Type: application/json" \
  --data-raw '[0,6,6,0,6,2,2,6,0,4,4,0,2,5,5,1]'
< { "gemId":"<gemId>", "echo": <gemState> }
```

All connected websockets subscribed to `<gemId>` should immediately receive the following:

```
< { "type":"update", "gemState": "<base64-48-bytes>", "ts": "<base64-8-bytes>" }
```
Note: The HTTP response echoes the raw array, while WebSocket clients receive the encoded grid payload.

#### **Note:** fixed `dev`, `stage`, `prod` custom domains can be used in place of `execute-api` endpoints. When using custom domains, omit the `/Prod` suffix (e.g., `wss://ws-dev.rgem.io`).

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding conventions, and pull request guidelines.

## License

This project is licensed under the Apache License 2.0 — see the [LICENSE](LICENSE) file for details.