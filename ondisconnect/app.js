import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const { CONNECTIONS_TABLE } = process.env;

export const handler = async (event) => {
  const deleteParams = {
    TableName: CONNECTIONS_TABLE,
    Key: {
      connectionId: event.requestContext.connectionId
    }
  };
  const delCmd = new DeleteCommand(deleteParams);

  try {
    await ddbDocClient.send(delCmd);
  } catch (err) {
    return { statusCode: 500, body: 'Failed to delete from CONNECTIONS_TABLE: ' + JSON.stringify(err) };
  }

  return { statusCode: 200, body: 'Disconnected.' };
};