#!/usr/bin/env python
"""
SessionStart hook: Auto-orient with org system context
Computes state from frontmatter (1→7 pattern) - single source of truth
"""

import json
import sys
import os
import re
import glob
from datetime import datetime, date

# Fix Windows console encoding
sys.stdout.reconfigure(encoding='utf-8')


def parse_frontmatter(filepath: str) -> dict:
    """Parse YAML frontmatter from a markdown file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except:
        return {}

    if not content.startswith('---'):
        return {}

    parts = content.split('---', 2)
    if len(parts) < 3:
        return {}

    yaml_content = parts[1].strip()
    result = {}

    for line in yaml_content.split('\n'):
        if ':' in line:
            key, value = line.split(':', 1)
            key = key.strip()
            value = value.strip()

            # Parse lists
            if value.startswith('[') and value.endswith(']'):
                inner = value[1:-1].strip()
                if inner:
                    result[key] = [v.strip().strip('"\'') for v in inner.split(',')]
                else:
                    result[key] = []
            # Parse null
            elif value.lower() == 'null' or value == '':
                result[key] = None
            # Keep strings
            else:
                result[key] = value.strip('"\'')

    result['_filepath'] = filepath
    result['_filename'] = os.path.basename(filepath).replace('.md', '')
    return result


def scan_tasks(org_dir: str) -> dict:
    """Scan all task folders, return dict by status category."""
    tasks_dir = os.path.join(org_dir, "tasks")
    if not os.path.exists(tasks_dir):
        return {}

    # Status categories and their folders
    # active, blocked stay in tasks/
    # review, backlog, incubating, paused have their own subfolders
    result = {
        'active': [],
        'blocked': [],
        'review': [],
        'backlog': [],
        'incubating': [],
        'paused': [],
    }

    # Scan root tasks folder
    for filepath in glob.glob(os.path.join(tasks_dir, "*.md")):
        if os.path.basename(filepath) == 'README.md':
            continue
        meta = parse_frontmatter(filepath)
        if meta.get('type') != 'task':
            continue
        status = meta.get('status', 'active')
        if status in result:
            result[status].append(meta)

    # Scan subfolders (review, backlog, incubating, paused)
    for subfolder in ['review', 'backlog', 'incubating', 'paused']:
        subfolder_path = os.path.join(tasks_dir, subfolder)
        if os.path.exists(subfolder_path):
            for filepath in glob.glob(os.path.join(subfolder_path, "*.md")):
                meta = parse_frontmatter(filepath)
                if meta.get('type') != 'task':
                    continue
                # Use folder as authoritative status
                result[subfolder].append(meta)

    return result


def scan_projects(org_dir: str) -> list:
    """Scan projects folder for active projects."""
    projects_dir = os.path.join(org_dir, "projects")
    if not os.path.exists(projects_dir):
        return []

    active = []
    for readme in glob.glob(os.path.join(projects_dir, "*", "README.md")):
        meta = parse_frontmatter(readme)
        if meta.get('status') == 'active':
            meta['_project_name'] = os.path.basename(os.path.dirname(readme))
            active.append(meta)

    return active


def scan_inbox(org_dir: str) -> list:
    """Scan inbox folder and subfolders for pending items."""
    inbox_dir = os.path.join(org_dir, "inbox")
    if not os.path.exists(inbox_dir):
        return []

    items = []
    # Scan root and all subfolders
    for filepath in glob.glob(os.path.join(inbox_dir, "**", "*.md"), recursive=True):
        meta = parse_frontmatter(filepath)
        if meta.get('type') in ('inbox', 'ticket'):
            # Add subfolder info
            rel_path = os.path.relpath(filepath, inbox_dir)
            if os.sep in rel_path:
                meta['_subfolder'] = os.path.dirname(rel_path)
            items.append(meta)

    # Sort by created date descending
    items.sort(key=lambda i: str(i.get('created', '') or ''), reverse=True)
    return items


def scan_reminders(org_dir: str) -> dict:
    """Scan reminders folder for due/overdue items."""
    from datetime import datetime, timedelta

    reminders_dir = os.path.join(org_dir, "reminders")
    if not os.path.exists(reminders_dir):
        return {'overdue': [], 'due_today': [], 'due_soon': [], 'snoozed': [], 'ongoing': []}

    now = datetime.now()
    today = now.date()

    result = {
        'overdue': [],
        'due_today': [],
        'due_soon': [],  # next 24 hours
        'snoozed': [],
        'ongoing': []
    }

    for filepath in glob.glob(os.path.join(reminders_dir, "*.md")):
        if os.path.basename(filepath) == 'README.md':
            continue

        meta = parse_frontmatter(filepath)
        if meta.get('type') != 'reminder':
            continue

        status = meta.get('status', 'pending')

        # Skip completed/dismissed
        if status in ('completed', 'dismissed'):
            continue

        # Handle snoozed reminders
        if status == 'snoozed':
            snoozed_until = meta.get('snoozed-until')
            if snoozed_until:
                try:
                    snooze_dt = datetime.fromisoformat(snoozed_until.replace('Z', '+00:00'))
                    if snooze_dt.tzinfo:
                        snooze_dt = snooze_dt.replace(tzinfo=None)
                    if snooze_dt <= now:
                        # Snooze expired, treat as due
                        result['due_today'].append(meta)
                    else:
                        result['snoozed'].append(meta)
                except:
                    result['snoozed'].append(meta)
            continue

        # Handle ongoing reminders
        if status == 'ongoing':
            result['ongoing'].append(meta)
            continue

        # Parse remind-at datetime
        remind_at = meta.get('remind-at')
        if not remind_at:
            continue

        try:
            # Parse ISO datetime
            remind_dt = datetime.fromisoformat(remind_at.replace('Z', '+00:00'))
            if remind_dt.tzinfo:
                remind_dt = remind_dt.replace(tzinfo=None)
            remind_date = remind_dt.date()

            if remind_dt < now:
                result['overdue'].append(meta)
            elif remind_date == today:
                result['due_today'].append(meta)
            elif remind_dt < now + timedelta(hours=24):
                result['due_soon'].append(meta)
        except:
            pass

    # Sort each list by remind-at
    def sort_key(r):
        ra = r.get('remind-at', '')
        return ra if ra else '9999'

    for key in result:
        result[key].sort(key=sort_key)

    return result


def scan_knowledge_recent(org_dir: str, days: int = 7) -> list:
    """Scan knowledge folder recursively for recently updated files."""
    knowledge_dir = os.path.join(org_dir, "knowledge")
    if not os.path.exists(knowledge_dir):
        return []

    recent = []
    cutoff = datetime.now().date()

    # Recursive glob to find all .md files in subfolders
    for filepath in glob.glob(os.path.join(knowledge_dir, "**", "*.md"), recursive=True):
        meta = parse_frontmatter(filepath)
        if meta.get('type') not in ('knowledge', 'index'):
            continue

        # Check if recently updated
        updated = meta.get('updated') or meta.get('created')
        if updated:
            try:
                if isinstance(updated, str):
                    updated_date = datetime.strptime(updated[:10], '%Y-%m-%d').date()
                else:
                    updated_date = updated
                diff = (cutoff - updated_date).days
                if diff <= days:
                    meta['_days_ago'] = diff
                    recent.append(meta)
            except:
                pass

    recent.sort(key=lambda k: k.get('_days_ago', 999))
    return recent[:10]


def scan_knowledge_folders(org_dir: str) -> dict:
    """Scan knowledge folder structure for organizational context."""
    knowledge_dir = os.path.join(org_dir, "knowledge")
    if not os.path.exists(knowledge_dir):
        return {}

    folders = {}
    root_files = []

    # Count files in each subfolder
    for entry in os.scandir(knowledge_dir):
        if entry.is_dir() and not entry.name.startswith('.'):
            count = len([f for f in os.listdir(entry.path) if f.endswith('.md')])
            if count > 0:
                folders[entry.name] = count
        elif entry.is_file() and entry.name.endswith('.md') and entry.name != 'README.md':
            root_files.append(entry.name.replace('.md', ''))

    return {'folders': folders, 'root_files': root_files}


def detect_org():
    """Route by cwd. Opus and materia share a hook codebase but dispatch
    to different org roots and orientation styles. Under materia -> full
    legacy output (unchanged). Under opus -> compact orientation."""
    cwd = os.getcwd().replace('\\', '/').lower()
    if '/documents/opus' in cwd:
        return 'opus', os.path.expanduser('~/Documents/opus')
    return 'materia', os.path.expanduser('~/Documents/materia')


def emit_opus_orientation(org_dir):
    """Compact opus orientation — counts + pointers, not a scan dump.
    Keep under ~1KB. Operator reads current-state.md / voice.md / etc.
    on demand via Read; hook only surfaces what has changed."""
    tasks_by_status = scan_tasks(org_dir)
    active = tasks_by_status.get('active', [])
    blocked = tasks_by_status.get('blocked', [])
    review = tasks_by_status.get('review', [])
    backlog = len(tasks_by_status.get('backlog', []))
    incubating = len(tasks_by_status.get('incubating', []))
    paused = len(tasks_by_status.get('paused', []))

    inbox_dir = os.path.join(org_dir, 'inbox')
    inbox_breakdown = []
    inbox_total = 0
    if os.path.exists(inbox_dir):
        for sub in ['captures', 'ideas', 'decisions', 'investigations', 'emails', 'tickets']:
            sp = os.path.join(inbox_dir, sub)
            if os.path.exists(sp):
                c = len([f for f in os.listdir(sp) if f.endswith('.md')])
                if c:
                    inbox_breakdown.append(f'{c} {sub}')
                    inbox_total += c

    proposals_dir = os.path.join(org_dir, 'forge', 'proposals')
    sessions_dir = os.path.join(org_dir, 'forge', 'sessions')
    pending_proposals = 0
    if os.path.exists(proposals_dir):
        pending_proposals = len([f for f in os.listdir(proposals_dir) if f.endswith('.md')])
    pending_pipelines = 0
    if os.path.exists(sessions_dir):
        for f in os.listdir(sessions_dir):
            if f.endswith('.manifest.md'):
                meta = parse_frontmatter(os.path.join(sessions_dir, f))
                if meta.get('review-status') == 'pending':
                    pending_pipelines += 1

    print('<session-context source="SessionStart hook" org="opus">')
    print('## Opus orientation')
    print('')
    print(f'**Tasks**: {len(active)} active · {len(blocked)} blocked · {len(review)} review · {backlog} backlog · {incubating} incubating · {paused} paused')
    if blocked:
        names = ', '.join(b['_filename'] for b in blocked[:3])
        tail = '...' if len(blocked) > 3 else ''
        print(f'  ↳ blocked: {names}{tail}')
    if review:
        names = ', '.join(r['_filename'] for r in review[:3])
        tail = '...' if len(review) > 3 else ''
        print(f'  ↳ review: {names}{tail}')

    if inbox_total:
        print(f'**Inbox**: {inbox_total} total ({", ".join(inbox_breakdown)})')
    else:
        print('**Inbox**: clear')

    if pending_proposals or pending_pipelines:
        parts = []
        if pending_proposals:
            parts.append(f'{pending_proposals} proposals')
        if pending_pipelines:
            parts.append(f'{pending_pipelines} pipelines pending review')
        print(f'**Mercury**: {" · ".join(parts)}')
    else:
        print('**Mercury**: queue clear')

    # Stimulate Mercury's heartbeat. Mercury reads ${org_root}/instruments/
    # mercury/mercury.wake and treats any touch as operator stimulus. The
    # materia branch writes this near end of its orientation; opus must too,
    # otherwise Mercury sees no signal from opus sessions and dreams while
    # the operator is actively working.
    from datetime import datetime as _dt
    wake_path = os.path.join(org_dir, 'instruments', 'mercury', 'mercury.wake')
    try:
        with open(wake_path, 'w') as f:
            f.write(_dt.now().isoformat())
    except Exception:
        pass

    # Reminders — count active + upcoming (remind-at within 7d) + past-due
    reminders_dir = os.path.join(org_dir, 'reminders')
    if os.path.exists(reminders_dir):
        from datetime import datetime, timedelta
        now = datetime.now()
        horizon = now + timedelta(days=7)
        active_count = 0
        upcoming_count = 0
        past_due_count = 0
        for f in os.listdir(reminders_dir):
            if not f.endswith('.md'):
                continue
            meta = parse_frontmatter(os.path.join(reminders_dir, f))
            status = meta.get('status', 'pending')
            if status not in ('pending', 'ongoing', 'snoozed'):
                continue
            active_count += 1
            remind_at = meta.get('remind-at') or meta.get('snoozed-until')
            if not remind_at:
                continue
            try:
                ts = datetime.fromisoformat(str(remind_at).replace('Z', ''))
                if ts < now:
                    past_due_count += 1
                elif ts <= horizon:
                    upcoming_count += 1
            except (ValueError, TypeError):
                pass
        if active_count:
            parts = [f'{active_count} active']
            if past_due_count:
                parts.append(f'{past_due_count} past-due')
            if upcoming_count:
                parts.append(f'{upcoming_count} within 7d')
            print(f'**Reminders**: {" · ".join(parts)}')

    print('')
    print('Detail lives in authoritative files — read on demand:')
    print('- `context/current-state.md` (tasks, projects, inbox, recent changes)')
    print('- `context/voice.md` (collaboration style, operator coordinates)')
    print('- `context/project-map.md` (principle lattice, project topology)')
    print('- `knowledge/README.md` (KB map)')
    print('</session-context>')


def main():
    # Read stdin (hooks receive JSON input)
    try:
        data = json.load(sys.stdin)
    except:
        data = {}

    # Skip orientation on resume - context already loaded
    if data.get("source") == "resume":
        sys.exit(0)

    profile, org_dir = detect_org()
    claude_md = os.path.join(org_dir, "CLAUDE.md")
    voice_md = os.path.join(org_dir, "context", "voice.md")

    # Opus branch: compact orientation, skip materia-specific rituals
    # (publish dashboard, Mercury wake — those are materia operations).
    if profile == 'opus':
        if not os.path.exists(claude_md):
            sys.exit(0)
        emit_opus_orientation(org_dir)
        return

    # Only inject if org system exists
    if not os.path.exists(claude_md):
        sys.exit(0)

    # Regenerate publish dashboard (for Obsidian Publish)
    dashboard_script = os.path.join(org_dir, "scripts", "generate-publish-dashboard.py")
    if os.path.exists(dashboard_script):
        import subprocess
        try:
            subprocess.run([sys.executable, dashboard_script],
                         capture_output=True, timeout=10)
        except:
            pass  # Don't block session start if dashboard generation fails

    # Stimulate Mercury's heartbeat.
    # ALWAYS write — Mercury's checkWake() handles dream-cycle deference
    # internally. See stop-maintenance-check.py for the full rationale.
    wake_path = os.path.join(org_dir, "instruments", "mercury", "mercury.wake")
    try:
        with open(wake_path, 'w') as f:
            f.write(datetime.now().isoformat())
    except:
        pass  # Mercury may not exist yet

    print('<session-context source="SessionStart hook">')
    print('## Auto-loaded Orientation')
    print('')

    # Extract Archive Structure from CLAUDE.md (static reference info)
    if os.path.exists(claude_md):
        with open(claude_md, 'r', encoding='utf-8') as f:
            content = f.read()

        archive_match = re.search(r'### Archive Structure\n(.*?)(?=\n## |\Z)', content, re.DOTALL)
        if archive_match:
            print('### Archive Structure')
            lines = archive_match.group(1).strip().split('\n')[:12]
            print('\n'.join(lines))
            print('')

    # === COMPUTED STATE FROM FRONTMATTER (1→7 pattern) ===
    print('## Current State')
    print('')

    # Tasks by status (computed from tasks/**/*.md frontmatter)
    tasks_by_status = scan_tasks(org_dir)

    print('### Active Tasks')
    active = tasks_by_status.get('active', [])
    if active:
        for t in active:
            tags = t.get('tags', [])
            tag_str = f" [{', '.join(tags)}]" if tags else ""
            print(f"- **{t['_filename']}**{tag_str} - See `tasks/{t['_filename']}.md`")
    else:
        print('_No active tasks_')
    print('')

    # Blocked tasks
    blocked = tasks_by_status.get('blocked', [])
    if blocked:
        print('### Blocked Tasks')
        for t in blocked:
            blocked_by = t.get('blocked-by', [])
            blocked_str = ', '.join(blocked_by) if blocked_by else 'unknown'
            print(f"- **{t['_filename']}** - blocked by: {blocked_str}")
        print('')

    # Review tasks (need decision)
    review = tasks_by_status.get('review', [])
    if review:
        print('### Tasks Needing Review')
        for t in review:
            review_needed = t.get('review-needed', 'decision needed')
            print(f"- **{t['_filename']}** - {review_needed}")
        print('')

    # Summary of other categories
    backlog_count = len(tasks_by_status.get('backlog', []))
    incubating_count = len(tasks_by_status.get('incubating', []))
    paused_count = len(tasks_by_status.get('paused', []))
    if backlog_count or incubating_count or paused_count:
        print(f'**Other:** {backlog_count} backlog, {incubating_count} incubating, {paused_count} paused')
        print('')

    # Active Projects (from context/current-state.md)
    current_state_md = os.path.join(org_dir, "context", "current-state.md")
    if os.path.exists(current_state_md):
        with open(current_state_md, 'r', encoding='utf-8') as f:
            state_content = f.read()

        project_match = re.search(r'## Active Projects\n(.*?)(?=\n## |\Z)', state_content, re.DOTALL)
        if project_match:
            print('### Active Projects')
            print(project_match.group(1).strip())
            print('')

    # Knowledge Base (computed from folder structure)
    kb_info = scan_knowledge_folders(org_dir)
    if kb_info:
        print('### Knowledge Base')
        print('Organized into semantic subfolders. See `knowledge/README.md` for full index.')
        print('')
        print('| Folder | Contents |')
        print('|--------|----------|')
        folder_descriptions = {
            'react': 'React Router, hooks, Framer Motion debugging patterns',
            'routeros': 'MikroTik RouterOS networking gotchas',
            'vercel': 'Vercel platform patterns - blob, analytics, redirects',
            'mobile-terminal': 'xterm.js, WebSocket, mobile UI patterns',
            'claude-tooling': 'Claude Code hooks, MCP, agents, NinjaRMM API',
            'architecture': 'Design patterns, sovereignty, tech stack',
            'obsidian': 'Obsidian workflow and Publish patterns',
            'publishing': 'LaTeX, printing, document production',
            'theology': 'Scriptural mappings, philosophical foundations',
        }
        for folder, count in sorted(kb_info['folders'].items()):
            desc = folder_descriptions.get(folder, f'{folder} patterns')
            print(f"| `{folder}/` | {desc} ({count} files) |")
        if kb_info['root_files']:
            print(f"| *(root)* | Cross-cutting: {', '.join(kb_info['root_files'][:3])}{'...' if len(kb_info['root_files']) > 3 else ''} ({len(kb_info['root_files'])} files) |")
        print('')
        print('**Quick reference for common lookups:**')
        print('- React debugging → `knowledge/react/`')
        print('- RouterOS issues → `knowledge/routeros/`')
        print('- Mobile terminal → `knowledge/mobile-terminal/`')
        print('- Claude/MCP → `knowledge/claude-tooling/`')
        print('')

    # Context Documents section (static reference) - back in CLAUDE.md scope
    if os.path.exists(claude_md):
        with open(claude_md, 'r', encoding='utf-8') as f:
            content = f.read()
        context_match = re.search(r'### Context Documents\n(.*?)(?=\n### |\Z)', content, re.DOTALL)
        if context_match:
            print('### Context Documents')
            print(context_match.group(1).strip())
            print('')

    # Inbox Items (computed from inbox/**/*.md frontmatter)
    inbox_items = scan_inbox(org_dir)
    email_count = sum(1 for i in inbox_items if i.get('source') == 'email')

    # Count by subfolder
    inbox_dir = os.path.join(org_dir, "inbox")
    subfolder_counts = {}
    for subfolder in ['ideas', 'decisions', 'investigations', 'captures', 'tickets']:
        sf_path = os.path.join(inbox_dir, subfolder)
        if os.path.exists(sf_path):
            count = len([f for f in os.listdir(sf_path) if f.endswith('.md')])
            if count > 0:
                subfolder_counts[subfolder] = count

    print('### Inbox')
    print(f'**Pending Emails:** {email_count}')
    for sf, count in subfolder_counts.items():
        label = sf.capitalize()
        print(f'**{label}:** {count} (in `inbox/{sf}/`)')
    if not subfolder_counts and email_count == 0:
        print('_Inbox clear_')
    print('')
    print('')

    # Alert about pending emails
    if email_count > 0:
        print(f'### ACTION REQUIRED: {email_count} Pending Email(s)')
        print('')
        print('New emails arrived since last session. Before proceeding:')
        print('1. Read emails in `inbox/emails/` folder')
        print('2. Summarize anything important to the user')
        print('3. Archive or act on them as appropriate')
        print('')

    # Alert about due reminders
    reminders = scan_reminders(org_dir)
    total_due = len(reminders['overdue']) + len(reminders['due_today'])

    if total_due > 0:
        print(f'### ACTION REQUIRED: {total_due} Due Reminder(s)')
        print('')

        if reminders['overdue']:
            print('**Overdue:**')
            for r in reminders['overdue'][:5]:
                remind_at = r.get('remind-at', 'unknown')
                print(f"- [{remind_at}] **{r['_filename']}**")
            print('')

        if reminders['due_today']:
            print('**Due Today:**')
            for r in reminders['due_today'][:5]:
                remind_at = r.get('remind-at', '')
                time_part = remind_at.split('T')[1][:5] if 'T' in remind_at else ''
                print(f"- [{time_part}] **{r['_filename']}**")
            print('')

        print('Use `reminder_list` (materia MCP) to see all reminders.')
        print('')

    # Mercury activity: pending proposals and unreviewed pipelines
    # (materia branch — materia has not unified the review-status value domain,
    # so both `unreviewed` and `pending` count as needing review. The opus
    # branch above uses `pending`-only after the 2026-04-20 unification.)
    proposals_dir = os.path.join(org_dir, "forge", "proposals")
    sessions_dir = os.path.join(org_dir, "forge", "sessions")

    pending_proposals = 0
    if os.path.exists(proposals_dir):
        pending_proposals = len([f for f in os.listdir(proposals_dir) if f.endswith('.md')])

    unreviewed = 0
    if os.path.exists(sessions_dir):
        for f in os.listdir(sessions_dir):
            if f.endswith('.manifest.md'):
                meta = parse_frontmatter(os.path.join(sessions_dir, f))
                if meta.get('review-status') in ('unreviewed', 'pending'):
                    unreviewed += 1

    if pending_proposals > 0 or unreviewed > 0:
        print('### Mercury Activity')
        if pending_proposals > 0:
            print(f'**Pending proposals:** {pending_proposals} in `forge/proposals/`')
        if unreviewed > 0:
            print(f'**Unreviewed pipelines:** {unreviewed} in `forge/sessions/`')
        print('')

    print('')
    print('### Operational Safety Rules')
    print('')
    print('**Process management:**')
    print('- NEVER blanket kill processes by name (e.g., `taskkill //F //IM node.exe`)')
    print('- ALWAYS use `netstat -ano | grep <port>` first to identify the specific PID')
    print('- Only kill the specific PID you need: `taskkill //F //PID <pid>`')
    print('- MCP servers, dev servers, and other critical processes share process names')
    print('')
    print('**Before destructive operations:**')
    print('- Confirm the target (file, process, resource) is correct')
    print('- Check dependencies and side effects')
    print('- Prefer surgical precision over broad strokes')
    print('')
    print('### Collaboration Style')
    print('')

    # Extract collaboration guidance from voice.md
    if os.path.exists(voice_md):
        with open(voice_md, 'r', encoding='utf-8') as f:
            content = f.read()

        # Find "## How to Collaborate" section
        match = re.search(r'## How to Collaborate\n(.*?)(?=\n## |\Z)', content, re.DOTALL)
        if match:
            lines = match.group(0).split('\n')[:25]
            print('\n'.join(lines))

    print('')
    print('</session-context>')

if __name__ == "__main__":
    from hook_log import HookLog
    with HookLog("session-start-orient", "SessionStart"):
        main()
