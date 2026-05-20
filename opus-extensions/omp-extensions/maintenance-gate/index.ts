/**
 * maintenance-gate
 *
 * Port of ~/.claude/hooks/stop-maintenance-check.py to omp. Uses the
 * `turn_end` event + `pi.sendUserMessage(...)` to synthesize a
 * continuation turn whenever a long session is about to yield control
 * without having captured its work. The synthesized turn becomes the
 * "block" — operator does not get the prompt back until the agent
 * either performs maintenance or explicitly states the override phrase.
 *
 * Paired with the `maintenance-vigilance` TTSR rule
 * (~/.omp/agent/rules/maintenance-vigilance.md) which provides a
 * mid-stream catch via the runtime's abort/inject/continue machinery.
 *
 * Routing:
 *   opus     — session cwd contains /documents/opus
 *   materia  — session cwd contains /documents/materia
 *   other    — extension is a no-op
 *
 * Side effects (only when routed):
 *   - On every turn_end: touches ${ORG_DIR}/instruments/mercury/mercury.wake
 *     to stimulate the Mercury daemon heartbeat (mirrors the Python version).
 *
 * Release conditions (each suppresses for STALENESS_TURNS turns; after
 * that, the gate is eligible to fire again at the next task boundary):
 *   - Session entry count below TRIVIAL_ENTRY_THRESHOLD (always suppresses)
 *   - A capture-class tool succeeded recently (examen writes, or
 *     Write/Edit into inbox|tasks|knowledge|queries|reminders|forge/*)
 *   - The assistant said the override phrase (NO_MAINT_PHRASE) recently
 *   - The gate fired recently (self-cooldown so it doesn't nag every turn)
 *
 * Re-entry: the synthesized continuation turn is guarded by `firingNow`
 * so the gate cannot fire on the immediately-following turn_end.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type Profile = "opus" | "materia" | "other";

const NO_MAINT_PHRASE = "No maintenance needed";

// A turn is the unit of cadence. Setting these conservatively — the
// operator's stated preference is to err toward firing too often over
// firing too rarely, because lost insights are unrecoverable while
// over-firing only costs attention.
//
// The constant was calibrated 2026-05-19 against real session shapes — a
// 43-turn GBA-emulator session (6.5h) and shorter conversational sessions.
// Settled on 4 as a balance: chatty enough to surface reminders near the
// tail end of long context walks, sparse enough not to nag when the
// operator is mid-flow. Tune up if it feels noisy; down if reminders
// are getting lost in long-context work.
const TRIVIAL_ENTRY_THRESHOLD = 10;       // branch entries below which the session is too short to nag
const STALENESS_TURNS = 4;                // see calibration note above
const BRANCH_SCAN_WINDOW = 50;            // last N branch entries that branchSaysOverride scans; keeps cost bounded and gives the same rolling-window semantics

// Wall-clock throttle: a hard upper bound on fire rate that does not depend
// on closure state. Stored in a small JSON file under the org's mercury
// directory; read fresh at each turn_end so it survives any closure
// recreation between events (which is what caused the 2026-05-20 incident
// where 21 follow-ups stacked up in the operator's prompt buffer during a
// single streaming assistant message — turn_end apparently fires multiple
// times per agent-loop step in some configurations, and the JS closure
// holding `lastFireAtTurn` was being recreated between them).
//
// 5 minutes is conservative on purpose. Real "wrap-up" boundaries in an
// active session are rare events (once per major milestone); the
// turn-based staleness logic handles the typical case, and this clock
// only triggers as a safety net when turn-based suppression isn't working.
const FIRE_THROTTLE_MS = 5 * 60 * 1000;

// omp's MCP tool naming uses `mcp__<server>_<tool>` — DOUBLE underscore
// after `mcp`, then SINGLE underscore between server name and method.
// This differs from Claude Code's `mcp__<server>__<tool>` convention.
// All entries below are the omp form. See
// `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/internal-urls/docs-index.generated.ts`
// (mcp-server-tool-authoring.md) for the upstream contract.
const CAPTURE_TOOLS: ReadonlySet<string> = new Set([
  "mcp__examen_task_create",
  "mcp__examen_task_update",
  "mcp__examen_task_complete",
  "mcp__examen_knowledge_create",
  "mcp__examen_knowledge_update",
  "mcp__examen_inbox_capture",
  "mcp__examen_archive",
  "mcp__examen_reminder_create",
  "mcp__examen_reminder_update",
  "mcp__examen_reminder_complete",
  "mcp__examen_reminder_snooze",
  "mcp__examen_reminder_dismiss",
]);

// Match paths whose first folder segment is a capture root. Anchored on
// start-of-string OR a slash/backslash so that relative paths (the omp
// harness's normal shape — `knowledge/practices/foo.md`) match the same as
// absolute paths (`C:/.../knowledge/practices/foo.md`). The trailing
// slash is mandatory so that `knowledge.md` (a file at root) doesn't
// trigger and `my-knowledge-app/foo.md` (folder name with substring) doesn't either.
const CAPTURE_PATH_RE =
  /(?:^|[\/\\])(inbox|tasks|knowledge|queries|reminders|forge[\/\\](?:proposals|handles|output|sessions))[\/\\]/i;

interface GateState {
  // -1 = never observed; otherwise the turnCount value at the moment of
  // observation. Treated as fresh while (current turn - observedAt) < STALENESS_TURNS.
  captureObservedAtTurn: number;
  overrideObservedAtTurn: number;
  // turnCount of the most recent fire; the gate self-suppresses for
  // STALENESS_TURNS after firing so it doesn't nag every other turn.
  lastFireAtTurn: number;
  firingNow: boolean;
  turnCount: number;
}

function detectProfile(cwd: string): { profile: Profile; orgDir: string | null } {
  const norm = cwd.replace(/\\/g, "/").toLowerCase();
  if (norm.includes("/documents/opus")) {
    return { profile: "opus", orgDir: join(homedir(), "Documents", "opus") };
  }
  if (norm.includes("/documents/materia")) {
    return { profile: "materia", orgDir: join(homedir(), "Documents", "materia") };
  }
  return { profile: "other", orgDir: null };
}

/**
 * Persisted state file path. Stored alongside other mercury sentinels.
 */
function gateStatePath(orgDir: string): string {
  return join(orgDir, "instruments", "mercury", "maintenance-gate-state.json");
}

interface GateDiskState {
  /** Wall-clock ms of the most recent fire attempt (not landing in branch). */
  lastFireMs: number;
  /** Branch length at the time of the most recent fire attempt. Used to
   *  detect whether the operator has produced a new prompt since then —
   *  the only signal that actually warrants a new fire. */
  lastFireBranchLength: number;
}

/**
 * Read disk state. Returns zero-defaults on any error / missing file.
 * Zero defaults are safe: "never fired" so nothing is suppressed.
 */
function readGateState(orgDir: string): GateDiskState {
  try {
    const path = gateStatePath(orgDir);
    if (!existsSync(path)) return { lastFireMs: 0, lastFireBranchLength: 0 };
    const data = JSON.parse(readFileSync(path, "utf-8")) as Partial<GateDiskState>;
    return {
      lastFireMs: typeof data.lastFireMs === "number" ? data.lastFireMs : 0,
      lastFireBranchLength:
        typeof data.lastFireBranchLength === "number" ? data.lastFireBranchLength : 0,
    };
  } catch {
    return { lastFireMs: 0, lastFireBranchLength: 0 };
  }
}

/**
 * Persist gate state synchronously. Done before the `pi.sendUserMessage`
 * await so concurrent turn_end handlers reading the file see the update
 * immediately. Best-effort: swallow write errors (the throttle and
 * branch-length checks are safety nets, not correctness-critical).
 */
function writeGateState(orgDir: string, state: GateDiskState): void {
  try {
    const dir = join(orgDir, "instruments", "mercury");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(gateStatePath(orgDir), JSON.stringify(state, null, 2));
  } catch {
    /* swallow */
  }
}

/**
 * Append a Mercury hook-exec.jsonl entry for governance visibility.
 * Mercury's analytics aggregate by hook name — we use the Claude Code
 * legacy name "stop-maintenance-check" so existing aggregations keep
 * working without changes. The `runtime: "omp"` field distinguishes
 * these from the original Python hook's entries.
 */
function logGateFire(orgDir: string, durationMs: number): void {
  const logPath = join(orgDir, "instruments", "mercury", "hook-exec.jsonl");
  const entry = {
    ts: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
    hook: "stop-maintenance-check",
    event: "Stop",
    exit_code: 2, // 2 mirrors Claude Code's "block decision" exit
    duration_ms: durationMs,
    error: null,
    runtime: "omp",
  };
  try {
    const dir = join(orgDir, "instruments", "mercury");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch {
    /* best effort */
  }
}

function stimulateMercury(orgDir: string): void {
  const wakePath = join(orgDir, "instruments", "mercury", "mercury.wake");
  try {
    writeFileSync(wakePath, new Date().toISOString());
  } catch {
    /* best effort — Mercury may not be installed in every tree */
  }
}

function getDocumentedCrossCutting(orgDir: string): Set<string> {
  try {
    const readme = readFileSync(
      join(orgDir, "knowledge", "README.md"),
      "utf-8",
    );
    const rootMatch = readme.match(/## Root Level\n([\s\S]*?)(?=\n## |$)/);
    if (!rootMatch) return new Set();
    const names = [...rootMatch[1].matchAll(/`([^`]+\.md)`/g)].map((m) => m[1]);
    return new Set(names);
  } catch {
    return new Set();
  }
}

function checkKbOrganization(orgDir: string): string[] {
  const knowledgeDir = join(orgDir, "knowledge");
  if (!existsSync(knowledgeDir)) return [];
  try {
    const documented = getDocumentedCrossCutting(orgDir);
    const entries = readdirSync(knowledgeDir, { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          e.isFile() &&
          e.name.endsWith(".md") &&
          e.name !== "README.md" &&
          !documented.has(e.name),
      )
      .map((e) => e.name.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

function buildReminder(profile: Profile, orgDir: string): string {
  const rootKb = checkKbOrganization(orgDir);
  const kbWarning =
    rootKb.length > 0
      ? `\n\n**KB Organization Alert:** ${rootKb.length} file(s) at knowledge root — move to subfolder or document in knowledge/README.md under '## Root Level'. Files: ${rootKb.slice(0, 5).join(", ")}${rootKb.length > 5 ? "..." : ""}`
      : "";

  if (profile === "opus") {
    return `<maintenance-gate>
Stop check — this session ran long and I see no capture writes yet.

Quick eval: did this session produce any of these?

- Reusable insight \u2192 \`knowledge/<subfolder>/<topic>.md\`
- Decision needing operator input \u2192 \`inbox/decisions/<item>.md\`
- Bug to investigate \u2192 \`inbox/investigations/<item>.md\`
- Feature idea \u2192 \`inbox/ideas/<item>.md\`
- Unsorted capture \u2192 \`inbox/captures/<item>.md\`
- New task \u2192 \`tasks/<name>.md\`
- Time-bound item \u2192 \`reminders/<item>.md\`
- Project status shift \u2192 update \`context/current-state.md\`

If yes: capture it now. Writing to one of those paths auto-releases this check.

If no: the literal phrase "${NO_MAINT_PHRASE}" releases this check.${kbWarning}
</maintenance-gate>`;
  }

  return `<maintenance-gate>
MAINTENANCE VIGILANCE CHECK

Before stopping, evaluate this session:

| Signal | Action if Present |
|--------|-------------------|
| New reusable insight/pattern | \u2192 knowledge/<subfolder>/<topic>.md |
| Project status changed | \u2192 Update context/current-state.md, CLAUDE.md, project-map.md |
| New task identified | \u2192 tasks/<name>.md |
| Question worth preserving | \u2192 queries/<question>.md |
| Cross-project pattern | \u2192 Add instantiation to principle lattice |
| Feature idea / future project | \u2192 inbox/ideas/<item>.md |
| Decision needed | \u2192 inbox/decisions/<item>.md |
| Bug to investigate | \u2192 inbox/investigations/<item>.md |
| Quick unsorted capture | \u2192 inbox/captures/<item>.md |
| KB file needs organization | \u2192 Move to appropriate subfolder |

If ANY apply: perform the maintenance NOW.
If NONE apply: state "${NO_MAINT_PHRASE}" and stop.

Be aggressive about capture \u2014 lost insights are unrecoverable.${kbWarning}
</maintenance-gate>`;
}

/**
 * Recursively collect every `string` value reachable from `value`,
 * concatenated with newlines. Tolerant of the event-shape variations
 * the omp harness has shipped (content as nested array of text parts,
 * content as a flat string at the message level, etc).
 */
function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 6) return; // guard against pathological cycles
  if (value == null) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out, depth + 1);
    }
  }
}

function flattenText(value: unknown): string {
  const parts: string[] = [];
  collectStrings(value, parts);
  return parts.join("\n");
}

/**
 * Extract the role of a branch entry or message_end event. Tries both
 * `.message.role` (the documented shape) and `.role` (a flatter shape
 * some harness versions use) so detection survives small shape drift.
 */
function extractRole(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { role?: unknown; message?: { role?: unknown } };
  if (typeof v.role === "string") return v.role;
  if (v.message && typeof v.message === "object") {
    const r = (v.message as { role?: unknown }).role;
    if (typeof r === "string") return r;
  }
  return null;
}

/**
 * Walk backward through the branch until the most recent user-role
 * message. Return true iff that message is one of the gate's own
 * `<maintenance-gate>` injections (i.e. we have already fired since
 * the operator's last real prompt).
 *
 * This is the primary "once-per-operator-turn" suppression: it does
 * not depend on closure state and does not care how long the current
 * operator turn runs (or how many internal `turn_end` events fire
 * inside it). Once the gate's followUp lands in the branch, every
 * subsequent turn_end during the same operator turn sees the followUp
 * as the most-recent user message and bails.
 *
 * Scans the full branch (terminates as soon as it finds the first
 * user-role message, which is fast — typically a few iterations from
 * the tail).
 */
function gateFiredSinceLastOperatorTurn(branch: readonly unknown[]): boolean {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (extractRole(entry) !== "user") continue;
    const text = flattenText(entry);
    return text.includes("<maintenance-gate>");
  }
  return false;
}

/**
 * Count real operator messages (user-role entries that are not gate
 * follow-up injections) at or after the given branch index. Used to
 * decide whether a new fire is warranted: only the operator producing
 * a fresh prompt should "unlock" the gate.
 *
 * This is the load-bearing check for queued-followUp scenarios. The
 * omp harness queues `sendUserMessage` calls and flushes them later
 * (sometimes 20+ minutes later in observed sessions). Between attempt
 * and persistence, the branch does NOT show the pending fire. Using
 * "branch length at last fire attempt" stored on disk gives a stable
 * reference point that does not depend on the followUp landing.
 */
function countRealOperatorMsgsAfter(branch: readonly unknown[], fromIdx: number): number {
  let count = 0;
  for (let i = Math.max(0, fromIdx); i < branch.length; i++) {
    const entry = branch[i];
    if (extractRole(entry) !== "user") continue;
    const text = flattenText(entry);
    if (text.includes("<maintenance-gate>")) continue;
    count++;
  }
  return count;
}

/**
 * Branch-walk override check — scans assistant messages in the branch
 * and releases on first hit of the override phrase. The role filter
 * matters: the gate's own injected reminder text (a user-role message)
 * literally contains the phrase as instructional copy, and that text
 * must NOT count as the operator's release. Uses defensive content
 * flattening so the assistant-content extraction survives shape drift.
 */
function branchSaysOverride(branch: readonly unknown[]): boolean {
  // Only walk the most recent BRANCH_SCAN_WINDOW entries. Combined with
  // the per-observation staleness check in turn_end, this gives a rolling
  // window: a release said many turns ago no longer suppresses, so on
  // long-running sessions the gate continues to nag at task boundaries
  // rather than going silent for the rest of the session.
  const start = Math.max(0, branch.length - BRANCH_SCAN_WINDOW);
  for (let i = branch.length - 1; i >= start; i--) {
    const entry = branch[i];
    if (extractRole(entry) !== "assistant") continue;
    const text = flattenText(entry);
    if (text.includes(NO_MAINT_PHRASE)) return true;
  }
  return false;
}

/**
 * Extract text from a `message_end` event payload. Defensive across
 * event-shape variations but still role-gated to assistant messages
 * (same rationale as branchSaysOverride above).
 */
function messageEndText(event: unknown): string {
  if (extractRole(event) !== "assistant") return "";
  return flattenText(event);
}

/**
 * Strip harness wrapper prefixes from tool names.
 *
 * Some omp deployments run under an outer harness that registers omp's
 * built-in and MCP tools with a `proxy_` prefix (e.g. `proxy_edit`,
 * `proxy_mcp__examen__inbox_capture`). The maintenance-gate matches on
 * unprefixed names, so we normalize before comparison. This is a no-op
 * for direct omp sessions.
 */
function normalizeToolName(name: string): string {
  return name.startsWith("proxy_") ? name.slice("proxy_".length) : name;
}

function pathFromToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  // Common shapes: { file_path }, { path }, { target }, omp Write/Edit input.
  const obj = input as Record<string, unknown>;
  const candidates = [obj.file_path, obj.path, obj.target, obj.filePath];
  for (const c of candidates) {
    if (typeof c === "string") return c;
  }
  // Fallback: stringify so the regex can still scan nested fields.
  try {
    return JSON.stringify(obj);
  } catch {
    return "";
  }
}

export default function maintenanceGate(pi: ExtensionAPI): void {
  let profile: Profile = "other";
  let orgDir: string | null = null;

  const state: GateState = {
    captureObservedAtTurn: -1,
    overrideObservedAtTurn: -1,
    lastFireAtTurn: -1,
    firingNow: false,
    turnCount: 0,
  };

  pi.on("session_start", async (_event, ctx) => {
    ({ profile, orgDir } = detectProfile(ctx.cwd));
  });

  // Watch capture-class tool successes during the session.
  pi.on("tool_result", async (event) => {
    if (!orgDir) return;
    if (event.isError) return;
    if (CAPTURE_TOOLS.has(normalizeToolName(event.toolName))) {
      state.captureObservedAtTurn = state.turnCount;
    }
  });

  // Watch file writes into capture folders on the way in (input is authoritative).
  pi.on("tool_call", async (event) => {
    if (!orgDir) return;
    const tn = normalizeToolName(event.toolName);
    if (tn !== "write" && tn !== "edit") return;
    const target = pathFromToolInput(event.input);
    if (target && CAPTURE_PATH_RE.test(target)) {
      state.captureObservedAtTurn = state.turnCount;
    }
  });

  // Catch the override phrase the moment streaming ends, independent of
  // when the assistant message lands in the branch. This eliminates the
  // turn_end branch-read timing race.
  pi.on("message_end", async (event) => {
    if (!orgDir) return;
    const text = messageEndText(event);
    if (text && text.includes(NO_MAINT_PHRASE)) {
      state.overrideObservedAtTurn = state.turnCount;
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (!orgDir) return;

    // Read persisted state ONCE up top. Both checks below use it.
    const diskState = readGateState(orgDir);
    const now = Date.now();

    // SAFETY NET 1: wall-clock throttle. Hard upper bound on fire rate
    // independent of any closure state or branch staleness. Covers the
    // race window where sendUserMessage was called but the followUp has
    // not yet appeared anywhere visible.
    if (
      diskState.lastFireMs > 0 &&
      now - diskState.lastFireMs < FIRE_THROTTLE_MS
    ) {
      stimulateMercury(orgDir);
      return;
    }

    // Every turn_end advances the closure clock — even when we early-
    // return below. This keeps the in-memory staleness window rolling.
    state.turnCount++;
    stimulateMercury(orgDir);

    // Re-entry guard: the very next turn_end after we synthesize is ours.
    if (state.firingNow) {
      state.firingNow = false;
      return;
    }

    const branch = ctx.sessionManager.getBranch();
    if (branch.length < TRIVIAL_ENTRY_THRESHOLD) return;

    // PRIMARY SUPPRESSION: has the operator spoken since our last fire
    // attempt? This is the load-bearing check for the queued-followUp
    // scenario observed 2026-05-20: the harness queues sendUserMessage
    // calls and flushes them in bulk minutes-to-hours later. Between
    // attempt and persistence, the branch does NOT show the pending fire,
    // so a branch-walk-for-most-recent-user-msg returns "operator spoke
    // last" and lets multiple fires queue up.
    //
    // The disk-stored branch length at attempt time is stable: even if
    // the followUp never lands, even if the JS closure is recreated,
    // even if many turn_end events fire in rapid succession, we know
    // exactly how many real operator messages exist in branch positions
    // at-or-after our last attempt. Zero => suppress.
    //
    // Handles cross-session safety: if diskState.lastFireBranchLength
    // exceeds current branch.length, this is a new session — treat as
    // never-fired (count from 0).
    const sinceRef =
      diskState.lastFireBranchLength <= branch.length
        ? diskState.lastFireBranchLength
        : 0;
    if (sinceRef > 0) {
      const opMsgsSinceLastFire = countRealOperatorMsgsAfter(branch, sinceRef);
      if (opMsgsSinceLastFire === 0) return;
    }

    // SAFETY NET 2: branch walk for most-recent user message. Redundant
    // with the disk-state check above in normal operation, but catches
    // the case where disk state was somehow cleared mid-session while
    // the branch already contains a recent followUp.
    if (gateFiredSinceLastOperatorTurn(branch)) return;

    // Freshness: an observed capture or override suppresses the gate only
    // for STALENESS_TURNS turns after it was seen. On long sessions
    // (million-token range), captures from many turns ago shouldn't keep
    // the gate silent for the rest of the session — new maintenance may
    // be owed at the next task boundary.
    //
    // The same staleness window also applies to our own previous fire:
    // having just nagged, suppress for STALENESS_TURNS before nagging
    // again. Without this, a session where the operator never says the
    // release phrase and never captures would see the gate fire every
    // other turn (the firingNow guard skips one turn, then nothing else
    // suppresses). The lastFireAtTurn check enforces a real cooldown.
    const captureFresh =
      state.captureObservedAtTurn >= 0 &&
      state.turnCount - state.captureObservedAtTurn < STALENESS_TURNS;
    const overrideFresh =
      state.overrideObservedAtTurn >= 0 &&
      state.turnCount - state.overrideObservedAtTurn < STALENESS_TURNS;
    const recentlyFired =
      state.lastFireAtTurn >= 0 &&
      state.turnCount - state.lastFireAtTurn < STALENESS_TURNS;

    if (captureFresh) return;
    if (overrideFresh) return;
    if (recentlyFired) return;

    // Fallback: scan the rolling branch window for the override phrase
    // (handles the case where message_end's text extraction missed it).
    if (branchSaysOverride(branch)) return;

    const fireStart = Date.now();
    state.firingNow = true;
    const previousLastFireAtTurn = state.lastFireAtTurn;
    state.lastFireAtTurn = state.turnCount;
    // Persist BOTH the wall-clock timestamp AND the branch length at
    // attempt time, synchronously before the sendUserMessage await.
    // The branch length is what makes the operator-message-since-last-fire
    // check stable against the harness's followUp queue: even if our
    // followUp doesn't appear in the branch for 20+ minutes, the disk
    // record of "we tried to fire when branch was at length N" is durable
    // and lets subsequent turn_end handlers correctly suppress.
    writeGateState(orgDir, {
      lastFireMs: fireStart,
      lastFireBranchLength: branch.length,
    });
    const reminder = buildReminder(profile, orgDir);
    try {
      await pi.sendUserMessage(reminder, { deliverAs: "followUp" });
      logGateFire(orgDir, Date.now() - fireStart);
    } catch (err) {
      // If synthesis fails, surface but don't crash the runner. The gate
      // degrades to a logged miss; next turn_end can still re-evaluate.
      pi.logger?.warn?.(
        `maintenance-gate: sendUserMessage failed: ${(err as Error)?.message ?? String(err)}`,
      );
      state.firingNow = false;
      state.lastFireAtTurn = previousLastFireAtTurn;
      // Roll back the persisted state so the failed attempt doesn't
      // eat the throttle window or block the operator-message check.
      writeGateState(orgDir, diskState);
    }
  });
}
