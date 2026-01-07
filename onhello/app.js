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

  // Validate gemId
  if (!gemId) {
    return {
      statusCode: 400,
      body: "Invalid request: gemId is required.",
    };
  }

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

  // iterate through all bits of gemState and create a coresponding 24-bit array of length 16
  // with RGB values for each bit (0 = black, 1 = magenta)
  const gemStateArray = [];
  for (let i = 0; i < 16; i++) {
    const bit = (gemState >> i) & 1;
    // TODO: Confirm RGB byte-order is correct for HW implementation
    gemStateArray.push(bit === 1 ? [128, 0, 128] : [0, 0, 0]);
  } 

  // convert gemStateArray to a binary payload of length 16*3 = 48 bytes
  const payload = new Uint8Array(48);
  for (let i = 0; i < 16; i++) {
    payload.set(gemStateArray[i], i * 3);
  }

  // console.log('gemStateArray', gemStateArray);
  // console.log('payload', payload);
  // console.log('payload instanceof Uint8Array', payload instanceof Uint8Array);
  // console.log('Buffer.isBuffer(payload)', Buffer.isBuffer(payload));
  // console.log('byteLength', Buffer.from(payload).byteLength);

  // 3. Post current gemState to connectionId
  const apiGateway = new ApiGatewayManagementApiClient({
    // The endpoint is intentionally constructed using the API ID and stage from the event to account for custom domains
    endpoint: `https://${event.requestContext.apiId}.execute-api.${AWS_REGION}.amazonaws.com/${event.requestContext.stage}`,
  });
try {
    // NOTE: AWS API Gateway WebSocket APIs does not support binary messaging! it only can send/receive text frames!
    // so we need to encode our binary payload as a base64 string and decode it on the client side.
    // See: https://docs.aws.amazon.com/apigateway/latest/developerguide/websocket-api-develop-binary-media-types.html
    // See: https://repost.aws/questions/QUtbrnTNl6RJeseAE6ZCzx9Q/api-gateway-websocket-binary-frames
    await apiGateway.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        // TODO: Reimplement JSON-based messaging protocol as a more efficient binary protocol (encoded as base64 for API Gateway transport) to reduce message size and parsing overhead on the client.

        Data: JSON.stringify({
          type: "update",
          gemState: Buffer.from(payload).toString('base64'),
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
