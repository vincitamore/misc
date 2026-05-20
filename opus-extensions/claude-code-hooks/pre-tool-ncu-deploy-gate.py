#!/usr/bin/env python
"""
PreToolUse hook: gate ncu-deploy CLI calls behind the /ncu-deploy skill.

Rationale: the skill carries the canonical command surface, JSON envelope shape,
exit codes, gotchas, and platform notes. Calling the CLI without first loading
the skill leads to wrong subcommand guesses and shell-quoting fumbles
(observed 2026-05-14: bare `ncu-deploy servers` instead of `project servers`,
git-bash `.cmd` resolution fail).

Strategy:
- Detect `ncu-deploy` as a whole word in Bash/PowerShell commands.
- Block (exit 2) unless the skill has been loaded this session.
- Companion hook post-tool-ncu-deploy-skill-loaded.py marks the flag when
  the Skill tool invokes ncu-deploy.

State file: ~/.claude/state/ncu-deploy-loaded-<session_id>.
"""

import json
import os
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

# Read the tool invocation envelope.
try:
    payload = json.load(sys.stdin)
except json.JSONDecodeError:
    # Malformed input — fail open (don't break tooling on hook bug).
    sys.exit(0)

tool_name = payload.get("tool_name", "")
tool_input = payload.get("tool_input", {}) or {}
session_id = payload.get("session_id", "unknown")

# Only gate shell tools.
if tool_name not in ("Bash", "PowerShell"):
    sys.exit(0)

command = tool_input.get("command", "") or ""

# Match ncu-deploy ONLY as a command invocation — i.e., followed by whitespace
# and a subcommand arg. This rules out file-path mentions like
# `ls /opt/ncu-deploy.cmd` or `cat .../ncu-deploy-skill-loaded-*`, which are
# diagnostic/maintenance, not actual CLI calls.
# - `\b` word boundary before the name
# - `(?:\.cmd)?` optional Windows wrapper suffix
# - `\s+[a-z-]` followed by whitespace and a subcommand char (letter or
#   leading `-` of a flag like `--version`)
if not re.search(r"\bncu-deploy(?:\.cmd)?\s+[a-z-]", command):
    sys.exit(0)

state_dir = Path.home() / ".claude" / "state"
flag_file = state_dir / f"ncu-deploy-loaded-{session_id}"

if flag_file.exists():
    sys.exit(0)

# Block with guidance for Claude.
print(
    "PreToolUse gate: this command invokes the ncu-deploy CLI but the "
    "/ncu-deploy skill has not been loaded yet this session. "
    "Load it first via the Skill tool (skill='ncu-deploy'), then retry — "
    "it carries the canonical command surface (e.g. `project servers`, "
    "not `servers`), the --json envelope shape, exit-code semantics, "
    "and the vault-session protocol. "
    f"To bypass for an emergency one-off, touch {flag_file} manually.",
    file=sys.stderr,
)
sys.exit(2)
