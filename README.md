# RGEM.io

A real-time collaborative RGB LED grid. Multiple users can interact with a shared 4x4 (16-cell) light pad simultaneously — through a web browser or a physical hardware keypad — and see each other's changes instantly. Clicking a cell cycles it through 8 colors; double-clicking turns it off.

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
- **Backend** (root-level Lambda handlers + `template.yaml`) — AWS SAM stack with WebSocket and HTTP API Gateways, Lambda functions, and two DynamoDB tables (connection tracking and grid state). Broadcasts state updates to all clients subscribed to the same "gem."
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
├── frontend/                   <-- React + TypeScript frontend
├── device/                     <-- Arduino hardware sketches
├── infra/                      <-- deployment scripts
├── gempost/                    <-- HTTP route handler
├── ondisconnect/               <-- WebSocket disconnect handler
├── onhello/                    <-- WebSocket hello/subscribe handler
├── onping/                     <-- WebSocket ping handler
├── ontoggle/                   <-- WebSocket toggle handler
├── schedhb/                    <-- scheduled heartbeat function
└── template.yaml               <-- SAM template for Lambda + DynamoDB
```

# Remote Deployment

## Prerequisites

You can install the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html) and use it to package, deploy, and describe the application. 

Three environments `dev`, `stage`, `prod` with their own CloudFormation stacks (E.g. `rgem-dev`, `rgem-stage` and `rgem-prod`) are defined by `samconfig.toml`. 

## Deployment Steps

#### 1. Lint
```bash
# Lint CloudFormation template
sam validate --lint
```

#### 2. Build SAM artifacts locally and upload them to S3

```bash
# Must be re-run whenever handlers or template.yaml updated
sam build && sam package
```

> **Note:** If the structure of `gemState` changes, you must clear the `GEM_STATE_TABLE` in DynamoDB before deploying.

#### 3. Deploy CloudFormation stack from uploaded S3 artifacts

```bash
# Deploys rgem-dev
# websocket endpoint: ws-dev.rgem.io
# http endpoint: api-dev.rgem.io
sam deploy --config-env dev

# Deploys rgem-stage
# websocket endpoint: ws-stage.rgem.io
# http endpoint: api-stage.rgem.io
sam deploy --config-env stage

# Deploys rgem-prod
# websocket endpoint: ws.rgem.io
# http endpoint: api.rgem.io
sam deploy --config-env prod
```

#### 4. Build, Package, and Deploy React Frontend 

```bash
# Deploys frontend to app-dev.rgem.io
./infra/scripts/deploy-frontend.sh dev

# Deploys frontend to app-stage.rgem.io
./infra/scripts/deploy-frontend.sh stage

# Deploys frontend to app.rgem.io
./infra/scripts/deploy-frontend.sh prod
```


# Testing

## Frontend
Navigate your browser to
- Dev: [app-dev.rgem.io](app-dev.rgem.io)
- Stage: [app-stage.rgem.io](app-stage.rgem.io)
- Prod: [app.rgem.io](app.rgem.io)

## Frontend (Local)
In a terminal window, navigate to `frontend` subdirectory and set `VITE_WS_URL` for the current session :

```bash
# Connects frontend to dev backend
$ export VITE_WS_URL=wss://ws-dev.rgem.io

# Connects frontend to stage backend
$ export VITE_WS_URL=wss://ws-stage.rgem.io

# Connects frontend to prod backend
$ export VITE_WS_URL=wss://ws.rgem.io
```

Then start the React development server and open a browser to http://localhost:5173/

```bash
$ npm run dev
```

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