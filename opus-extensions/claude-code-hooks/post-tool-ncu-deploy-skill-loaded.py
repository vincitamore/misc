#!/usr/bin/env python
"""
PostToolUse hook: mark the /ncu-deploy skill as loaded for this session.

Pairs with pre-tool-ncu-deploy-gate.py — once the skill has been invoked,
the gate opens for the rest of the session.

State file: ~/.claude/state/ncu-deploy-loaded-<session_id>.
"""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

try:
    payload = json.load(sys.stdin)
except json.JSONDecodeError:
    sys.exit(0)

tool_name = payload.get("tool_name", "")
tool_input = payload.get("tool_input", {}) or {}
session_id = payload.get("session_id", "unknown")

if tool_name != "Skill":
    sys.exit(0)

skill = tool_input.get("skill", "") or ""
if skill != "ncu-deploy":
    sys.exit(0)

state_dir = Path.home() / ".claude" / "state"
state_dir.mkdir(parents=True, exist_ok=True)
flag_file = state_dir / f"ncu-deploy-loaded-{session_id}"
flag_file.touch(exist_ok=True)

sys.exit(0)
