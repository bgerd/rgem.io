import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

const { CONNECTIONS_TABLE, AWS_REGION } = process.env;

const ddbClient = new DynamoDBClient({ region: AWS_REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

export const handler = async (event) => {
  // Keep this handler ultra-lightweight: no DynamoDB, no scans, no side effects.
  const connectionId = event.requestContext.connectionId;

  const apiGateway = new ApiGatewayManagementApiClient({
    endpoint: `https://${event.requestContext.apiId}.execute-api.${AWS_REGION}.amazonaws.com/${event.requestContext.stage}`,
  }); // same pattern as hello :contentReference[oaicite:2]{index=2}

  try {
    await apiGateway.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({
          type: "pong",
        }),
      })
    );
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

  // IMPORTANT: returning 200 does not deliver the pong; PostToConnection above does.
  return { statusCode: 200, body: "Pong sent." };
};
