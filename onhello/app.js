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

export const handler = async (event) => {

  console.log("Received event:", JSON.stringify(event, null, 2));
  console.log(process.env);

  // Note that we expect a JSON body with: { "type": "hello", "gemId": "some-gemId" }
  const connectionId = event.requestContext.connectionId;
  const gemId = JSON.parse(event.body).gemId;

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
      })
    );
    if (!getResult.Item) {
      // If the gemState for gemId does not exist, initialize it to zero
      const zeroState = 0;
      await ddbDocClient.send(
        new PutCommand({
          TableName: GEM_STATE_TABLE,
          Item: {
            gemId: gemId,
            gemState: zeroState,
          },
        })
      );
      gemState = zeroState;
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

  // 3. Post current gemState to connectionId
  const apigwManagementApi = new ApiGatewayManagementApiClient({
    // The endpoint is intentionally constructed using the API ID and stage from the event to account for custom domains
    endpoint: `https://${event.requestContext.apiId}.execute-api.${AWS_REGION}.amazonaws.com/${event.requestContext.stage}`,
  });
  try {
    await apigwManagementApi.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({
          type: "update",
          gemState: gemState,
        }),
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
