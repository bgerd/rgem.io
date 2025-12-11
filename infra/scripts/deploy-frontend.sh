#!/usr/bin/env bash
set -euo pipefail

ENV_NAME=${1:?Usage: deploy-frontend.sh <env>}

# Validate environment name
case "${ENV_NAME}" in
  dev|stage|prod)
    ;; # ok
  *)
    echo "Error: ENV_NAME must be one of: dev, stage, prod (got: '${ENV_NAME}')" >&2
    exit 1
    ;;
esac

API_HOST="api-${ENV_NAME}.example.com"
WS_HOST="ws-${ENV_NAME}.example.com"

# Build SPA
pushd frontend
VITE_API_BASE_URL="https://${API_HOST}" \
VITE_WS_URL="wss://${WS_HOST}" \
npm install
npm run build
popd

# Bucket name must match your SAM template and sam config
BUCKET="rgem-${ENV_NAME}-frontend-bucket"

aws s3 sync frontend/dist/ "s3://${BUCKET}/" --delete

# Get CloudFront distribution ID from CloudFormation output
DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name "rgem-${ENV_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendDistributionId'].OutputValue" \
  --output text)

aws cloudfront create-invalidation \
  --distribution-id "${DIST_ID}" \
  --paths "/*"
