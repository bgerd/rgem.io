/**
 * AWS Lambda handler for processing POST requests to /gem/{gemId}.
 * 
 * This function performs the following tasks:
 * 1. Extracts the `gemId` from the path parameters.
 * 2. Parses the request body to retrieve the new `gemState`.
 * 3. Validates and clamps the `gemState` values to a defined range.
 * 4. Upserts the `gemState` into the `GEM_STATE_TABLE` in DynamoDB.
 * 5. Converts the `gemState` into an RGB array and binary payload.
 * 6. Scans the `CONNECTIONS_TABLE` to find all connected WebSocket clients associated with the `gemId`.
 * 7. Broadcasts the updated `gemState` to all connected WebSocket clients.
 * 8. Handles stale WebSocket connections by removing them from the `CONNECTIONS_TABLE`.
 * 
 * @param {Object} event - The Lambda event object.
 * @param {Object} event.pathParameters - The path parameters from the API Gateway request.
 * @param {string} event.pathParameters.gemId - The ID of the gem being updated.
 * @param {string} event.body - The JSON string representing the new gem state.
 * 
 * @returns {Promise<Object>} - The HTTP response object.
 * @property {number} statusCode - The HTTP status code of the response.
 * @property {string} body - The JSON stringified response body containing the `gemId` and echoed `gemState`.
 * 
 * @throws {Error} - Returns a 400 status code for missing or invalid input, 
 *                   and a 500 status code for internal server errors.
 */
// gempost/app.js

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  // GetCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

const { CONNECTIONS_TABLE, GEM_STATE_TABLE, WS_API_ENDPOINT, AWS_REGION } = process.env;

const ddbClient = new DynamoDBClient({ region: AWS_REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const websocketApiGateway = new ApiGatewayManagementApiClient({
  endpoint: WS_API_ENDPOINT,
});

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

/* TEST ECHO with curl:
  curl -X POST \
  https://<rest_api_host>/gem/<gemId> \
  -H "Content-Type: application/json" \
  -d "<gemState>"

  Response:
  {
    "gemId": "<gemId>",
    "echo": "<gemState>"
  }

  Ex. <gemState> [ 0, 6, 6, 0, 6, 2, 2, 6, 0, 4, 4, 0, 2, 5, 5, 1 ]
  Ex2. <gemState> [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ]
  Ex3. <gemState> [ 1, 4, 6, 2, 4, 6, 4, 7, 7, 4, 7, 4, 2, 7, 4, 1 ]
*/

// Processes POST requests to /gem/{gemId}
// Expects a JSON body and echoes it back along with the gemId
// Upserts the gemState in GEM_STATE_TABLE using the parsed body as the new gemState
// then broadcasts the current gemState to all connected websocket clients associated with this gemId
export const handler = async (event) => {

  const currentTimeMillis = Date.now();

  // Extract the gemId from pathParameters
  const gemId = event.pathParameters?.gemId;

  // Check if gemId is present
  if (!gemId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Missing gemId in path parameters" }),
    };
  }

  // Extract the request body from the event object
  const requestBody = event.body;

  // For POST requests, the body is typically a JSON string,
  // so we need to parse it.
  let parsedBody;
  try {
    parsedBody = JSON.parse(requestBody);
  } catch (error) {
    console.error("Error parsing JSON:", error);
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Invalid JSON format in request body" }),
    };
  }
  if (!Array.isArray(parsedBody)) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Body must be a JSON array of numbers",
      }),
    };
  }
  if (parsedBody.length !== GEM_STATE_LENGTH) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: `Body must be an array of length ${GEM_STATE_LENGTH}`,
      }),
    };
  }
  // Validate each element is a finite integer; clamp to [0, GEM_APP_TOGGLE_RANGE]
  let clamped;
  try {
    clamped = parsedBody.map((v, i) => {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error(`Index ${i} must be a finite number`);
      }
      if (!Number.isInteger(v)) {
        throw new Error(`Index ${i} must be an integer`);
      }
      return Math.max(0, Math.min(GEM_APP_TOGGLE_RANGE, v));
    });
  } catch (validationErr) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Invalid gemState array",
        detail: String(validationErr),
      }),
    };
  }

  // Construct the response object with gemId and echoed body
  const responseBody = {
    gemId: gemId,
    echo: parsedBody,
  };

  // // First, get the current gemState for the gemId
  // let gemState;
  // try {
  //   const getResult = await ddbDocClient.send(
  //     new GetCommand({
  //       TableName: GEM_STATE_TABLE,
  //       Key: { gemId: gemId },
  //     })
  //   );
  //   gemState = getResult.Item.gemState;
  // } catch (err) {
  //   console.log("Failed to get current gemState from GEM_STATE_TABLE:", err);
  //   return {
  //     statusCode: 500,
  //     body:
  //       "Failed to get current gemState from GEM_STATE_TABLE: " +
  //       JSON.stringify(err),
  //   };
  // }  
  // Upsert the gemState in the GEM_STATE_TABLE
  // Use the clamped parsed body as the new gemState
  let gemState = clamped; 
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
    console.log("Failed to put into GEM_STATE_TABLE:", err);
    return {
      statusCode: 500,
      body: "Failed to put into GEM_STATE_TABLE: " + JSON.stringify(err),
    };
  }

  // TODO: Reimplement JSON-based messaging protocol as a more efficient binary protocol (encoded as base64 for API Gateway transport) to reduce message size and parsing overhead on the client.
  // Build the update JSON message to send to all connected clients

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

  // Scan CONNECTIONS_TABLE to find all connected clients associated with this client's gemId
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

  // Broadcast the updated gemState to all connected clients
  const postCalls = connectedClients.Items.map(async ({ connectionId }) => {
    try {
      const postCmd = new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: updateMsgStr,
      });
      await websocketApiGateway.send(postCmd);
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

  // Return the parsed body as the response
  return {
    statusCode: 200,
    body: JSON.stringify(responseBody), // Re-stringifying for consistency
  };
};