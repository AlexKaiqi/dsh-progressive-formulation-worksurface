#!/usr/bin/env bash
set -euo pipefail

# Orchestrator-side bridge script.
# Run it through run_orchestrator, not directly in a normal shell.
#
# It checks out the current WorkSurface revision through the authenticated
# ws CLI (the canonical path is never opened), assembles a snapshot inside the
# orchestrator-writable attempt dir, and prints two sentinel lines on stdout:
#
#   BRIDGE_ATTEMPT_DIR=<attempt dir>
#   BRIDGE_OUT_FILE=<assembled artifact>
#
# Keep stdout clean: only these two lines may go to stdout. Diagnostic output
# (including ws checkout) is redirected to stderr so the outer shell can parse
# the hand-off reliably.

SURFACE="${WS_ROOT_SURFACE:?run_orchestrator must set WS_ROOT_SURFACE}"
ATTEMPT_DIR="${WS_ATTEMPT_DIR:?run_orchestrator must set WS_ATTEMPT_DIR}"

# Optional pinned revision. Leave empty to use the latest head, which is the
# desired behavior for "regenerate snapshot after every WorkSurface update".
REVISION="${WS_SNAPSHOT_REVISION:-}"

WORK_ROOT="$ATTEMPT_DIR/work"
CHECKOUT="$WORK_ROOT/checkout"
RESULTS_DIR="$ATTEMPT_DIR/results"
OUT_FILE="$RESULTS_DIR/snapshot.md"

rm -rf "$CHECKOUT"
mkdir -p "$WORK_ROOT" "$RESULTS_DIR"

# Materialize the surface through the authenticated Host socket.
if [ -n "$REVISION" ]; then
  ws checkout "$SURFACE" "$CHECKOUT" --revision "$REVISION" >&2
else
  ws checkout "$SURFACE" "$CHECKOUT" >&2
fi

# ---------------------------------------------------------------------------
# Assemble the snapshot from "$CHECKOUT".
#
# This default assembly concatenates all regular files in the checkout with
# simple text headers. Replace this block with your real assembly logic when
# you need a different snapshot format.
# ---------------------------------------------------------------------------
(
  echo "# WorkSurface Snapshot"
  echo
  echo "- surface: \`$SURFACE\`"
  if [ -n "$REVISION" ]; then
    echo "- revision: \`$REVISION\`"
  fi
  echo "- generated_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo

  cd "$CHECKOUT"
  find . -type f -not -path './.git/*' | sort | while IFS= read -r file; do
    rel="${file#./}"
    printf '## %s\n\n```\n' "$rel"
    cat "$file"
    printf '```\n\n'
  done
) > "$OUT_FILE"

# Bridge hand-off. Keep stdout clean: only these two lines.
echo "BRIDGE_ATTEMPT_DIR=$ATTEMPT_DIR"
echo "BRIDGE_OUT_FILE=$OUT_FILE"
