#!/bin/sh
set -eu

WORKFLOW_PATH="/opt/marketmind/workflows/publishing-v1.json"
WORKFLOW_ID="4wO2sifqyuZMAht9"

if [ ! -f "$WORKFLOW_PATH" ]; then
  echo "Publishing workflow is missing at $WORKFLOW_PATH" >&2
  exit 1
fi

# The checked-in workflow has a stable id, so importing it updates the same
# record on every container start instead of creating duplicate workflows.
n8n import:workflow --input="$WORKFLOW_PATH"
n8n publish:workflow --id="$WORKFLOW_ID"

exec /docker-entrypoint.sh start
