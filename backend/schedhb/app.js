import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDocClient } from "/opt/nodejs/ddb.js";
import { createWsClient } from "/opt/nodejs/ws-client.js";
import { postToConnection } from "/opt/nodejs/ws-broadcast.js";

const { CONNECTIONS_TABLE, WS_API_ENDPOINT } = process.env;

const apiGateway = createWsClient({ endpoint: WS_API_ENDPOINT });

// Handler for the scheduled heartbeat function
// This function scans the CONNECTIONS_TABLE for all connected clients and sends a heartbeat message to each
// If a connection is stale (e.g., the client has disconnected), it deletes the connection
// from the DynamoDB table.
// This function is triggered by a CloudWatch Events rule specified in the template.yaml file
export const handler = async (event) => {

  // 1. Scan CONNECTIONS_TABLE to find all connected clients
  let connectedClients;
  try {
    connectedClients = (await ddbDocClient.send(
      new ScanCommand({
        TableName: CONNECTIONS_TABLE,
        ProjectionExpression: "connectionId",
      })
    )).Items;
  } catch (e) {
    console.log("Failed to scan CONNECTIONS_TABLE:", e);
    return {
      statusCode: 500,
      body: "Failed to scan CONNECTIONS_TABLE: " + JSON.stringify(e),
    };
  }

  console.log("Found connected clients:", connectedClients.length);

  // 2. Broadcast a 'hb' message to all connected clients, no response is expected
  // Note: that the api gateway's 10min idle connection timeout timers are reset by
  // successfully sending/receiving any websocket frame.
  // Note: only clients that have send "hello" will receive this heartbeat, per onhello/app.js handler
  const hbMsg = JSON.stringify({ type: "hb" });
  const postCalls = connectedClients.map(async ({ connectionId }) => {
    console.log(`Sending heartbeat to connectionId: ${connectionId}`);
    await postToConnection(apiGateway, connectionId, hbMsg, CONNECTIONS_TABLE);
  });

  try {
    await Promise.all(postCalls);
  } catch (e) {
    return { statusCode: 500, body: e.stack };
  }

  return { statusCode: 200, body: "Data sent." };
};
