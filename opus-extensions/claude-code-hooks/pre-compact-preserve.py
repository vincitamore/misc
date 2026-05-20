#!/usr/bin/env python
"""
PreCompact hook: Essential Thread Extractor

Runs before context compaction to extract and preserve critical elements
that must survive summarization: decisions, constraints, TODOs, definitions.
"""

import json
import sys
import os
import re

sys.stdout.reconfigure(encoding='utf-8')

# Patterns to extract (case-insensitive)
DECISION_PATTERNS = [
    r"(?:we |I )?(?:decided|agreed|chose|will use|going with|settled on)\s+(?:to\s+)?([^.!?\n]+)",
    r"decision:\s*([^.!?\n]+)",
    r"approach:\s*([^.!?\n]+)",
]

CONSTRAINT_PATTERNS = [
    r"(?:must not|cannot|shouldn't|don't|never)\s+([^.!?\n]+)",
    r"requirement:\s*([^.!?\n]+)",
    r"constraint:\s*([^.!?\n]+)",
    r"important:\s*([^.!?\n]+)",
]

TODO_PATTERNS = [
    r"(?:TODO|FIXME|need to|should still|still need|remaining)\s*:?\s*([^.!?\n]+)",
    r"next(?:\s+step)?:\s*([^.!?\n]+)",
    r"(?:after this|then)\s+(?:we need to|we should)\s+([^.!?\n]+)",
]

DEFINITION_PATTERNS = [
    r"(\w+)\s+(?:is|means|refers to)\s+([^.!?\n]+)",
    r"by\s+['\"](\w+)['\"]\s+(?:I mean|we mean)\s+([^.!?\n]+)",
]

def extract_patterns(text, patterns):
    """Extract matches for a list of patterns."""
    matches = []
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            # Get the captured group (first group)
            captured = match.group(1).strip()
            if captured and len(captured) > 10 and captured not in matches:
                matches.append(captured)
    return matches

def main():
    try:
        data = json.load(sys.stdin)
    except:
        sys.exit(0)

    transcript_path = data.get("transcript_path")

    if not transcript_path or not os.path.exists(transcript_path):
        sys.exit(0)

    # Read transcript
    try:
        with open(transcript_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except:
        sys.exit(0)

    # Skip short conversations
    if len(lines) < 20:
        sys.exit(0)

    # Combine all assistant messages for analysis
    full_text = ""
    for line in lines:
        try:
            msg = json.loads(line.strip())
            if msg.get("role") == "assistant":
                content = msg.get("content", "")
                if isinstance(content, str):
                    full_text += content + "\n"
        except:
            continue

    if len(full_text) < 1000:
        sys.exit(0)

    # Explicit affordance: if the model emitted <preserve>...</preserve>
    # blocks, capture them verbatim. Regex mining of decision phrasing is
    # brittle across models; an explicit block is the contract.
    explicit_blocks = re.findall(r'<preserve>(.*?)</preserve>', full_text, re.DOTALL)
    explicit_blocks = [b.strip() for b in explicit_blocks if b.strip()][:10]

    # Extract essentials (heuristic fallback)
    essentials = {
        "decisions": extract_patterns(full_text, DECISION_PATTERNS)[:5],
        "constraints": extract_patterns(full_text, CONSTRAINT_PATTERNS)[:5],
        "todos": extract_patterns(full_text, TODO_PATTERNS)[:5],
    }

    # Only output if we found something worth preserving
    has_content = any(essentials.values()) or explicit_blocks

    if has_content:
        preserved = []
        if explicit_blocks:
            preserved.append("**Explicit preserves** (from `<preserve>` blocks):")
            for block in explicit_blocks:
                preserved.append(f"  - {block[:300]}")
        for category, items in essentials.items():
            if items:
                preserved.append(f"**{category.title()}**:")
                for item in items:
                    preserved.append(f"  - {item[:100]}")

        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreCompact",
                "additionalContext": f"""<preserve-through-compact>
## Critical Context (must survive summarization)

{chr(10).join(preserved)}
</preserve-through-compact>"""
            }
        }
        print(json.dumps(output))

    sys.exit(0)

if __name__ == "__main__":
    from hook_log import HookLog
    with HookLog("pre-compact-preserve", "PreCompact"):
        main()
