import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const { GRID_STATE_TABLE } = process.env;

export const handler = async (event) => {

  console.log('Received event:', JSON.stringify(event, null, 2));

  // // Note that we expect a JSON body with:
  // //  { "type": "hello", "setId": "some-set-id" }
  const gridSetId = JSON.parse(event.body).setId;

  //  Look up and lazily initialize this setId's state 16-bit vector in the GRID_STATE_TABLE
  let gridSetState; 
  const gridGetParams = {
    TableName: GRID_STATE_TABLE,
    Key: {
      setId: gridSetId
    }
  };
  const gridGetCmd = new GetCommand(gridGetParams);
  try {
    const gridGetResult = await ddbDocClient.send(gridGetCmd);
    if (!gridGetResult.Item) {
      // If the grid does not exist, initialize to zero-vector
      const zeroState = Array(16).fill(0);
      const gridPutParams = {
        TableName: process.env.GRID_STATE_TABLE,
        Item: {
          setId: gridSetId,
          state: zeroState,
        }
      };
      const gridPutCmd = new PutCommand(gridPutParams);
      await ddbDocClient.send(gridPutCmd);

      gridSetState = zeroState;
    } else {
      gridSetState = gridGetResult.Item.state;
    }

  } catch (err) {
    console.log('Failed to get or initialize GRID_STATE_TABLE:', err);
    return { statusCode: 500, body: 'Failed to get or initialize GRID_STATE_TABLE: ' + JSON.stringify(err) };
  } 

  // 3. Post current state to the client
  const apigwManagementApi = new ApiGatewayManagementApiClient({
    // The endpoint is intentionally constructed using the API ID and stage from the event to account for custom domains
    endpoint: `https://${event.requestContext.apiId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/${event.requestContext.stage}`
  });

  // Td. Compress the gridSetState 16-bit array into an integer 
  const postData = JSON.stringify({
    type: 'state',
    bits: gridSetState,
  });
  const postCmd = new PostToConnectionCommand({
    ConnectionId: event.requestContext.connectionId,
    Data: postData
  });
  try {
    await apigwManagementApi.send(postCmd);
  } catch (err) {
    console.log('Failed to post initial state to client:', err);
    return { statusCode: 500, body: 'Failed to post initial state to client: ' + JSON.stringify(err) };
  }

  return { statusCode: 200, body: 'Connected.' };
};
