# Mercury Lessons, Distilled

## Orientation

Mercury is a persistent-agency daemon that runs alongside a personal organization tree — a filesystem-rooted knowledge graph of tasks, notes, inbox captures, and pipeline artifacts. Its job is to keep the graph alive between sessions: surface drift, consolidate redundant notes, audit link density, run background synthesis pipelines during idle periods, and propose its own improvements for operator review. This document isn't about how to build Mercury. It's about the lessons learned building it — most of which are about knowledge graphs that rot, autonomous maintenance loops that silently misbehave, and the governance needed when software writes into its own substrate. Nothing here is prescriptive. Take what's useful; ignore the rest.

Your system doesn't need a daemon. The useful lessons aren't "build one" — they're about the shape of the problem Mercury solves, the failure modes you'll see with or without automation, and the interfaces that matter whenever *something* (a cron job, a manual ritual, a subagent) tries to tend a knowledge graph on your behalf.

---

## On the knowledge graph itself

**Container before corpus.** The deepest, most recurring lesson. A knowledge graph is a container (folder structure, frontmatter schema, tag system, README index, dashboards). The container is designed once and then ships. The corpus — the actual content, the cross-links, the freshness of summaries — is an ongoing discipline problem that nobody crystallizes. The container signals progress and feels done; the corpus quietly rots behind it. The surface lies about the substance. A README claiming 165 articles across 11 folders after 40+ articles have been added is still a valid README; it just isn't a *true* one. Counts typed by a human are drift waiting to happen. Where derivation is cheap — compute the count from frontmatter, scan the folder, surface the oldest unreviewed item — it removes a whole class of lies by construction. Where derivation isn't cheap, the zero-cost intervention is to drop the declared count entirely and let the consumer ask the authoritative tool.

**Articles that aren't linked don't exist.** A wikilink convention stated in the README but not enforced is a dead letter; articles become invisible through graph navigation the day they're written. One specific finding: the knowledge tree's own analytical articles diagnosed "hub-spoke propagation gap" as an external failure mode, then exhibited it — the convention was declared in the hub but never propagated to the spokes agents actually reach for when orchestrating work. The hub is authoritative; the spokes are operational. If the spoke doesn't mention the convention, the convention doesn't exist in practice.

**The KB exhibits its own diagnosed failures.** Once you develop enough structural vocabulary to name failure modes ("stale index," "orphan node," "canonicalization at the gate"), a reflexive audit becomes essentially free — just apply each diagnosed pattern to the KB's own infrastructure. We kept finding that the most valuable transfer of pattern-knowledge wasn't across domains but *from the KB back onto itself*. If you ever capture a pattern about systems decaying, check whether your own system is decaying that way. It almost always is.

**Graph connectivity is the retrieval substrate, not an aesthetic.** The friend's first complaint — too few inter-article connections — isn't a tagging problem. It's the *primary determinant of whether future-you can find anything*. Tools that surface "articles with zero inbound links" or "articles in a folder but not in the index" are cheap to write and radically change the texture of the graph over time. One of Mercury's simplest and most effective light actions was `kb-link-density` — just find the orphans. Something equivalent done weekly-by-hand would catch most of the decay. The link audit is the single highest-leverage maintenance action we found.

**Hub/spoke asymmetry is universal.** In any convention system, the hub document (CLAUDE.md, README, style guide) is where additions go, and the spoke documents (per-project files, per-recipe files, per-tool files) are what consumers actually read. Adding a convention only to the hub is invisible to everyone who reaches for the spoke. When we added a provenance requirement to the forge README, every recipe file that orchestrators actually copy-pasted from still produced zero provenance. Propagation checklists or cross-reference audits solved it — but the meta-lesson is that a convention stated once is a convention stated nowhere.

**Retrieval beats organization for the second complaint.** The friend's second pain — knowledge docs not getting consulted consistently — often isn't solved by reorganizing. It's solved by making search cheap at the moment of need. A local semantic index that the model can query during a working session is more durable than any folder taxonomy, because it doesn't depend on the model remembering where to look. The folder structure becomes a humane organizing fiction for the operator; retrieval is what actually connects the model to prior work.

**Orientation over multiplication.** When adding depth — whether subagents, scheduled jobs, or pipelines — every new layer has to inherit *telos*, not just tools. Capability without orientation produces restless capability that generates more work than it absorbs. A subagent that only gets a prompt and file access but not the principle lattice will wander. We found that inheriting a shared CLAUDE.md, the project's voice document, and a pointer to knowledge/ was the difference between subagents that did useful work and subagents that produced competent-looking sludge.

**Naming substitutes for deciding.** When triage feels hard, vocabulary accretes. "Incubating," "paused," "review-needed" — these can become containers for *not deciding*. A status field is only meaningful when transitions between statuses are actually happening. If everything trends toward the holding-pen statuses, the taxonomy is performing finality-avoidance.

**Scaffolding recursion.** The instrument you built to reduce load can become load. The proposal you wrote to close stale proposals becomes a stale proposal. A "close-90-percent-projects" meta-task that sits in the backlog for 58 days is the purest diagnostic — the clean-up project is indistinguishable from the things it was supposed to clean up after. If the instrument's own outputs appear in its own review queue, the boundary has failed. Any ratify-path design needs to be done *before* adding the instrument that produces things to ratify — not after.

---

## On autonomous maintenance processes

Even without a daemon, the lessons about what it takes to have *something* maintain a knowledge graph hold up.

**Stimulus must be creative work, not passive observation.** Mercury originally treated hook fires and page-loads as "the operator is active," which meant Mercury never got to idle and never ran its synthesis passes. The fix was recognizing that *reading* isn't activity for the purposes of a maintenance loop — only modifications are. Any scheduled maintenance needs a working definition of "something new happened" that excludes its own observation of state.

**Measure delta on filesystem mtime, not on git commits or any derived state.** We decoupled "auto-commit" and "dream delta" explicitly because they read different clocks. Git commits don't touch mtime; only content writes do. If your audit is going to detect "what's changed since last pass," mtime is the one signal that actually tracks authorship.

**Gate on meaningful delta, not on time.** A time-based trigger (every N hours) runs the same analysis over the same unchanged data. A delta-based trigger (new files, modified tasks, new inbox items, pending feedback) runs only when there's something to process. We kept a 24-hour catch-all as a floor for genuinely-quiet-but-something-should-happen-sometime, but the primary gate was semantic.

**Per-action cooldowns, not global cooldowns.** Mercury's dream planner initially applied a single cycle-level cooldown, so to prevent a duplicate `inbox-age-report` we were blocking *all* dream activity. Per-action cooldown timestamps — 24h for deterministic light actions, 12h for expensive recipe actions — let fresh actions proceed while blocking the repeats. The same idea applies to manual rituals: the question isn't "did we already do maintenance this week?" but "did we already do *this specific* maintenance recently?"

**Completed work must produce different output next time or the loop rots.** Early dream actions ran the same filesystem scan that produced byte-identical output every cycle. Eleven identical files accumulated overnight. The fix was making delta-gating cover the action's input: if the files this action reads haven't changed, don't run it. This seems obvious in retrospect and wasn't at the time.

**Adaptive pacing.** Mercury's heartbeat runs fast when the operator is active and slow when idle. Fixed intervals either burn cycles when nothing's happening or introduce latency when something is. The decay model — alert → elevated → resting → drowsy → dreaming, with any stimulus snapping back to alert — is a clean abstraction for "responsiveness when relevant, quiet when not." Works for any polling system.

**Cooldown penalties must scale with work completed.** If a cycle gets interrupted before any action ran, applying the full cooldown punishes a timing mismatch. We zero-or-near-zero the penalty when nothing happened and apply full cooldown only when substantial work completed. This matters for *any* retry/cooldown scheme — the penalty should reflect actual work, not the mere fact that the cycle started.

**Plans persist across restarts.** A dream cycle with 5 planned actions shouldn't lose state when the process restarts. We write the plan to disk as soon as it's formed and execute from the persisted plan. But — critically — completed plans must be *deleted* at completion. A completed plan file left on disk looks like "work to resume" on next scan, and the system repeatedly "completes" the stale plan, spuriously advancing its delta baseline and erasing real changes. Completion cleanup at the point of completion AND defensive cleanup at startup.

**Resource gates block starting new work, not finishing in-progress work.** A budget check at the top of dispatch prevented cycle-completion detection when the budget was exactly exhausted; the plan never got the final tick that would have marked it complete. Completion paths must always be reachable. Resource constraints prevent new work, never cleanup.

---

## On governance of self-modifying systems

Mercury can write into its own substrate — an inbox capture, a proposal document, a health probe. The governance question isn't "should software be able to write files" but "which writes, under what authentication, with what blast radius?"

**Tiered capability is vocabulary, not ceremony.** We labeled four tiers — Nigredo (read-only), Albedo (bounded autonomous writes to ephemeral locations), Citrinitas (operator-authenticated writes), Rubedo (invocation of allow-listed recipes) — and the labels encoded real structural claims. The claims, not the names, are what matters:

- There is a class of writes that are *always* safe (ephemeral, append-only, to spaces designed to absorb junk). Inbox captures and dream outputs live here.
- There is a class of writes that need authentication (modifying a reminder's status). The authentication doesn't have to be cryptographic — a specific inbound channel, a command from a trusted UI, an explicit flag — but it has to be *an observable event*, not an autonomous decision.
- There is a class of invocations (running expensive pipelines, sending external messages) that should be allow-listed and audited, even when autonomous.
- There is a class of writes that are *never* safe autonomously: the governance file itself, the structural layout, the knowledge articles, source code. These can only be changed via proposal — a file the operator reviews and merges.

**The constitutional pattern: what constrains change is encoded at a higher tier than the thing doing the changing.** Mercury can propose changes to its own governance but cannot enact them. The rule-making layer is one level higher than the rule-following layer. Ordinary law is easy to change; constitutional law requires supermajority. This works even if your "daemon" is just "you, on a schedule, running a maintenance ritual" — the point is that the *rules* about what the ritual may do are versioned separately and changed deliberately.

**Capability-governance gap.** The recurring anti-pattern: a new capability ships before the governance guard that makes it safe. Mercury gained SMS ingestion before it had a sender allowlist, and processed messages from every contact until the bug surfaced. A new recipe was added to the registry but not added to ALLOWED_RECIPES — the planner kept selecting it and the governance layer silently blocked it, wasting budget on actions that couldn't execute. The fix is structural: treat the allow-list update as part of shipping the capability, not a follow-up. Build the guard and the capability together or don't ship either. Silent blocking is worse than loud blocking — the system exercises capability continuously, and a missing guard with no error signal is the worst of both worlds.

**Minimal privilege stays minimal by staying additive.** When Mercury needed to update reminder frontmatter on operator command, we didn't widen the autonomous write set — we added a separate `canWriteAuthenticated()` path with narrow field scope (three fields, nothing else). The expansion was additive, not erosive. Whenever adding a new capability tempts you to broaden an existing permission, ask whether it's actually a *new kind of permission*.

**Delete is not a capability.** `canDelete()` returns false, always. Rename and move are allowed; permanent deletion isn't. This is cheap insurance — the storage cost of never deleting is trivial, and the recovery cost of an accidental autonomous deletion is high. The asymmetry is worth the discipline.

---

## On self-observation and drift detection

**Systems need a way to notice their own decay.** The diagnostics are mostly simple filesystem operations:

- Orphan scan (articles with zero inbound wikilinks)
- README reconciliation (declared counts vs actual file counts)
- Stale CLAUDE.md check (age relative to project activity)
- Governance-capability alignment (every registered recipe appears in the allow-list, every allow-list entry still exists)
- Inbox age report (oldest items in each bin)
- Completion drift (status-complete items still living in the "active" folder)
- Review queue age (oldest unreviewed dream output, oldest pending proposal)

None of these require ML, semantic analysis, or a daemon. They're shell scripts or cron jobs. The work is in noticing you should write them — the first lesson of "container before corpus" is that nobody writes these until they feel the pain.

**Surface the problem where it's readable.** The anti-pattern is reports that require someone to *go look*. The pattern is a dashboard or index that shows the diagnostic inline — `context/current-state.md` surfacing the oldest unreviewed item, a README with "42 files / index claims 38" visible at the top. The container should tell on itself. Metrics that shame the container when the corpus trails.

**Dual-channel self-maintenance.** Mercury's proposal system writes improvements in *two* forms: a human-readable proposal document in the repo (with frontmatter status) *and* a git branch carrying the actual diff. The operator can approve by editing the frontmatter, by merging the branch, or by rejecting either. The two channels fail gracefully — if one gets out of sync, the other is canonical. For systems without git, the same idea applies: capture the proposed change both as readable intent (what + why) and as applicable artifact (the actual diff or script).

**Proposals expire.** Pending proposals older than 14 days were auto-marked stale and their branches force-deleted. The review-queue-that-doesn't-shrink is a container-before-corpus symptom — proposals accumulate faster than they're reviewed and the queue becomes noise. Expiration is easier than perfect review; stale work should fall off the list rather than occupy attention indefinitely.

**The organ that observes is built; the organ that ratifies is not.** This is the forge dream synthesizer's framing of the scaffolding-recursion pattern. Building the thing that *detects* drift is satisfying; building the thing that *closes the loop on* drift is thankless. The system has a structural bias toward more observation instruments and fewer ratification channels. It's worth naming this bias and allocating attention against it.

---

## On the operator loop

**Feedback staging.** Mercury collects operator corrections into an append-only log (thumbs-down on a response, misclassified intent, operator SMS that rigid parsing missed). During idle, it stages the accumulated data into a markdown document and spawns a synthesis pipeline that produces *prompt fixes* — copy-pasteable edits to the system prompt. The operator applies the fixes the next morning. The pattern closes the loop on "the daemon made wrong classifications" without ever self-modifying the prompt.

**Conversation memory as two tiers.** One tier is the raw transcript (for audit). A second tier is a distilled rolling summary that gets *injected into prompts* — compressed for cheap models, fuller for expensive ones. The insight: the interpreter interpreting "snooze this reminder" doesn't need the last three weeks of conversation; the query surface answering "what did I ask about earlier?" genuinely does. Differential injection by consumer need.

**Reply context must inherit inbound surface.** A command arriving via channel X should be replied-to via channel X. This sounds obvious, is always missed. The receiving code tags the message with its surface; the reply code often hardcodes a default. Threading the surface through the dispatch chain was a small fix that caught a surprising amount of latent confusion.

**Classifiers and executors are distinct stages.** When a classifier says "route this to tool-using executor X," stage N+1 should be X, not another classifier. Re-classifying is wasted work at best and a failure loop at worst. The same message getting "interpreted" three times through three different models before reaching an actual action is a smell.

**Separate semantic context from dashboard metrics.** Mercury's `lastNotification` field served two masters: "what should the NL interpreter resolve 'done' against?" and "what does the dashboard display as the last thing Mercury did?" A query to the assistant polluted the semantic field, so "done" said after a query tried to complete the query instead of the last reminder. When a field serves two purposes, split it; one narrow (semantic, consumers depend on it), one broad (display, tracks everything).

**Phase-derived state over sentinel-derived state.** External UIs that watched for a short-lived sentinel file were wrong roughly whenever they looked — the file exists for one cycle and gets consumed. The daemon's own health probe (a JSON file written every cycle with computed state) is the public API. External observers should read it, not guess from artifacts of the control plane.

---

## On failure modes that look like success

The sneaky ones — where the logs say "completed" and the work didn't happen.

**Stale dream plan causing spurious completion.** A completed plan file left on disk plus a restart = Mercury loads the old plan, sees "currentIndex == actions.length," calls endCycle, advances the delta baseline to *now*, erases all accumulated changes. Zero actions ran; the log says "cycle complete." Every few hours new changes accumulate past the advancing baseline and the same phantom cycle repeats. Lesson: terminal-state files must be deleted *at* the point of completion, not relied on to be overwritten later. Completion cleanup is not optional.

**Budget gate blocking completion detection.** A resource check at the top of dispatch prevented the final "am I done?" tick from running. All actions had executed; the plan was complete on disk; but endCycle was never called because the budget gate returned early. The broader rule: finishing in-progress work must not share a gate with starting new work.

**Delta scanner with invisible blind spots.** Mercury's scanner walked inbox, tasks, knowledge, pipelines, feedback. It did *not* walk `instruments/*/src/` — so six hours of coding on an instrument produced zero delta, and Mercury correctly said "nothing to do" while the operator saw no dream output and worried something was broken. Nothing was broken; the scanner's scope was deliberate. But the operator had no way to know the difference between "Mercury is asleep because nothing changed" and "Mercury is broken." Whatever the scope of your drift detector is, document it loudly; people will assume it covers what they think it should cover.

**Semantic context vs dashboard metric confusion.** (Covered above under operator loop — worth noting it also belongs here, because the symptom is a dashboard showing correct data and a downstream decision quietly going wrong.)

**Hook-level signal suppression creating deadlock.** An early "fix" to prevent a race condition stopped the hook from writing the wake file at all when dreaming was active. The inner layer (Mercury's `checkWake`) was designed to handle that case correctly — consume the signal, record that an operator is present, defer heartbeat stimulation. The outer layer removed the signal entirely, so Mercury couldn't know the operator was there at all. Two enforcement layers handling the same concern: the outer layer suppressing the signal silently violates the inner layer's design assumptions. Resource gates should prevent starting work, not interfere with observing it.

**Forced state transitions without backdated conditions.** Setting `state = "dreaming"` while `lastStimulus = Date.now()` means the next auto-decay immediately pulls the state back. Forcing a state machine requires aligning the inputs the state transitions evaluate. Timer-based transitions: backdate the timer. Threshold-based: set the metric past the threshold. The invariant is that after forcing, the transition function must *agree* with the forced state.

**Dashboards showing "unresponsive" for healthy daemons.** Vitrum used a fixed 120-second staleness threshold; Mercury's dreaming phase writes its health probe every 300 seconds. Every dreaming cycle tripped the alarm. Fixed thresholds against variable-rate producers lie. The threshold must scale with the producer's declared interval.

**Silent catch blocks swallowing command-level failures.** Auto-commit ran `git diff --pathspec-from-file=-` for months. That flag doesn't exist for `git diff`. The command returned exit 129, the catch block swallowed it, and the log said "no diff content — skipping" on every cycle despite real changes. Always log the error in subprocess catch blocks, even if the error is "expected" in some cases. Silent handling of unexpected errors is how bugs live for months.

**Stale processes racing for command files.** Two Mercury instances running (one from a scheduled task at login, one started manually for testing) both polled the same command-file drop directory. Whichever read first won — and on Windows, neither Task Manager nor WMI reveals which one. Debug logs on the new process were empty because the stale process intercepted everything. Single-instance enforcement (or at minimum, detection) is a prerequisite for file-drop IPC.

**Timestamps as cross-instrument contract.** Changing Mercury's timestamp format from UTC to local broke Vitrum's health parser silently — the Rust side required RFC3339 with timezone designator. Format changes in one instrument can break parsers in a sibling instrument that read the same files. When the same file is read by multiple consumers, its format is a contract, not an implementation detail.

---

## On small-model and subprocess lessons

Briefer; probably tangential to the friend's immediate pain, but transferable where relevant.

**Structured output suppresses reasoning in thinking models.** A 3B thinking model that reasoned freely produced 2000-token chains of `<think>` before answering — slow but accurate. The same model with JSON schema enforcement responded in 50 tokens, 30× faster, and started pattern-matching instead of reasoning. Accuracy dropped. Format enforcement and deliberation capacity trade off; pick deliberately.

**Bigger models aren't always better at classification.** On a 43-test Mercury classifier battery: Sonnet 79%, Haiku 86%, a 3B local thinking model 95%. Classification is constraint-following, not reasoning — bigger models' stronger priors override the prompt's specific definitions. The 3B model with weaker priors followed the rules more literally.

**Hard rules beat examples for small models.** "ALWAYS use X when Y" outperformed "here's an example of X." Negative examples matter too: "snooze is NOT for new reminders" stopped the confusion that no amount of positive examples cured.

**Escape hatches must be labeled.** Small models force-fit the wrong action rather than escalating when they encounter something outside their enum. An explicit "when you can't do this, use `query` to escalate" rule turned dozens of wrong classifications into correct escalations.

**Stubborn priors require code post-processing.** A model mapped "tomorrow" to a 2h snooze regardless of prompt instructions through four prompt iterations. The training data's priors won. A regex in TypeScript override fixed it in five minutes. Prompt engineering is not a cure for stubborn priors.

**Idle timeouts beat wall timeouts for subprocess calls.** A 30-second wall timeout kills a 45-second Opus call that was working. An idle timeout that resets on every stdout chunk kills only truly hung processes. Use both — idle as primary, wall as absolute ceiling — and neither will fire on a slow-but-active process.

**KV cache sessions are a 30× speedup.** Rebuilding a 40k-token system prompt on every query invalidated the inference server's cache every time. Building the prompt once at session start and appending messages within the same session saves 2+ minutes per follow-up query.

**Subprocess path resolution needs an explicit org root.** Paths relative to the caller's cwd and paths relative to the subprocess's cwd live in different reference frames. The bug hides until an agent reads a file it was supposed to write. Normalize to an explicit root at the boundaries; never mix reference frames.

**Every surface where the authoring model inscribes its defaults is a seam.** Hooks with regex extraction tuned to the authoring model's phrasing. System prompts that assume the author's verbosity profile. Context-load rituals sized for a model that scans-and-retains, handed to a successor that reasons-on-demand. Magic-phrase release conditions like "No maintenance needed" that break the moment a successor phrases it differently. The remedy is explicit-over-implicit: format contracts rather than register contracts, budgets enforced externally rather than self-regulated, context requested rather than pushed.

---

## Closing note

Your system doesn't need Mercury. Most of what Mercury does can be done in 50 lines of shell, a weekly ritual, or a subagent you invoke deliberately. What Mercury taught was the shape of the problem — that a knowledge graph without active tending *will* rot; that the rot takes specific, nameable forms (orphan articles, stale indexes, un-propagated conventions, reflexive failures where the KB exhibits what it diagnoses); that making the substance visible to yourself is the highest-leverage intervention you can make; that the difference between a corpus and a container is the difference between something alive and something well-organized but dead.

The two specific complaints you mentioned — too few connections between articles, and articles not getting consulted — are the two canonical symptoms of a container-maintained-at-the-expense-of-corpus. The link-density complaint is resolved by treating cross-linking as a first-class maintenance action (a weekly orphan scan is astonishingly effective; if you can afford to spend one cycle checking every article for at least one meaningful link you already have, the graph will densify on its own). The consultation complaint is resolved in part by retrieval (making search cheap at the moment of need), in part by ensuring articles link to their operational sites (spokes, not just the hub), and in part by surfacing them in the summaries and dashboards the model already reads on orientation.

The knowledge tree itself is the canonical source for any of this. The articles most worth reading on specific items: `container-before-corpus`, `hub-spoke-propagation-gap-in-convention-systems`, `reflexive-pattern-application-kb-exhibits-its-own-diagnosed-failures`, `scaffolding-recursion`, `orientation-over-multiplication-agent-depth-without-ennui`, `capability-governance-gap-pattern`, `mercury-stale-dream-plan-causes-infinite-spurious-cycle-completion`, `phase-derived-ui-state-over-sentinel-derived-ui-state`, and `agent-architected-environments-inscribe-authoring-model-profile`. None of them are long.
