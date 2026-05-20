---
name: maintenance-vigilance
description: TTSR rule — interrupt end-of-task prose before commit when capture is owed
condition:
  - "\\b([Tt]ask complete|[Aa]ll done|[Ll]et me know if you|[Rr]eady (for review|when you|for further)|[Tt]o summari[sz]e|[Ii]n summary|[Tt]hat (covers|should be) it|[Hh]ope this helps)\\b"
  - "(^|\\n)## ?Summary\\b"
interruptMode: prose-only
---

You appear to be wrapping up a turn. Before producing the final summary, run the maintenance check:

- Reusable insight, pattern, or lesson learned → `knowledge/<subfolder>/<topic>.md`
- Decision pending operator input → `inbox/decisions/<item>.md`
- Bug to investigate → `inbox/investigations/<item>.md`
- Feature idea or future project → `inbox/ideas/<item>.md`
- Unsorted observation worth keeping → `inbox/captures/<item>.md`
- Task identified during the work → `tasks/<name>.md`
- Project status shifted → update `context/current-state.md`

If any apply: capture it **now**, then continue with the summary. Writing into one of those paths auto-releases this check for the rest of the session.

If none apply: the literal phrase "No maintenance needed" releases this check; finish the summary as written.

Paired companion: `~/.omp/agent/extensions/maintenance-gate/` runs the same check at `turn_end` and synthesizes a continuation if the rule was missed mid-stream. Both layers are deliberate — the rule catches early (cheaper, model still has full context), the extension catches late (universal, no regex false-negatives).
