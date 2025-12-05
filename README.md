# rgempad-backend

This is the code and template for the `rgempad-backend`.
There are one `HTTP` function, three `WEBSOCKET` functions, and single scheduled event function contained within the directories and a `SAM` template that wires them up to a `DynamoDB` table and provides the minimal set of permissions needed to run the app:

```
.
├── README.md                   <-- This instructions file
├── gempost (htte route)
├── ondisconnect (websocket route)
├── onhello (websocket route)
├── ontoggle (websocket route)
├── schedhb (scheduled event)
└── template.yaml               <-- SAM template for Lambda Functions and DDB
```

# Deploying to your account

## AWS CLI commands

You can install the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html) and use it to package, deploy, and describe your application. These are the commands you'll need to use:

```
sam deploy --guided

aws cloudformation describe-stacks \
    --stack-name rgempad-backend --query 'Stacks[].Outputs'
```

**Note:** `.gitignore` contains the `samconfig.toml`, hence make sure backup this file, or modify your .gitignore locally.

## Testing the rgempad API

The rgempad API has two seperate ``ApiGateways``, one for `HTTP` connections (E.g. `RGempadHttpApi`) and another for `WEBSOCKET` connections (E.g. `RGempadWSApi`)

To test the WebSocket API, you can use [wscat](https://github.com/websockets/wscat), an open-source command line tool.

1. [Install NPM](https://www.npmjs.com/get-npm).
2. Install wscat:

```bash
$ npm install -g wscat
```

3. On the console, connect to your published websocket API endpoint by executing the following command:

```bash
$ wscat -c wss://{RGempadWSApi-ID}.execute-api.{YOUR-REGION}.amazonaws.com/Prod
```

4. To test the toggle websocket function, send a JSON message like the following example. The Lambda function sends it back using the callback URL:

```bash
$ wscat -c wss://{RGempadWSApi-ID}.execute-api.{YOUR-REGION}.amazonaws.com/Prod
connected (press CTRL+C to quit)
> { "type": "hello", "gemId": "default" }
< { "type":"update", "gemState": ... }
> { "type": "toggle", "buttonIndex": 0 }
< { "type":"update", "gemState": ... }
```

To test the gempost HTTP function, while connected and subscribed to `<gemID>` via `wscat` as show above, in a seperate terminal POST a JSON message like the following example 

```bash
$ curl -X POST \ 
  https://{RGempadHttpApi-ID}.execute-api.{YOUR-REGION}.amazonaws.com/Prod/gem/<gemId> \
  -H "Content-Type: application/json" \
  -d "<gemState>"
< {"gemId":"<gemId>", "echo":<gemState>}
```

All websocket connected and subscribed to `<gemId>` should receive the following 

```
< { "type":"update", "gemState":<gemState> }
```

Note that `https://{RGempadHttpApi-ID}.execute-api.{YOUR-REGION}.amazonaws.com/Prod` and `wss://{RGempadWSApi-ID}.execute-api.{YOUR-REGION}.amazonaws.com/Prod` are also mapped to `https://api.rgem.io` and `wss://ws.rgem.io` respectively