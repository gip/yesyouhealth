#!/usr/bin/env bash
# Build the de-id service image for linux/amd64 and push it in one step.
#
# Run `docker login` (to Docker Hub or your registry) before this script.
#
# --platform linux/amd64 is forced on purpose: arm64 images built on Apple
# Silicon crash on Phala CVM boot with cryptic exec-format errors.
set -euo pipefail
: "${DEID_IMAGE:?set DEID_IMAGE, e.g. export DEID_IMAGE=youruser/deid-service:latest}"
docker buildx build --platform linux/amd64 -t "$DEID_IMAGE" --push .
