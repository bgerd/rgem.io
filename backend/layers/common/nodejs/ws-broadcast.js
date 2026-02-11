import { DeleteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { PostToConnectionCommand } from "/opt/nodejs/ws-client.js";
import { ddbDocClient } from "/opt/nodejs/ddb.js";

// Sends data to a single connection. If the connection is stale (410),
// deletes it from the connections table.
export async function postToConnection(wsClient, connectionId, data, connectionsTable) {
  try {
    await wsClient.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: data,
      })
    );
  } catch (err) {
    if (err.statusCode === 410) {
      console.log(`Found stale connection, deleting ${connectionId}`);
      await ddbDocClient.send(
        new DeleteCommand({
          TableName: connectionsTable,
          Key: { connectionId },
        })
      );
    } else {
      throw err;
    }
  }
}

// Scans for all connections associated with a gemId and broadcasts data to each.
export async function broadcastToGem(wsClient, gemId, data, connectionsTable) {
  // TODO: Replace DynamoDB with a more suitable database for connectionsTable such as Redis or ElastiCache for lower latency and higher throughput.  
  const { Items } = await ddbDocClient.send(
    new ScanCommand({
      TableName: connectionsTable,
      FilterExpression: "gemId = :gemId",
      ExpressionAttributeValues: { ":gemId": gemId },
      ProjectionExpression: "connectionId",
    })
  );

  await Promise.all(
    Items.map(({ connectionId }) =>
      postToConnection(wsClient, connectionId, data, connectionsTable)
    )
  );
}
