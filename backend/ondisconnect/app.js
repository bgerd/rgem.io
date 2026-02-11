import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDocClient } from "/opt/nodejs/ddb.js";

const { CONNECTIONS_TABLE } = process.env;

export const handler = async (event) => {
  try {
    await ddbDocClient.send(
      new DeleteCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId: event.requestContext.connectionId },
      })
    );
  } catch (err) {
    return { statusCode: 500, body: 'Failed to delete from CONNECTIONS_TABLE: ' + JSON.stringify(err) };
  }

  return { statusCode: 200, body: 'Disconnected.' };
};
