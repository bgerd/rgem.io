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

// TODO: Create shared libraries for managing gemState, etc. 
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

// The gemState is represented as an array of 16 integers,
// where each integer represents the state of a "gem"
const GEM_STATE_LENGTH = 16;

// The range of gemState values that map to the color wheel
// (e.g. 8 means values 1-8 map to the color wheel, and 0 is off)
const GEM_APP_TOGGLE_RANGE = 8; 

// ES6 type module syntax
export const handler = async (event) => {
  // console.log("Received event:", JSON.stringify(event, null, 2));
  // console.log(process.env);

  // Note that we expect a JSON body with:
  //  {
  //      "type": "toggle",
  //         "e": "keydown" OR "dblclick",
  //       "num": 0-15
  //  }
  // AND that the client has already sent a "hello" message to associate its connectionId with a gemId.
  const connectionId = event.requestContext.connectionId;

  // TODO: Reimplement in TypeScript with proper types, and properly validate and sanitize all inputs.
  // Currently we are not handling when num is undefined resulting in toggling all bits (BUG)
  const num = JSON.parse(event.body).num;
  const eventType = JSON.parse(event.body).e;

  const currentTimeMillis = Date.now();

  // TODO: One day replace DynamoDB with a more suitable database for CONNECTIONS_TABLE such as Redis or ElastiCache for lower latency and higher throughput. 
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

  // 2. Toggle the gemId's gemState in the GEM_STATE_TABLE for given num
  // 2.1 First, get the current gemState for the gemId
  let gemState;
  try {
    const getResult = await ddbDocClient.send(
      new GetCommand({
        TableName: GEM_STATE_TABLE,
        Key: { gemId: gemId },
        // BUG-FIX: Critical that we read the latest gemState after writes
        // Default false. A read may briefly return stale data for up to ~1 second after a write. 
        // Setting to true to ensure we get the latest data. It costs 2x read capacity units.
        ConsistentRead: true,
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
  
  // 2.2 Compute the new gemState: increment the value at num and wrap around at GEM_APP_TOGGLE_RANGE
  if(eventType === "dblclick") {
    // On double click, turn off the gem (set to 0)
    gemState[num] = 0;
  } else {
    // On keydown (single click), increment the gem state
    gemState[num] = (gemState[num] + 1) % GEM_APP_TOGGLE_RANGE; 
  }
  
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

  // TODO: Reimplement JSON-based messaging protocol as a more efficient binary protocol (encoded as base64 for API Gateway transport) to reduce message size and parsing overhead on the client.
  // 2.4 Build the update JSON message to send to all connected clients

  // Iterate through gemState and create a coresponding 24-bit RGB array
  const gemStateRGBArray = [];
  for (let i = 0; i < GEM_STATE_LENGTH; i++) {
    if (gemState[i] == 0) {
      // If the gemState is Off, push [0, 0, 0] to gemStateRGBArray
      gemStateRGBArray.push([0, 0, 0]);
      continue;
    }
    gemStateRGBArray.push(keyColorCss(gemState[i]-1, GEM_APP_TOGGLE_RANGE));
  } 

  // Convert gemStateRGBArray to a binary gemStateBuf of length 16*3 = 48 bytes
  const gemStateBuf = new Uint8Array(GEM_STATE_LENGTH * 3);
  for (let i = 0; i < GEM_STATE_LENGTH; i++) {
    gemStateBuf.set(gemStateRGBArray[i], i * 3);
  }

  // Convert currentTimeMillis to a binary buffer of length 8 bytes (Big Endian)
  // Note: 40% less data to transmit and skip string parsing on clients compared to sending as ISO string
  const currentTimeMillisBuf = Buffer.alloc(8);
  currentTimeMillisBuf.writeBigUInt64BE(BigInt(currentTimeMillis));

  const updateMsg = {
    type: "update",
    gemState: Buffer.from(gemStateBuf).toString('base64'),
    ts: Buffer.from(currentTimeMillisBuf).toString('base64'),
  };
  const updateMsgStr = JSON.stringify(updateMsg);

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
        // // Default false. A read may briefly return stale data for up to ~1 second after a write. 
        // // Setting to true to ensure we get the latest data. It costs 2x read capacity units.
        // ConsistentRead: true,
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
      // so we need to encode our binary gemStateBuf as a base64 string and decode it on the client side.
      // See: https://docs.aws.amazon.com/apigateway/latest/developerguide/websocket-api-develop-binary-media-types.html
      // See: https://repost.aws/questions/QUtbrnTNl6RJeseAE6ZCzx9Q/api-gateway-websocket-binary-frames
      const postCmd = new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: updateMsgStr,
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
