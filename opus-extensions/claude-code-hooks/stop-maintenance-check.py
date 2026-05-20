#!/usr/bin/env python3
"""
Stop hook: Maintenance vigilance check

Evaluates whether the session produced anything that should be captured
before allowing Claude to stop. Deliberately aggressive - easier to
dismiss a false positive than to recover lost insights.
"""

import json
import sys
import os
import glob


def get_documented_cross_cutting(org_dir: str) -> set:
    """Parse knowledge/README.md to find files documented as cross-cutting."""
    readme_path = os.path.join(org_dir, "knowledge", "README.md")
    if not os.path.exists(readme_path):
        return set()

    try:
        with open(readme_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Find "## Root Level" section and extract backtick-quoted filenames
        import re
        root_match = re.search(r'## Root Level\n(.*?)(?=\n## |\Z)', content, re.DOTALL)
        if not root_match:
            return set()

        # Extract filenames from backticks: `filename.md`
        filenames = re.findall(r'`([^`]+\.md)`', root_match.group(1))
        return set(filenames)
    except:
        return set()


def check_kb_organization(org_dir: str) -> list:
    """Check for KB files at root that might need organization.

    Excludes files documented as intentionally cross-cutting in README.md.
    """
    knowledge_dir = os.path.join(org_dir, "knowledge")
    if not os.path.exists(knowledge_dir):
        return []

    # Get files explicitly documented as cross-cutting
    documented_cross_cutting = get_documented_cross_cutting(org_dir)

    root_files = []
    for entry in os.scandir(knowledge_dir):
        if entry.is_file() and entry.name.endswith('.md'):
            if entry.name not in documented_cross_cutting and entry.name != 'README.md':
                root_files.append(entry.name.replace('.md', ''))

    return root_files


def detect_org_from_data(data):
    """Route by transcript_path — stable across a session (project-anchored).

    Prefer this to cwd-based detection. os.getcwd() drifts when Bash tool
    invocations cd into sibling trees (e.g. opus sessions that reference
    materia-hosted project folders), which silently routes opus stops to
    the materia branch. See
    opus/inbox/investigations/stop-hook-cwd-drift-routes-opus-sessions-to-materia-branch.md

    Claude Code writes transcripts under:
      ~/.claude/projects/C--Users-AlexMoyer-Documents-opus/...
      ~/.claude/projects/C--Users-AlexMoyer-Documents-materia/...
    so the project is encoded unambiguously in the path.
    """
    tp = (data.get("transcript_path") or "").replace('\\', '/').lower()
    if 'documents-opus' in tp:
        return 'opus', os.path.expanduser('~/Documents/opus')
    if 'documents-materia' in tp:
        return 'materia', os.path.expanduser('~/Documents/materia')
    # Fall back to cwd heuristic if transcript_path is missing or unrecognized.
    return detect_org()


def detect_org():
    """Legacy cwd-based routing. Retained as fallback only — prefer
    detect_org_from_data(data) above."""
    cwd = os.getcwd().replace('\\', '/').lower()
    if '/documents/opus' in cwd:
        return 'opus', os.path.expanduser('~/Documents/opus')
    return 'materia', os.path.expanduser('~/Documents/materia')


def session_performed_maintenance(transcript_content: str) -> bool:
    """Semantic check — did this session already write to opus's capture
    categories (inbox, tasks, knowledge, forge/proposals) or invoke
    examen MCP write tools? If yes, no need to nag further.

    Scans the last ~10KB of transcript for tool_use entries with file
    paths under the capture folders, or mcp__examen__ write tools.
    Conservative: false-negative (over-nag) preferred to false-positive
    (silent lossage)."""
    tail = transcript_content[-10000:] if len(transcript_content) > 10000 else transcript_content
    capture_path_patterns = [
        r'"file_path"\s*:\s*"[^"]*[/\\](inbox|tasks|knowledge|queries|reminders)[/\\]',
        r'"file_path"\s*:\s*"[^"]*[/\\]forge[/\\](proposals|handles|output|sessions)[/\\]',
    ]
    examen_write_tools = [
        'mcp__examen__task_create', 'mcp__examen__task_update', 'mcp__examen__task_complete',
        'mcp__examen__knowledge_create', 'mcp__examen__knowledge_update',
        'mcp__examen__inbox_capture', 'mcp__examen__archive',
        'mcp__examen__reminder_create', 'mcp__examen__reminder_update',
        'mcp__examen__reminder_complete', 'mcp__examen__reminder_snooze',
        'mcp__examen__reminder_dismiss',
    ]
    import re as _re
    for pat in capture_path_patterns:
        if _re.search(pat, tail):
            return True
    for tool in examen_write_tools:
        if tool in tail:
            return True
    return False


def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    # If already continuing from stop hook, don't block again
    if data.get("stop_hook_active"):
        sys.exit(0)

    # Check transcript length - don't nag on trivial sessions
    transcript_path = data.get("transcript_path")
    if not transcript_path or not os.path.exists(transcript_path):
        sys.exit(0)

    try:
        with open(transcript_path, 'r', encoding='utf-8') as f:
            content = f.read()
            line_count = content.count('\n')
    except:
        sys.exit(0)

    # Trivial session threshold - don't nag on quick interactions
    if line_count < 15:
        sys.exit(0)

    # Check if Claude already stated "No maintenance needed" recently
    # Look at the last ~2000 chars of transcript for this phrase
    recent_content = content[-2000:] if len(content) > 2000 else content
    if "No maintenance needed" in recent_content:
        sys.exit(0)

    profile, org_dir = detect_org_from_data(data)
    if not os.path.exists(org_dir):
        sys.exit(0)

    # Opus branch: semantic check first — if session already captured
    # (wrote to inbox/tasks/knowledge/forge or called examen writes),
    # release without blocking. The block is for sessions that produced
    # work but didn't record it, not a ritual at every stop.
    if profile == 'opus':
        # Stimulate Mercury's heartbeat regardless of block outcome.
        # Mercury watches ${org_root}/instruments/mercury/mercury.wake and
        # treats any touch as operator stimulus. Without this, opus sessions
        # silently fail to keep Mercury awake and it dreams mid-conversation.
        from datetime import datetime as _dt
        wake_path = os.path.join(org_dir, "instruments", "mercury", "mercury.wake")
        try:
            with open(wake_path, 'w') as f:
                f.write(_dt.now().isoformat())
        except Exception:
            pass

        if session_performed_maintenance(content):
            sys.exit(0)

        root_kb_files = check_kb_organization(org_dir)
        kb_warning = ""
        if root_kb_files:
            kb_warning = f"\n\n**KB Organization Alert:** {len(root_kb_files)} file(s) at knowledge root — move to subfolder or document in knowledge/README.md under '## Root Level'. Files: {', '.join(root_kb_files[:5])}{'...' if len(root_kb_files) > 5 else ''}"

        output = {
            "decision": "block",
            "reason": f"""Stop check — this session ran long and I see no capture writes yet.

Quick eval: did this session produce any of these?

- Reusable insight → `knowledge/<subfolder>/<topic>.md`
- Decision needing operator input → `inbox/decisions/<item>.md`
- Bug to investigate → `inbox/investigations/<item>.md`
- Feature idea → `inbox/ideas/<item>.md`
- Unsorted capture → `inbox/captures/<item>.md`
- New task → `tasks/<name>.md`
- Time-bound item → `reminders/<item>.md`
- Project status shift → update `context/current-state.md`

If yes: capture it now (writing to one of those paths will auto-release this check next stop).

If no: the literal phrase `No maintenance needed` releases this check.{kb_warning}"""
        }
        print(json.dumps(output))
        sys.exit(0)

    # Materia branch (unchanged legacy logic below) —————————————————

    # Stimulate Mercury's heartbeat on session stop.
    # ALWAYS write the wake file — Mercury's own checkWake() handles
    # dream-cycle deference internally (consumes file, records stimulus,
    # but defers heartbeat stimulation during active dreams).
    # R3 (2026-02-23) originally suppressed the write here during active
    # dreams, but this created a deadlock: hooks don't write → Mercury
    # never sees stimulus → cycle can never end via external signal.
    from datetime import datetime
    wake_path = os.path.join(org_dir, "instruments", "mercury", "mercury.wake")
    try:
        with open(wake_path, 'w') as f:
            f.write(datetime.now().isoformat())
    except:
        pass

    # Check KB organization status
    root_kb_files = check_kb_organization(org_dir)
    kb_warning = ""
    if root_kb_files:
        kb_warning = f"""

**KB Organization Alert:** {len(root_kb_files)} file(s) at knowledge root:
- {', '.join(root_kb_files[:5])}{'...' if len(root_kb_files) > 5 else ''}
→ Move to appropriate subfolder, OR
→ If truly cross-cutting, document in knowledge/README.md under "## Root Level\""""

    # Block and prompt for maintenance evaluation
    output = {
        "decision": "block",
        "reason": f"""MAINTENANCE VIGILANCE CHECK

Before stopping, evaluate this session:

| Signal | Action if Present |
|--------|-------------------|
| New reusable insight/pattern | → knowledge/<subfolder>/<topic>.md |
| Project status changed | → Update context/current-state.md (Vitrum dashboard), CLAUDE.md, project-map.md |
| New task identified | → tasks/<name>.md |
| Question worth preserving | → queries/<question>.md |
| Cross-project pattern | → Add instantiation to principle lattice |
| Feature idea / future project | → inbox/ideas/<item>.md |
| Decision needed | → inbox/decisions/<item>.md |
| Bug to investigate | → inbox/investigations/<item>.md |
| Quick unsorted capture | → inbox/captures/<item>.md |
| KB file needs organization | → Move to appropriate subfolder |

If ANY apply: perform the maintenance NOW.
If NONE apply: state "No maintenance needed" and stop.

Be aggressive about capture - lost insights are unrecoverable.{kb_warning}"""
    }

    print(json.dumps(output))
    sys.exit(0)

if __name__ == "__main__":
    from hook_log import HookLog
    with HookLog("stop-maintenance-check", "Stop"):
        main()
