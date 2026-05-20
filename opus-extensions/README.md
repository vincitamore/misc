# opus-extensions

Hi Bryan — this is the set of extensions, hooks, and customizations I run on top of [omp (Oh My Pi)](https://oh-my-pi.com/) and Claude Code, for my opus org system (the 4.7-calibrated fork of the old `claude-org-template` we both started from).

Everything here is in production on my own tree. Read freely, copy what's useful, adapt what isn't.

## What's in here

```
opus-extensions/
├── omp-extensions/          TypeScript extensions for omp (the live ones)
│   ├── session-orient/         compact orientation block at session_start + /orient command + principle_lookup tool
│   ├── maintenance-gate/       turn_end nag that synthesizes a continuation if capture is owed
│   ├── mercury-observe/        restores Mercury daemon's hook-exec.jsonl sensorium under omp + /dream command
│   └── omp-self-heal/          re-applies source-level patches after omp auto-upgrades
│
├── omp-rules/               TTSR rules (mid-stream interrupt patterns)
│   └── maintenance-vigilance.md
│
├── omp-customizations/      source-level patches against the installed omp package
│   └── strip-emojis.ts         swap ~80 emoji literals for ASCII equivalents (icons, language tags, dialogs)
│
├── omp-themes/              TUI color themes for omp
│   └── horizon.json            my daily-driver — dark, low-contrast, pink/cyan/mint accents (Horizon palette)
│
├── omp-config-example.yml   my ~/.omp/agent/config.yml (model role, theme)
│
└── claude-code-hooks/       the original Python hooks for Claude Code (some have omp ports above)
    ├── hook_log.py                          shared context-manager logger
    ├── session-start-orient.py              → ported to omp-extensions/session-orient
    ├── stop-maintenance-check.py            → ported to omp-extensions/maintenance-gate
    ├── mcp-observe.py                       → ported to omp-extensions/mercury-observe
    ├── user-prompt-context.py               not yet ported (project-keyword context injection)
    ├── pre-compact-preserve.py              not yet ported (extract decisions/constraints/todos before compaction)
    ├── post-edit-verify.py                  not yet ported (JSON/YAML syntax check after Write/Edit)
    ├── session-end-cleanup-skill-flags.py   not yet ported (cleans ~/.claude/state/*-loaded-<sid>)
    ├── pre-tool-ncu-deploy-gate.py          not yet ported (Skill-gate for the ncu-deploy CLI)
    ├── post-tool-ncu-deploy-skill-loaded.py not yet ported (pair with above)
    ├── notify-windows.ps1                   Windows toast on notification events
    └── hook-manifest.json                   declared hooks + sha256 checksums (used by self-orient validation)
```

The session-context files (`CLAUDE.md`, `voice.md`, `project-map.md`, `cross-project-hook.md`) that the extensions orient against are not in this bundle — they're personal. The shape is the same one you already have from the `claude-org-template`. Ping me if you want to see mine directly, but you don't actually need them to use any of this code.

## The shape of it

Two pieces working together:

1. **Session context** (your own `CLAUDE.md` + `context/voice.md` + `context/project-map.md` + `context/current-state.md`) — the org system itself: frontmatter-as-source-of-truth, inbox/tasks/knowledge/reminders/forge folder discipline, principle lattice, Mercury governance tiers. Same shape as the template you forked from.
2. **Hook architecture** — automation that makes the system self-orienting and self-maintaining:
    - `session_start` injects a compact orientation block (task counts, inbox breakdown, mercury queue, due reminders) plus the **inlined load-bearing surfaces** (your full `CLAUDE.md`, the collaboration section of `voice.md`, the principle lattice). Read-on-demand is unreliable; the load-bearing pieces need to be in context every turn.
    - `turn_end` runs a maintenance gate: if the session is long enough and no capture writes happened, synthesizes a follow-up turn that asks "did you produce a reusable insight, decision, bug, idea, or task? Capture it now or say `No maintenance needed`." Paired with a TTSR rule (`omp-rules/maintenance-vigilance.md`) that catches the same omission mid-stream before the wrap-up summary lands.
    - Every examen MCP write and every session_start logs to `instruments/mercury/hook-exec.jsonl` so the Mercury daemon stays aware of what the operator session is doing.
    - `mercury-observe` adds `/orient`, `/principle <symbol-or-name>`, `/dream` slash commands and a `principle_lookup` LLM-callable tool.

The omp ports are the **live** versions for omp users. The Claude Code Python hooks are kept here for reference (and because some aren't ported yet — see the list above).

## Install — omp

```bash
# Drop the extensions into ~/.omp/agent/extensions/
mkdir -p ~/.omp/agent/extensions
cp -r opus-extensions/omp-extensions/* ~/.omp/agent/extensions/

# Drop the rule into ~/.omp/agent/rules/
mkdir -p ~/.omp/agent/rules
cp opus-extensions/omp-rules/maintenance-vigilance.md ~/.omp/agent/rules/

# Optional: emoji strip
mkdir -p ~/.omp/customizations
cp opus-extensions/omp-customizations/strip-emojis.ts ~/.omp/customizations/
bun ~/.omp/customizations/strip-emojis.ts   # one-time apply; omp-self-heal re-applies after upgrades

# Optional: horizon theme
mkdir -p ~/.omp/agent/themes
cp opus-extensions/omp-themes/horizon.json ~/.omp/agent/themes/

# Optional: my model + theme config (references horizon by name — copy the theme first)
cp opus-extensions/omp-config-example.yml ~/.omp/agent/config.yml
```

Restart omp. Extensions discovered on next session_start.

## Install — Claude Code

```bash
# Drop hooks into ~/.claude/hooks/
mkdir -p ~/.claude/hooks
cp opus-extensions/claude-code-hooks/*.py ~/.claude/hooks/
cp opus-extensions/claude-code-hooks/*.ps1 ~/.claude/hooks/

# Wire them up in ~/.claude/settings.json (or .claude/settings.local.json). Pattern:
#   "hooks": {
#     "SessionStart":    [{"hooks": [{"type": "command", "command": "python ~/.claude/hooks/session-start-orient.py"}]}],
#     "UserPromptSubmit":[{"hooks": [{"type": "command", "command": "python ~/.claude/hooks/user-prompt-context.py"}]}],
#     "PreCompact":      [{"hooks": [{"type": "command", "command": "python ~/.claude/hooks/pre-compact-preserve.py"}]}],
#     "Stop":            [{"hooks": [{"type": "command", "command": "python ~/.claude/hooks/stop-maintenance-check.py"}]}],
#     "PostToolUse":     [
#       {"matcher": "Write|Edit",          "hooks": [{"type": "command", "command": "python ~/.claude/hooks/post-edit-verify.py"}]},
#       {"matcher": "mcp__examen__",       "hooks": [{"type": "command", "command": "python ~/.claude/hooks/mcp-observe.py"}]},
#       {"matcher": "Skill",               "hooks": [{"type": "command", "command": "python ~/.claude/hooks/post-tool-ncu-deploy-skill-loaded.py"}]}
#     ],
#     "PreToolUse":      [{"matcher": "Bash|PowerShell", "hooks": [{"type": "command", "command": "python ~/.claude/hooks/pre-tool-ncu-deploy-gate.py"}]}],
#     "SessionEnd":      [{"hooks": [{"type": "command", "command": "python ~/.claude/hooks/session-end-cleanup-skill-flags.py"}]}],
#     "Notification":    [{"hooks": [{"type": "command", "command": "powershell -File ~/.claude/hooks/notify-windows.ps1"}]}]
#   }
```

See `claude-code-hooks/hook-manifest.json` for the canonical declaration (with sha256s that `session-start-orient.py` uses for self-validation).

## Caveats — things baked in that you'll want to change

- **CWD routing** — every extension detects `documents/opus` or `documents/materia` in the cwd and no-ops elsewhere. If your org lives somewhere else, `Ctrl-F` the constant `detectProfile` in each `index.ts` and add your tree. Same goes for the Python hooks (`detect_org()` / `_resolve_hook_log_path()`).
- **Mercury paths** — the gate writes to `instruments/mercury/mercury.wake` and `hook-exec.jsonl` on every fire. Harmless if Mercury isn't installed (the writes are best-effort and silently no-op on failure).
- **Examen MCP** — the maintenance-gate's "did you capture?" check watches for `mcp__examen_*` write tools. If you use a different MCP server for org writes, update `CAPTURE_TOOLS` in `maintenance-gate/index.ts`.
- **Context references** — `session-orient/index.ts` reads `CLAUDE.md`, `context/voice.md` (the `## How to Collaborate` section), and `context/project-map.md` (the `## Principle Lattice` section) and inlines them into the orientation block. If your section headers differ, update `loadCriticalContext()`.
- **omp tool naming** — omp uses `mcp__<server>_<tool>` (single underscore between server and method), Claude Code uses `mcp__<server>__<tool>` (double). The omp extensions normalize for both; the Python hooks assume Claude Code form. If you mix them, mind the prefix.

## The two-layer maintenance pattern (the load-bearing design)

The trick that took me the longest to settle: a single layer either over-fires (nags every wrap-up paragraph) or under-fires (misses everything mid-stream). The pair works because each catches what the other can't.

- **Rule layer** (`omp-rules/maintenance-vigilance.md`) catches the model's wrap-up prose mid-stream via regex on phrases like "Task complete" / "Let me know if" / "To summarize". Cheap, full context, but regex-fragile.
- **Extension layer** (`omp-extensions/maintenance-gate/`) catches by `turn_end` event — universal coverage, but post-hoc. Has cooldowns, branch-walks for the override phrase, wall-clock throttle to survive the harness's queued-followUp behavior, and disk-persisted state so closure-resets don't double-fire.

Both release the same way: writing into a capture folder, calling an examen write tool, or stating the literal phrase `"No maintenance needed"`.

Detail on each design decision is in the source comments — both `index.ts` files have extensive justification for why the constants are what they are. The calibration notes in `maintenance-gate/index.ts` (especially the 2026-05-20 incident write-up about `lastFireBranchLength`) are worth reading before you tune the constants.

## Why share this

Two reasons:
1. You're coming from the same `claude-org-template`, so the shape transfers with very little adaptation.
2. The omp ports took real iteration to settle — sharing the working version is cheaper than you re-deriving the same calibrations from scratch.

Ping me if anything's unclear, or if you find a calibration that works better than mine.

— Alex
