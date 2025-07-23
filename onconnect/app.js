import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const { CONNECTIONS_TABLE } = process.env;

export const handler = async (event) => {
  const putParams = {
    TableName: CONNECTIONS_TABLE,
    Item: {
      connectionId: event.requestContext.connectionId
    }
  };
  const putCmd = new PutCommand(putParams);

  try {
    await ddbDocClient.send(putCmd);
  } catch (err) {
    return { statusCode: 500, body: 'Failed to put into CONNECTIONS_TABLE: ' + JSON.stringify(err) };
  }

  return { statusCode: 200, body: 'Connected.' };
};
