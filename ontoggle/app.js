import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  GetCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

const { CONNECTIONS_TABLE, GEM_STATE_TABLE, AWS_REGION } = process.env;

const ddbClient = new DynamoDBClient({ region: AWS_REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

function keyColorCss(n, max) {
  const wheelPos = n * 255 / max; 
  let r = 0, g = 0, b = 0;

  if (wheelPos < 85) {
    r = wheelPos * 3;
    g = 255 - wheelPos * 3;
    b = 0;
  } else if (wheelPos < 170) {
    const wp = wheelPos - 85;
    r = 255 - wp * 3;
    g = 0;
    b = wp * 3;
  } else {
    const wp = wheelPos - 170;
    r = 0;
    g = wp * 3;
    b = 255 - wp * 3;
  }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

// ES6 type module syntax
export const handler = async (event) => {
  // console.log("Received event:", JSON.stringify(event, null, 2));
  // console.log(process.env);

  // Note that we expect a JSON body with: { "type": "toggle", "idx": 0-15 }
  // AND that the client has already sent a "hello" message to associate its connectionId with a gemId.
  const connectionId = event.requestContext.connectionId;

  // TODO: Reimplement in TypeScript with proper types, and properly validate and sanitize all inputs.
  // Currently we are not handling when idx is undefined resulting in toggling all bits (BUG)
  const idx = JSON.parse(event.body).idx;

  // 1. Look up the gemId associated with this connectionId in the CONNECTIONS_TABLE
  let gemId;
  try {
    const getResult = await ddbDocClient.send(
      new GetCommand({
        TableName: CONNECTIONS_TABLE,
        Key: {
          connectionId: connectionId,
        },
      })
    );
    if (!getResult.Item) {
      console.log('Connection not found. Please send a "hello" message first.');
      return {
        statusCode: 400,
        body: 'Connection not found. Please send a "hello" message first.',
      };
    }
    gemId = getResult.Item.gemId;
  } catch (err) {
    console.log("Failed to get from CONNECTIONS_TABLE:", err);
    return {
      statusCode: 500,
      body: "Failed to get from CONNECTIONS_TABLE: " + JSON.stringify(err),
    };
  }

  // 2. Toggle the gemId's gemState in the GEM_STATE_TABLE for given idx
  // 2.1 First, get the current gemState for the gemId
  let gemState;
  try {
    const getResult = await ddbDocClient.send(
      new GetCommand({
        TableName: GEM_STATE_TABLE,
        Key: { gemId: gemId },
      })
    );
    gemState = getResult.Item.gemState;
  } catch (err) {
    console.log("Failed to get current gemState from GEM_STATE_TABLE:", err);
    return {
      statusCode: 500,
      body:
        "Failed to get current gemState from GEM_STATE_TABLE: " +
        JSON.stringify(err),
    };
  }
  
  // 2.2 Compute the new 16-value gemState: increment the value at idx and wrap around at 16
  gemState[idx] = (gemState[idx] + 1) % 16; 

  // 2.3 Update the gemState in the GEM_STATE_TABLE
  try {
    await ddbDocClient.send(
      new PutCommand({
        TableName: GEM_STATE_TABLE,
        Item: {
          gemId: gemId,
          gemState: gemState,
        },
      })
    );
  } catch (err) {
    console.log("Failed to put into CONNECTIONS_TABLE:", err);
    return {
      statusCode: 500,
      body: "Failed to put into CONNECTIONS_TABLE: " + JSON.stringify(err),
    };
  }

  // Iterate through 16-value gemState and create a coresponding 24-bit RGB array of length 16
  const gemStateRGBArray = [];
  for (let i = 0; i < 16; i++) {
    if (gemState[i] == 0) {
      // If the gemState is Off, push [0, 0, 0] to gemStateRGBArray
      gemStateRGBArray.push([0, 0, 0]);
      continue;
    }
    gemStateRGBArray.push(keyColorCss(gemState[i]-1, 15));
  } 

  // Convert gemStateRGBArray to a binary payload of length 16*3 = 48 bytes
  const payload = new Uint8Array(48);
  for (let i = 0; i < 16; i++) {
    payload.set(gemStateRGBArray[i], i * 3);
  }

  // 3. Scan CONNECTIONS_TABLE to find all connected clients associated with this client's gemId
  let connectedClients;
  try {
    connectedClients = await ddbDocClient.send(
      new ScanCommand({
        TableName: CONNECTIONS_TABLE,
        FilterExpression: "gemId = :gemId",
        ExpressionAttributeValues: {
          ":gemId": gemId,
        },
        ProjectionExpression: "connectionId",
      })
    );
  } catch (err) {
    console.log("Failed to scan CONNECTIONS_TABLE:", err);
    return {
      statusCode: 500,
      body: "Failed to scan CONNECTIONS_TABLE: " + JSON.stringify(err),
    };
  }

  // 4. Broadcast the updated gemState to all connected clients
  const apiGateway = new ApiGatewayManagementApiClient({
    // The endpoint is intentionally constructed using the API ID and stage from the event to account for custom domains
    endpoint: `https://${event.requestContext.apiId}.execute-api.${AWS_REGION}.amazonaws.com/${event.requestContext.stage}`,
  });
  const postCalls = connectedClients.Items.map(async ({ connectionId }) => {
    try {
      // NOTE: AWS API Gateway WebSocket APIs does not support binary messaging! it only can send/receive text frames!
      // so we need to encode our binary payload as a base64 string and decode it on the client side.
      // See: https://docs.aws.amazon.com/apigateway/latest/developerguide/websocket-api-develop-binary-media-types.html
      // See: https://repost.aws/questions/QUtbrnTNl6RJeseAE6ZCzx9Q/api-gateway-websocket-binary-frames
      const postCmd = new PostToConnectionCommand({
        ConnectionId: connectionId,
        // TODO: Reimplement JSON-based messaging protocol as a more efficient binary protocol (encoded as base64 for API Gateway transport) to reduce message size and parsing overhead on the client.
        Data: JSON.stringify({
          type: "update",
          gemState: Buffer.from(payload).toString('base64'),
        }),
      });      
      await apiGateway.send(postCmd);
    } catch (err) {
      // If the connection is stale (e.g., the client has disconnected), we delete it from the DynamoDB table
      if (err.statusCode === 410) {
        console.log(`Found stale connection, deleting ${connectionId}`);
        await ddbDocClient.send(
          new DeleteCommand({
            TableName: CONNECTIONS_TABLE,
            Key: {
              connectionId: connectionId,
            },
          })
        );
      } else {
        console.log("Failed to delete from CONNECTIONS_TABLE:", err);
        throw err;
      }
    }
  });

  try {
    await Promise.all(postCalls);
  } catch (err) {
    return { statusCode: 500, body: err.stack };
  }

  return { statusCode: 200, body: "Data sent." };
};
