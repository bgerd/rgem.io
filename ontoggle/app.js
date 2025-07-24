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

// ES6 type module syntax
export const handler = async (event) => {
  // console.log("Received event:", JSON.stringify(event, null, 2));
  // console.log(process.env);

  // Note that we expect a JSON body with: { "type": "toggle", "idx": 0-15 }
  // AND that the client has already sent a "hello" message to associate its connectionId with a gemId.
  const connectionId = event.requestContext.connectionId;
  const idx = JSON.parse(event.body).idx;

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

  // 2. Toggle the gemId's gemState in the GEM_STATE_TABLE for given idx
  // 2.1 First, get the current gemState for the gemId
  let gemState;
  try {
    const getResult = await ddbDocClient.send(
      new GetCommand({
        TableName: GEM_STATE_TABLE,
        Key: { gemId: gemId },
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
  
  // 2.2 Compute the new gemState using bitwise XOR
  console.log(`Current gemState: ${gemState}, toggling idx: ${idx}`);
  gemState = gemState ^ (1 << idx);
  console.log(`New gemState: ${gemState}`);

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
      })
    );
  } catch (e) {
    console.log("Failed to scan CONNECTIONS_TABLE:", e);
    return {
      statusCode: 500,
      body: "Failed to scan CONNECTIONS_TABLE: " + JSON.stringify(e),
    };
  }

  // 4. Broadcast the updated gemState to all connected clients
  const apigwManagementApi = new ApiGatewayManagementApiClient({
    // The endpoint is intentionally constructed using the API ID and stage from the event to account for custom domains
    endpoint: `https://${event.requestContext.apiId}.execute-api.${AWS_REGION}.amazonaws.com/${event.requestContext.stage}`,
  });
  const postCalls = connectedClients.Items.map(async ({ connectionId }) => {
    try {
      const postCmd = new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({
          type: "update",
          gemState: gemState,
        }),
      });
      await apigwManagementApi.send(postCmd);
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
        console.log("Failed to delete from CONNECTIONS_TABLE:", err);
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
