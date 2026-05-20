#!/usr/bin/env python
"""
SessionEnd hook: clean up per-session skill-gate flag files.

Removes any `~/.claude/state/*-loaded-<session_id>` files for the ending
session. Pattern is generic — any skill-gate using the same naming
convention (see pre-tool-ncu-deploy-gate.py and the
skill-load-gate-via-pre-tool-use-hook knowledge file) gets free cleanup.

Reliable for graceful terminations (/exit, /clear, IDE close, logout,
prompt_input_exit). Hard crashes may leave residue, but the flag files
are 0 bytes; a periodic sweep or operator-side `rm` covers that edge.
"""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

try:
    payload = json.load(sys.stdin)
except json.JSONDecodeError:
    sys.exit(0)

session_id = payload.get("session_id", "")
if not session_id:
    sys.exit(0)

state_dir = Path.home() / ".claude" / "state"
if not state_dir.is_dir():
    sys.exit(0)

# Glob matches any prefix — future skill-gates using *-loaded-<sid> naming
# inherit cleanup without touching this hook.
for flag in state_dir.glob(f"*-loaded-{session_id}"):
    try:
        flag.unlink()
    except OSError:
        # Race or permission glitch — silent best-effort.
        pass

sys.exit(0)
