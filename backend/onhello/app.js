import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDocClient } from "/opt/nodejs/ddb.js";
import { createWsClient, PostToConnectionCommand } from "/opt/nodejs/ws-client.js";
import { GEM_STATE_LENGTH, buildUpdateMessage } from "/opt/nodejs/gem-state.js";

const { CONNECTIONS_TABLE, GEM_STATE_TABLE } = process.env;

export const handler = async (event) => {
  // Note that we expect a JSON body with: { "type": "hello", "gemId": "some-gemId" }
  const connectionId = event.requestContext.connectionId;
  const gemId = JSON.parse(event.body).gemId;
  const currentTimeMillis = Date.now();

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
        Item: { connectionId, gemId },
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
        Key: { gemId },
        // BUG-FIX: Critical that we read the latest gemState after writes
        // Default false. A read may briefly return stale data for up to ~1 second after a write.
        // Setting to true to ensure we get the latest data. It costs 2x read capacity units.
        ConsistentRead: true,
      })
    );
    if (!getResult.Item) {
      // Setup initial empty gemState array
      // NOTE:BUILD: MUST clear GEM_STATE_TABLE whenever the structure of gemState changes!
      gemState = new Array(GEM_STATE_LENGTH).fill(0);

      await ddbDocClient.send(
        new PutCommand({
          TableName: GEM_STATE_TABLE,
          Item: { gemId, gemState },
        })
      );
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
  const apiGateway = createWsClient({ requestContext: event.requestContext });
  const updateMsgStr = buildUpdateMessage(gemState, currentTimeMillis);

  try {
    await apiGateway.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: updateMsgStr,
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
