# rgem-backend

This is the code and template for the `rgem-backend`.
There are one `HTTP` function, three `WEBSOCKET` functions, and single scheduled event function contained within the directories and a `SAM` template that wires them up to a `DynamoDB` table and provides the minimal set of permissions needed to run the app:

```
.
├── README.md                   <-- This instructions file
├── gempost (http route)
├── ondisconnect (websocket route)
├── onhello (websocket route)
├── ontoggle (websocket route)
├── schedhb (scheduled event)
└── template.yaml               <-- SAM template for Lambda Functions and DDB
```

# Deploying to your account

## AWS CLI commands

You can install the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html) and use it to package, deploy, and describe your application. 

Three environments `dev`, `stage`, `prod` with their own CloudFormation stacks (E.g. `rgem-dev`, `rgem-stage` and `rgem-prod`) are pre-defined by `samconfig.toml`. 

To deploy:

#### 1. Build SAM artifacts locally and upload them to S3

```bash
sam build & sam package 
```

#### 2. Deploy CloudFormation stack from uploaded S3 artifacts

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

# Testing

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

#### 4. To test the **hello** function, send the following JSON messages over a connected websocket. The connection will then be subscribed to  `<gemId>` and it will immediately receive its current state.

```
> { "type": "hello", "gemId": "<gemId>" }
< { "type":"update", "gemState": ... }
```

#### 4. To **toggle** websocket function send the following JSON messages over a connected websocket subscribed to `<gemId>`

```
> { "type": "toggle", "buttonIndex": 0 }
```

All connected websockets subscribed to `<gemId>` should immediately receive the following:

```
< { "type":"update", "gemState": 0 }
```

#### 5. To test the **schedhb** function, all connected websockets subscribed to **ANY** `<gemId>` should receive the following every 9 minutes:

```
< { "type":"hb" }
```

#### 6. To test the **gempost** HTTP function, while connected and subscribed to `<gemID>` via `wscat` as show above, in a seperate terminal POST a JSON message like the following example 

```bash
$ curl -X POST \ 
  https://<RGempadHttpApi-ID>.execute-api.<YOUR-REGION>.amazonaws.com/Prod/gem/<gemId> \
  -H "Content-Type: application/json" \
  -d <gemState>
< { "gemId":"<gemId>", "echo": <gemState> }
```

All connected websockets subscribed to `<gemId>` should immediately receive the following:

```
< { "type":"update", "gemState": <gemState> }
```

#### **Note:** that fixed `dev`, `stage`, `prod` env specific endpoints can be used in place of `excute-api` endpoints