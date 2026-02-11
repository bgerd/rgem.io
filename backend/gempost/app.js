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

import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDocClient } from "/opt/nodejs/ddb.js";
import { createWsClient } from "/opt/nodejs/ws-client.js";
import { broadcastToGem } from "/opt/nodejs/ws-broadcast.js";
import { GEM_STATE_LENGTH, GEM_APP_TOGGLE_RANGE, buildUpdateMessage } from "/opt/nodejs/gem-state.js";

const { CONNECTIONS_TABLE, GEM_STATE_TABLE, WS_API_ENDPOINT } = process.env;

const websocketApiGateway = createWsClient({ endpoint: WS_API_ENDPOINT });

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

  // Upsert the gemState in the GEM_STATE_TABLE
  // Use the clamped parsed body as the new gemState
  let gemState = clamped;
  try {
    await ddbDocClient.send(
      new PutCommand({
        TableName: GEM_STATE_TABLE,
        Item: { gemId, gemState },
      })
    );
  } catch (err) {
    console.log("Failed to put into GEM_STATE_TABLE:", err);
    return {
      statusCode: 500,
      body: "Failed to put into GEM_STATE_TABLE: " + JSON.stringify(err),
    };
  }

  // Build and broadcast the update message to all connected clients for this gemId
  const updateMsgStr = buildUpdateMessage(gemState, currentTimeMillis);

  try {
    await broadcastToGem(websocketApiGateway, gemId, updateMsgStr, CONNECTIONS_TABLE);
  } catch (err) {
    return { statusCode: 500, body: err.stack };
  }

  // Return the parsed body as the response
  return {
    statusCode: 200,
    body: JSON.stringify(responseBody),
  };
};
