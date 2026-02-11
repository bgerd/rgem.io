import { ddbDocClient } from "/opt/nodejs/ddb.js";
import { createWsClient, PostToConnectionCommand } from "/opt/nodejs/ws-client.js";
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";

const { CONNECTIONS_TABLE } = process.env;

export const handler = async (event) => {
  // Keep this handler ultra-lightweight: no DynamoDB scans, no side effects.
  const connectionId = event.requestContext.connectionId;

  const apiGateway = createWsClient({ requestContext: event.requestContext });
  // Note: Ping/Pong is only sent/expected by Frontend clients and not Hardware clients.
  try {
    await apiGateway.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({ type: "pong" }),
      })
    );
  } catch (err) {
    // If the connection is stale (e.g., the client has disconnected), we delete it from the DynamoDB table
    if (err.statusCode === 410) {
      console.log(`Found stale connection, deleting ${connectionId}`);
      await ddbDocClient.send(
        new DeleteCommand({
          TableName: CONNECTIONS_TABLE,
          Key: { connectionId },
        })
      );
    } else {
      console.log("Failed to post to connection:", err);
      throw err;
    }
  }

  // IMPORTANT: returning 200 does not deliver the pong; PostToConnection above does.
  return { statusCode: 200, body: "Pong sent." };
};
