import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDocClient } from "/opt/nodejs/ddb.js";
import { createWsClient } from "/opt/nodejs/ws-client.js";
import { broadcastToGem } from "/opt/nodejs/ws-broadcast.js";
import { GEM_APP_TOGGLE_RANGE, buildUpdateMessage } from "/opt/nodejs/gem-state.js";

const { CONNECTIONS_TABLE, GEM_STATE_TABLE } = process.env;

// ES6 type module syntax
export const handler = async (event) => {
  // Note that we expect a JSON body with:
  //  {
  //      "type": "toggle",
  //         "e": "keydown" OR "dblclick",
  //       "num": 0-15
  //  }
  // AND that the client has already sent a "hello" message to associate its connectionId with a gemId.
  const connectionId = event.requestContext.connectionId;

  // TODO: Reimplement in TypeScript with proper types, and properly validate and sanitize all inputs.
  // Currently we are not handling when num is undefined resulting in toggling all bits (BUG)
  const num = JSON.parse(event.body).num;
  const eventType = JSON.parse(event.body).e;

  const currentTimeMillis = Date.now();

  // 1. Look up the gemId associated with this connectionId in the CONNECTIONS_TABLE
  let gemId;
  try {
    const getResult = await ddbDocClient.send(
      new GetCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId },
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

  // 2. Toggle the gemId's gemState in the GEM_STATE_TABLE for given num
  // 2.1 First, get the current gemState for the gemId
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

  // 2.2 Compute the new gemState: increment the value at num and wrap around at GEM_APP_TOGGLE_RANGE
  if(eventType === "dblclick") {
    // On double click, turn off the gem (set to 0)
    gemState[num] = 0;
  } else {
    // On keydown (single click), increment the gem state
    gemState[num] = (gemState[num] + 1) % GEM_APP_TOGGLE_RANGE;
  }

  // 2.3 Update the gemState in the GEM_STATE_TABLE
  try {
    await ddbDocClient.send(
      new PutCommand({
        TableName: GEM_STATE_TABLE,
        Item: { gemId, gemState },
      })
    );
  } catch (err) {
    console.log("Failed to put into GEM_STATE_TABLE:", err);
    return {
      statusCode: 500,
      body: "Failed to put into GEM_STATE_TABLE: " + JSON.stringify(err),
    };
  }

  // 3. Broadcast the updated gemState to all connected clients for this gemId
  const wsClient = createWsClient({ requestContext: event.requestContext });
  const updateMsgStr = buildUpdateMessage(gemState, currentTimeMillis);

  try {
    await broadcastToGem(wsClient, gemId, updateMsgStr, CONNECTIONS_TABLE);
  } catch (err) {
    return { statusCode: 500, body: err.stack };
  }

  return { statusCode: 200, body: "Data sent." };
};
