import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

const { CONNECTIONS_TABLE, WS_API_ENDPOINT, AWS_REGION } = process.env;

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }));
const apiGateway = new ApiGatewayManagementApiClient({
  endpoint: WS_API_ENDPOINT,
});

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
  const postCalls = connectedClients.map(async ({ connectionId }) => {
    try {
      const postCmd = new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({
          type: "hb"
        }),
      });

      console.log(`Sending heartbeat to connectionId: ${connectionId}`);
      
      await apiGateway.send(postCmd);
    } catch (e) {
      // If the connection is stale (e.g., the client has disconnected), we delete it from the DynamoDB table
      if (e.statusCode === 410) {
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
        console.log("Failed to post to connection:", e);
        throw e;
      }
    }
  });

  try {
    await Promise.all(postCalls);
  } catch (e) {
    return { statusCode: 500, body: e.stack };
  }

  return { statusCode: 200, body: "Data sent." };
};
