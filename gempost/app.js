/**
 * AWS Lambda handler for processing POST requests to /gem/{gemId}.
 * 
 * This function performs the following tasks:
 * 1. Extracts the `gemId` from the path parameters.
 * 2. Parses the request body to retrieve the new `gemState`.
 * 3. Upserts the `gemState` into the `GEM_STATE_TABLE` in DynamoDB.
 * 4. Scans the `CONNECTIONS_TABLE` to find all connected WebSocket clients associated with the `gemId`.
 * 5. Broadcasts the updated `gemState` to all connected WebSocket clients.
 * 6. Handles stale WebSocket connections by removing them from the `CONNECTIONS_TABLE`.
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
  GetCommand,
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

/* TEST ECHO with curl:
  curl -X POST \
  https://<api-id>.execute-api.<region>.amazonaws.com/Prod/gem/<gemId> \
  -H "Content-Type: application/json" \
  -d "<gemState>"

  Response:
  {
    "gemId": "<gemId>",
    "echo": "<gemState>"
  }
*/

// Processes POST requests to /gem/{gemId}
// Expects a JSON body and echoes it back along with the gemId
// Upserts the gemState in GEM_STATE_TABLE using the parsed body as the new gemState
// then broadcasts the current gemState to all connected websocket clients associated with this gemId
export const handler = async (event) => {

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
  // Use the parsed body as the new gemState
  let gemState = parsedBody; 
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
        Data: JSON.stringify({
          type: "update",
          gemState: gemState,
        }),
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