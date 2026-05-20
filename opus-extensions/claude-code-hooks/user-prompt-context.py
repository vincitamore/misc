#!/usr/bin/env python
"""
UserPromptSubmit hook: Project-Aware Context Loader

Detects project keywords in prompts and injects relevant context.
Avoids bloating every prompt - only triggers on clear project references.
"""

import json
import sys
import os
import re

sys.stdout.reconfigure(encoding='utf-8')

# Project keyword mappings
# Format: { "keyword": ("context_file_path", "description") }
# All projects now live under ~/Documents/materia/projects/
PROJECT_CONTEXTS = {
    # Active projects
    "apotheka": ("~/Documents/materia/projects/apotheka/CLAUDE.md", "herbal app"),
    "herbal": ("~/Documents/materia/projects/apotheka/CLAUDE.md", "herbal app"),
    "herb-remedy": ("~/Documents/materia/projects/apotheka/CLAUDE.md", "herbal app"),

    "taildown": ("~/Documents/materia/projects/taildown/CLAUDE.md", "markup language"),

    "routeros": ("~/Documents/materia/projects/routeros-portal/CLAUDE.md", "router portal"),
    "mikrotik": ("~/Documents/materia/projects/routeros-portal/CLAUDE.md", "router portal"),

    "deployment-cli": ("~/Documents/materia/projects/deployment-cli/CLAUDE.md", "deployment tool"),
    "ncu-deploy": ("~/Documents/materia/projects/deployment-cli/CLAUDE.md", "deployment tool"),

    "infinite-origin": ("~/Documents/materia/projects/infinite-origin/CLAUDE.md", "n-body simulation"),

    "bible-rag": ("~/Documents/materia/projects/bible-rag/CLAUDE.md", "scripture RAG"),

    "bonerbots": ("~/Documents/materia/projects/bonerbots-saas/CLAUDE.md", "trading bot"),

    "ncu-command": ("~/Documents/materia/projects/ncu-command/CLAUDE.md", "facility monitoring"),

    "iron-rod": ("~/Documents/materia/projects/iron-rod/CLAUDE.md", "browser capture extension"),

    "amore-build": ("~/Documents/materia/projects/amore-build/CLAUDE.md", "portfolio website"),

    "semantic-compression": ("~/Documents/materia/projects/semantic-compression/CLAUDE.md", "compression research"),

    # Knowledge triggers (inject knowledge files instead of project CLAUDE.md)
    "sovereignty": ("~/Documents/materia/knowledge/architecture/patterns/data-sovereignty-patterns.md", "sovereignty patterns"),
    "data sovereignty": ("~/Documents/materia/knowledge/architecture/patterns/data-sovereignty-patterns.md", "sovereignty patterns"),

    "latex": ("~/Documents/materia/knowledge/publishing/latex-document-patterns.md", "LaTeX patterns"),
    "booklet": ("~/Documents/materia/knowledge/publishing/latex-document-patterns.md", "LaTeX patterns"),

    "νικῶν": ("~/Documents/materia/knowledge/theology/nikon-overcomer-pattern.md", "overcomer pattern"),
    "overcomer": ("~/Documents/materia/knowledge/theology/nikon-overcomer-pattern.md", "overcomer pattern"),
    "qui vincit": ("~/Documents/materia/knowledge/theology/nikon-overcomer-pattern.md", "overcomer pattern"),
}

def main():
    try:
        data = json.load(sys.stdin)
    except:
        sys.exit(0)

    # Opus branch: the materia keyword map references materia/projects/
    # which don't exist under opus. Skip keyword injection for opus until
    # opus grows its own project topology worth mapping — BUT still
    # stimulate Mercury's heartbeat. This is the strongest "operator is
    # actively talking" signal — fires on every prompt submit.
    cwd = os.getcwd().replace('\\', '/').lower()
    if '/documents/opus' in cwd:
        from datetime import datetime as _dt
        opus_root = os.path.expanduser('~/Documents/opus')
        wake_path = os.path.join(opus_root, 'instruments', 'mercury', 'mercury.wake')
        try:
            with open(wake_path, 'w') as f:
                f.write(_dt.now().isoformat())
        except Exception:
            pass
        sys.exit(0)

    prompt = data.get("prompt", "").lower()

    if not prompt:
        sys.exit(0)

    # Find matching contexts
    matched = []
    for keyword, (path, desc) in PROJECT_CONTEXTS.items():
        if keyword.lower() in prompt:
            expanded_path = os.path.expanduser(path)
            if os.path.exists(expanded_path) and (expanded_path, desc) not in matched:
                matched.append((expanded_path, desc))

    if not matched:
        sys.exit(0)

    # Build context injection (limit to first 2 matches to avoid bloat)
    context_parts = []
    for path, desc in matched[:2]:
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()

            # For CLAUDE.md files, extract Current State section
            if path.endswith('CLAUDE.md'):
                match = re.search(r'## Current State\n(.*?)(?=\n## |\Z)', content, re.DOTALL)
                if match:
                    excerpt = match.group(0)[:2000]  # Limit size
                else:
                    excerpt = content[:1500]
            else:
                # For knowledge files, include more
                excerpt = content[:3000]

            context_parts.append(f"### {desc}\n{excerpt}")
        except:
            continue

    if context_parts:
        output = {
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": f"<auto-context source='UserPromptSubmit hook'>\n{'---'.join(context_parts)}\n</auto-context>"
            }
        }
        print(json.dumps(output))

    sys.exit(0)

if __name__ == "__main__":
    from hook_log import HookLog
    with HookLog("user-prompt-context", "UserPromptSubmit"):
        main()
