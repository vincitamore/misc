"""
Shared hook execution logger.

Context-manager pattern for hooks to record execution telemetry
to instruments/mercury/hook-exec.jsonl. Logging must never break hooks.

Usage:
    from hook_log import HookLog
    with HookLog("session-start-orient", "SessionStart"):
        main()
"""

import json
import os
import time
from contextlib import contextmanager


def _resolve_hook_log_path():
    """Route by cwd — opus and materia each log to their own Mercury
    hook-exec.jsonl. Resolved at call time so hook processes pick up
    the right path from their invoking session's cwd."""
    cwd = os.getcwd().replace('\\', '/').lower()
    if '/documents/opus' in cwd:
        return os.path.expanduser("~/Documents/opus/instruments/mercury/hook-exec.jsonl")
    return os.path.expanduser("~/Documents/materia/instruments/mercury/hook-exec.jsonl")


@contextmanager
def HookLog(hook_name: str, event: str):
    """Record hook execution to hook-exec.jsonl. Never raises."""
    start = time.time()
    exit_code = 0
    error_msg = None
    had_output = False

    try:
        yield
    except SystemExit as e:
        exit_code = e.code if isinstance(e.code, int) else 0
        raise
    except Exception as e:
        exit_code = 1
        error_msg = str(e)[:200]
        raise
    finally:
        try:
            duration_ms = round((time.time() - start) * 1000)
            entry = {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "hook": hook_name,
                "event": event,
                "exit_code": exit_code,
                "duration_ms": duration_ms,
                "error": error_msg,
            }
            log_path = _resolve_hook_log_path()
            log_dir = os.path.dirname(log_path)
            if os.path.isdir(log_dir):
                with open(log_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(entry) + "\n")
        except Exception:
            pass  # Logging must never break hooks
