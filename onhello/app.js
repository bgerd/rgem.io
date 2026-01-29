import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
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

export const handler = async (event) => {
  // console.log("Received event:", JSON.stringify(event, null, 2));
  // console.log(process.env);

  // Note that we expect a JSON body with: { "type": "hello", "gemId": "some-gemId" }
  const connectionId = event.requestContext.connectionId;
  const gemId = JSON.parse(event.body).gemId;
  const currentTimeMillis = Date.now();

  // Validate gemId
  if (!gemId) {
    return {
      statusCode: 400,
      body: "Invalid request: gemId is required.",
    };
  }

  // 1. Associate the connectionId with the gemId in the CONNECTIONS_TABLE
  try {
    await ddbDocClient.send(
      new PutCommand({
        TableName: CONNECTIONS_TABLE,
        Item: {
          connectionId: connectionId,
          gemId: gemId,
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

  // 2. Look up and lazily initialize this gemId's gemState in the GEM_STATE_TABLE
  let gemState;
  try {
    const getResult = await ddbDocClient.send(
      new GetCommand({
        TableName: GEM_STATE_TABLE,
        Key: {
          gemId: gemId,
        },
        // BUG-FIX: Critical that we read the latest gemState after writes
        // Default false. A read may briefly return stale data for up to ~1 second after a write. 
        // Setting to true to ensure we get the latest data. It costs 2x read capacity units.
        ConsistentRead: true,
      })
    );
    if (!getResult.Item) {

      // Setup initial empty gemState array
      // NOTE:BUILD: MUST clear GEM_STATE_TABLE whenever the structure of gemState changes!
      gemState = [];
      for (let i = 0; i < GEM_STATE_LENGTH; i++) {
        gemState.push(0);
      }

      await ddbDocClient.send(
        new PutCommand({
          TableName: GEM_STATE_TABLE,
          Item: {
            gemId: gemId,
            gemState: gemState,
          },
        })
      );
    } else {
      gemState = getResult.Item.gemState;
    }
  } catch (err) {
    console.log("Failed to get or initialize GEM_STATE_TABLE:", err);
    return {
      statusCode: 500,
      body:
        "Failed to get or initialize GEM_STATE_TABLE: " + JSON.stringify(err),
    };
  }
  // TODO: Reimplement JSON-based messaging protocol as a more efficient binary protocol (encoded as base64 for API Gateway transport) to reduce message size and parsing overhead on the client.
  // 2.1 Build the update JSON message to send to all connected clients

  // Iterate through gemState array and
  // create a coresponding 24-bit RGB array
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

  // 3. Post current gemState to connectionId
  const apiGateway = new ApiGatewayManagementApiClient({
    // The endpoint is intentionally constructed using the API ID and stage from the event to account for custom domains
    endpoint: `https://${event.requestContext.apiId}.execute-api.${AWS_REGION}.amazonaws.com/${event.requestContext.stage}`,
  });

  try {
    // NOTE: AWS API Gateway WebSocket APIs does not support binary messaging! it only can send/receive text frames!
    // so we need to encode our binary gemStateBuf as a base64 string and decode it on the client side.
    // See: https://docs.aws.amazon.com/apigateway/latest/developerguide/websocket-api-develop-binary-media-types.html
    // See: https://repost.aws/questions/QUtbrnTNl6RJeseAE6ZCzx9Q/api-gateway-websocket-binary-frames
    await apiGateway.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: updateMsgStr,
      })
    );
  } catch (err) {
    console.log("Failed to post initial gemState to client:", err);
    return {
      statusCode: 500,
      body: "Failed to post initial gemState to client: " + JSON.stringify(err),
    };
  }

  return { statusCode: 200, body: "Connected." };
};
