# rgempad-backend

This is the code and template for the `rgempad-backend`.
There are three functions contained within the directories and a `SAM` template that wires them up to a `DynamoDB` table and provides the minimal set of permissions needed to run the app:

```
.
├── README.md                   <-- This instructions file
├── ondisconnect                <-- Source code ondisconnect
├── onhello                     <-- Source code onhello
├── ontoggle                    <-- Source code ontoggle
├── schedhb                     <-- Source code schedhb
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

To test the WebSocket API, you can use [wscat](https://github.com/websockets/wscat), an open-source command line tool.

1. [Install NPM](https://www.npmjs.com/get-npm).
2. Install wscat:

```bash
$ npm install -g wscat
```

3. On the console, connect to your published API endpoint by executing the following command:

```bash
$ wscat -c wss://{YOUR-API-ID}.execute-api.{YOUR-REGION}.amazonaws.com/{STAGE}
```

4. To test the toggle function, send a JSON message like the following example. The Lambda function sends it back using the callback URL:

```bash
$ wscat -c wss://{YOUR-API-ID}.execute-api.{YOUR-REGION}.amazonaws.com/prod
connected (press CTRL+C to quit)
> { "type": "hello", "gemId": "default"}
< { "type":"update", "gemState": ... }
> { "type": "toggle", "buttonIndex": 0 }
< { "type":"update", "gemState": ... }
```

## License Summary

This sample code is made available under a modified MIT license. See the LICENSE file.
