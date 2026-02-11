import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

export { PostToConnectionCommand };

// Creates an API Gateway Management client.
// Pass { endpoint } directly, OR { requestContext } to derive the endpoint from a WebSocket event.

// NOTE: AWS API Gateway WebSocket APIs does not support binary messaging! it only can send/receive text frames!
// so we need to encode our binary gemStateBuf as a base64 string and decode it on the client side.
// See: https://docs.aws.amazon.com/apigateway/latest/developerguide/websocket-api-develop-binary-media-types.html
// See: https://repost.aws/questions/QUtbrnTNl6RJeseAE6ZCzx9Q/api-gateway-websocket-binary-frames
// TODO: Reimplement JSON-based messaging protocol as a more efficient binary protocol (encoded as base64 for API Gateway transport) to reduce message size and parsing overhead on the client. 
export function createWsClient({ endpoint, requestContext } = {}) {
  if (!endpoint && requestContext) {
    endpoint = `https://${requestContext.apiId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/${requestContext.stage}`;
  }
  return new ApiGatewayManagementApiClient({ endpoint });
}
