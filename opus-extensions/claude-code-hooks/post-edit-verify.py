#!/usr/bin/env python3
"""
PostToolUse hook: Output verification

Verifies accuracy of written/edited files.
Focus: catch errors, not restrict capability.
"""

import json
import sys
import os

def check_json(file_path):
    """Verify JSON syntax"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            json.load(f)
        return None
    except json.JSONDecodeError as e:
        return f"Invalid JSON at line {e.lineno}: {e.msg}"
    except Exception as e:
        return f"Could not read: {e}"

def check_yaml(file_path):
    """Verify YAML syntax"""
    try:
        import yaml
        with open(file_path, 'r', encoding='utf-8') as f:
            yaml.safe_load(f)
        return None
    except ImportError:
        return None
    except yaml.YAMLError as e:
        return f"Invalid YAML: {e}"
    except:
        return None

def check_exists(file_path):
    """Verify file exists and has content"""
    if not os.path.exists(file_path):
        return "File not found after write"
    if os.path.getsize(file_path) == 0:
        return "File is empty after write"
    return None

def main():
    try:
        data = json.load(sys.stdin)
    except:
        sys.exit(0)

    tool_name = data.get("tool_name")
    if tool_name not in ("Write", "Edit"):
        sys.exit(0)

    file_path = data.get("tool_input", {}).get("file_path")
    if not file_path:
        sys.exit(0)

    issues = []

    # Existence check
    exist_issue = check_exists(file_path)
    if exist_issue:
        issues.append(exist_issue)
    else:
        # Type-specific validation
        ext = os.path.splitext(file_path)[1].lower()

        if ext == '.json':
            issue = check_json(file_path)
            if issue:
                issues.append(issue)

        elif ext in ('.yaml', '.yml'):
            issue = check_yaml(file_path)
            if issue:
                issues.append(issue)

    if issues:
        output = {
            "decision": "block",
            "reason": f"Verification issues in {os.path.basename(file_path)}:\n" +
                     "\n".join(f"• {i}" for i in issues),
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": f"Fix issues in {file_path}"
            }
        }
        print(json.dumps(output))

    sys.exit(0)

if __name__ == "__main__":
    from hook_log import HookLog
    with HookLog("post-edit-verify", "PostToolUse"):
        main()
