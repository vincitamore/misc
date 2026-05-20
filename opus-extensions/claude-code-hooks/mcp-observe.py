#!/usr/bin/env python3
"""
PostToolUse hook: MCP tool invocation observer.

Logs examen MCP tool calls to hook-exec.jsonl for governance visibility.
Log-only, never blocks. Always exits 0.
"""

import json
import sys
import os
import time


def main():
    try:
        data = json.load(sys.stdin)
    except:
        sys.exit(0)

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})

    # Log to hook-exec.jsonl (route by cwd)
    cwd = os.getcwd().replace('\\', '/').lower()
    if '/documents/opus' in cwd:
        log_path = os.path.expanduser("~/Documents/opus/instruments/mercury/hook-exec.jsonl")
    else:
        log_path = os.path.expanduser("~/Documents/materia/instruments/mercury/hook-exec.jsonl")
    log_dir = os.path.dirname(log_path)
    if not os.path.isdir(log_dir):
        sys.exit(0)

    # Extract key info without logging full input (could be large)
    input_keys = list(tool_input.keys()) if isinstance(tool_input, dict) else []

    entry = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "hook": "mcp-observe",
        "event": "PostToolUse",
        "tool": tool_name,
        "input_keys": input_keys,
        "exit_code": 0,
        "duration_ms": 0,
        "error": None,
    }

    try:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except:
        pass

    sys.exit(0)


if __name__ == "__main__":
    main()
