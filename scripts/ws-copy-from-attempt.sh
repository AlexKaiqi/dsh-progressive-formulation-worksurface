#!/usr/bin/env bash
set -euo pipefail

# Outer-shell side of the bridge.
#
# It reads the stdout produced by run_orchestrator (stdin, or from a file), and
# copies the assembled artifact from the ephemeral attempt dir back into a real
# working directory.
#
# Usage:
#   run_orchestrator ... | ws-copy-from-attempt.sh <destination-dir>
#   ws-copy-from-attempt.sh <destination-dir> <run-orchestrator-stdout-file>
#   ws-copy-from-attempt.sh --name snapshot.md <destination-dir>
#
# The caller should still check the run_orchestrator result first:
#   exitCode == 0 and no error before this script is called.

usage() {
  echo "usage: $0 [--name <filename>] <destination-dir> [stdout-file]" >&2
}

NAME=""
DEST=""
STDOUT_FILE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --name)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      NAME="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [ -z "$DEST" ]; then
        DEST="$1"
      elif [ -z "$STDOUT_FILE" ]; then
        STDOUT_FILE="$1"
      else
        usage
        exit 2
      fi
      shift
      ;;
  esac
done

if [ -z "$DEST" ]; then
  usage
  exit 2
fi

if [ -n "$STDOUT_FILE" ]; then
  SOURCE_STDOUT="$(cat "$STDOUT_FILE")"
else
  SOURCE_STDOUT="$(cat)"
fi

ATTEMPT_DIR="$(printf '%s\n' "$SOURCE_STDOUT" | sed -n 's/^BRIDGE_ATTEMPT_DIR=//p' | tail -1)"
OUT_FILE="$(printf '%s\n' "$SOURCE_STDOUT" | sed -n 's/^BRIDGE_OUT_FILE=//p' | tail -1)"

if [ -z "$ATTEMPT_DIR" ] || [ -z "$OUT_FILE" ]; then
  echo "bridge hand-off not found in run_orchestrator stdout; did the orchestrator script run successfully?" >&2
  exit 1
fi

# Safety: only copy artifacts that live inside the reported attempt dir.
case "$OUT_FILE" in
  "$ATTEMPT_DIR"/*) ;;
  *)
    echo "refusing to copy outside attempt dir: $OUT_FILE" >&2
    exit 1
    ;;
esac

if [ ! -f "$OUT_FILE" ]; then
  echo "bridge artifact not found: $OUT_FILE" >&2
  exit 1
fi

mkdir -p "$DEST"
DEST_FILE="$DEST/${NAME:-$(basename "$OUT_FILE")}"
cp -p "$OUT_FILE" "$DEST_FILE"
printf 'copied %s -> %s\n' "$OUT_FILE" "$DEST_FILE"
