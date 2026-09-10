#!/bin/bash
# Restart the DSH host that owns the WorkSurface runtime bridge for a profile.
#
# WHEN TO USE
#   Some WorkSurface artifacts are loaded into the DSH host process only at boot:
#     - @pf-worksurface/dsh  lib (session admission, orchestration engine)
#     - @pf-worksurface/web  client.js bundle (browser GUI client)
#     - @pf-worksurface/web  index.js (server API)
#   After replacing them in the installed profile node_modules you must restart
#   this host. By contrast, @pf-worksurface/web styles.css is read per-request,
#   so style-only changes need only a browser hard refresh, no restart.
#
# HOW IT WORKS / WHY IT CAN RUN FROM AN AGENT SESSION
#   A plain bash script spawned inside an agent session is a direct child of
#   the host process; the moment it kills the host, the host's teardown kills
#   the script's whole process tree before the replacement can start. This
#   script therefore delegates the kill+restart to a Python daemon that
#   double-forks and calls os.setsid(), moving into a brand-new session and
#   process group owned by launchd (PID 1) — outside the host's tree — so it
#   survives the host death and can start the replacement. If it still fails,
#   run the same command from a normal terminal (the daemon detach is then not
#   even needed): everything is logged to /tmp/dsh-host-restart-<profile>.log,
#   including the new host pid and any start errors.
#
# USAGE
#   bash scripts/restart-host.sh [profile] [port]
#     profile  default: worksurface-full-promptfix-20260909
#     port     default: 3800
#   Optional env: WS_RESTART_GRACE=<seconds> delay before the old host is
#   killed (default 15), so the caller's final reply can be delivered first.
set -u
PROFILE="${1:-worksurface-full-promptfix-20260909}"
PORT="${2:-3800}"
DSH_BIN="${DSH_BIN:-$(command -v dsh || printf '%s' /Users/kaiqidong/.local/bin/dsh)}"
MARKER="dsh --profile ${PROFILE} --port ${PORT}"
LOG="/tmp/dsh-host-restart-${PROFILE}.log"
GRACE="${WS_RESTART_GRACE:-15}"

export PROFILE PORT DSH_BIN MARKER LOG GRACE
python3 - <<'PY'
import os
import re
import subprocess
import sys
import time

# --- daemonize: survive the host teardown -----------------------------------
# The caller shell is a direct child of the host. Move into a new session and
# process group (owned by launchd after double-fork) so this restarter is NOT
# part of the host's process tree and is not killed when the host dies.
if os.fork() > 0:
    sys.exit(0)  # parent (the bash wrapper) returns immediately
os.setsid()
if os.fork() > 0:
    sys.exit(0)  # first child exits; grandchild is the daemon
devnull = os.open(os.devnull, os.O_RDWR)
for fd in (0, 1, 2):
    os.dup2(devnull, fd)

profile = os.environ["PROFILE"]
port = os.environ["PORT"]
dsh_bin = os.environ["DSH_BIN"]
marker = os.environ["MARKER"]
log_path = os.environ["LOG"]
grace = float(os.environ.get("GRACE", "15"))


def logline(message):
    with open(log_path, "a", encoding="utf-8") as fh:
        fh.write(f"[{time.strftime('%F %T')}] {message}\n")


def find_old_pid():
    out = subprocess.run(["ps", "aux"], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if marker not in line:
            continue
        if "grep" in line or "restart-host" in line or "python3" in line:
            continue
        match = re.match(r"^\S+\s+(\d+)", line)
        if match:
            return int(match.group(1))
    return None


time.sleep(grace)  # let the caller's final reply be delivered first

old = find_old_pid()
logline(f"restarting {profile} on :{port}; old pid={old}")
if old is not None:
    try:
        os.kill(old, 15)
    except ProcessLookupError:
        pass
    for _ in range(40):
        try:
            os.kill(old, 0)
        except ProcessLookupError:
            break
        time.sleep(0.5)
time.sleep(1)

with open(log_path, "a", encoding="utf-8") as log_fh:
    proc = subprocess.Popen(
        ["node", dsh_bin, "--profile", profile, "--port", port, "--no-open"],
        stdout=log_fh,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
logline(f"new host pid={proc.pid}")
PY
exit 0
