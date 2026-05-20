/**
 * session-orient
 *
 * Port of ~/.claude/hooks/session-start-orient.py to omp. On session_start,
 * emits a compact `<session-context>` custom_message containing:
 *   - task counts by status (with names for blocked / review)
 *   - inbox breakdown by subfolder
 *   - Mercury queue state (pending proposals + unreviewed pipelines)
 *   - reminder counts (active / past-due / upcoming 7d)
 *   - pointers to authoritative orientation files (CLAUDE.md, voice.md, etc.)
 *
 * Designed to stay under ~1KB. Detail lives in the source files; the
 * orientation only surfaces what has changed since last session and tells
 * the agent where to read on demand.
 *
 * Resume safety: scans the session branch for a prior `session-orient`
 * custom_message; if present, skips re-emission (matches the Python hook's
 * `data.source === "resume"` early-out).
 *
 * Mercury wake: touches `${ORG_DIR}/instruments/mercury/mercury.wake` to
 * stimulate the daemon heartbeat. Belt-and-suspenders with the
 * maintenance-gate extension's turn_end write.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, sep } from "node:path";
import { homedir } from "node:os";

type Profile = "opus" | "materia" | "other";

interface ProfileInfo {
  profile: Profile;
  orgDir: string | null;
}

interface TaskMeta {
  filename: string;
  status: string;
  tags: string[];
  blockedBy: string[];
  reviewNeeded: string;
}

interface ReminderCounts {
  active: number;
  pastDue: number;
  upcoming7d: number;
}

interface InboxBreakdown {
  total: number;
  bySubfolder: Map<string, number>;
}

interface MercuryQueue {
  pendingProposals: number;
  pendingPipelines: number;
}

const TASK_STATUSES = ["active", "blocked", "review", "backlog", "incubating", "paused"] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

const INBOX_SUBFOLDERS = ["captures", "ideas", "decisions", "investigations", "emails", "tickets"];

// ---------------------------------------------------------------------------
// Profile detection
// ---------------------------------------------------------------------------

function detectProfile(cwd: string): ProfileInfo {
  const norm = cwd.replace(/\\/g, "/").toLowerCase();
  if (norm.includes("/documents/opus")) {
    return { profile: "opus", orgDir: join(homedir(), "Documents", "opus") };
  }
  if (norm.includes("/documents/materia")) {
    return { profile: "materia", orgDir: join(homedir(), "Documents", "materia") };
  }
  return { profile: "other", orgDir: null };
}

// ---------------------------------------------------------------------------
// Minimal frontmatter parser — mirrors the Python `parse_frontmatter` semantics:
// only top-level `key: value`; lists in inline `[a, b]` form; bare keys
// followed by `- item` lines on subsequent lines also captured as arrays.
// ---------------------------------------------------------------------------

function parseFrontmatter(filePath: string): Record<string, unknown> {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return {};
  }
  if (!content.startsWith("---")) return {};
  const parts = content.split(/^---\s*$/m, 3);
  if (parts.length < 3) return {};
  const body = parts[1].trim();
  const result: Record<string, unknown> = {};
  const lines = body.split("\n");
  let pendingKey: string | null = null;
  let pendingList: string[] | null = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    // Continuation of a multi-line list?
    if (pendingKey && /^\s+-\s+/.test(line)) {
      pendingList!.push(line.replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, ""));
      continue;
    }
    if (pendingKey) {
      result[pendingKey] = pendingList!;
      pendingKey = null;
      pendingList = null;
    }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      result[key] = inner
        ? inner.split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""))
        : [];
    } else if (value === "" || value.toLowerCase() === "null") {
      // Empty → possibly multi-line list to follow.
      pendingKey = key;
      pendingList = [];
      result[key] = null;
    } else {
      result[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  if (pendingKey) {
    result[pendingKey] = pendingList!;
  }
  return result;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// ---------------------------------------------------------------------------
// Scanners
// ---------------------------------------------------------------------------

function listMd(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".md") && d.name !== "README.md")
      .map((d) => join(dir, d.name));
  } catch {
    return [];
  }
}

function scanTasks(orgDir: string): Record<TaskStatus, TaskMeta[]> {
  const tasksDir = join(orgDir, "tasks");
  const result: Record<TaskStatus, TaskMeta[]> = {
    active: [],
    blocked: [],
    review: [],
    backlog: [],
    incubating: [],
    paused: [],
  };
  if (!existsSync(tasksDir)) return result;

  const toMeta = (filePath: string, statusOverride?: TaskStatus): TaskMeta | null => {
    const meta = parseFrontmatter(filePath);
    if (asString(meta.type) !== "task") return null;
    const status = statusOverride ?? (asString(meta.status) || "active");
    return {
      filename: basename(filePath, ".md"),
      status,
      tags: asArray(meta.tags),
      blockedBy: asArray(meta["blocked-by"]),
      reviewNeeded: asString(meta["review-needed"]),
    };
  };

  for (const fp of listMd(tasksDir)) {
    const m = toMeta(fp);
    if (!m) continue;
    if ((TASK_STATUSES as readonly string[]).includes(m.status)) {
      result[m.status as TaskStatus].push(m);
    }
  }

  for (const sub of ["review", "backlog", "incubating", "paused"] as const) {
    const subDir = join(tasksDir, sub);
    if (!existsSync(subDir)) continue;
    for (const fp of listMd(subDir)) {
      const m = toMeta(fp, sub);
      if (m) result[sub].push(m);
    }
  }

  return result;
}

function scanInbox(orgDir: string): InboxBreakdown {
  const inboxDir = join(orgDir, "inbox");
  const bySubfolder = new Map<string, number>();
  if (!existsSync(inboxDir)) return { total: 0, bySubfolder };
  let total = 0;
  for (const sub of INBOX_SUBFOLDERS) {
    const sp = join(inboxDir, sub);
    if (!existsSync(sp)) continue;
    const count = listMd(sp).length;
    if (count > 0) {
      bySubfolder.set(sub, count);
      total += count;
    }
  }
  return { total, bySubfolder };
}

function scanMercuryQueue(orgDir: string): MercuryQueue {
  const proposalsDir = join(orgDir, "forge", "proposals");
  const sessionsDir = join(orgDir, "forge", "sessions");
  let pendingProposals = 0;
  if (existsSync(proposalsDir)) {
    pendingProposals = listMd(proposalsDir).length;
  }
  let pendingPipelines = 0;
  if (existsSync(sessionsDir)) {
    for (const fp of readdirSync(sessionsDir).filter((f) => f.endsWith(".manifest.md"))) {
      const meta = parseFrontmatter(join(sessionsDir, fp));
      const status = asString(meta["review-status"]);
      // opus = "pending" only; materia legacy also accepts "unreviewed"
      if (status === "pending" || status === "unreviewed") {
        pendingPipelines++;
      }
    }
  }
  return { pendingProposals, pendingPipelines };
}

function scanReminders(orgDir: string): ReminderCounts {
  const remindersDir = join(orgDir, "reminders");
  const counts: ReminderCounts = { active: 0, pastDue: 0, upcoming7d: 0 };
  if (!existsSync(remindersDir)) return counts;
  const now = Date.now();
  const horizon = now + 7 * 24 * 60 * 60 * 1000;
  for (const fp of listMd(remindersDir)) {
    const meta = parseFrontmatter(fp);
    if (asString(meta.type) !== "reminder") continue;
    const status = asString(meta.status) || "pending";
    if (!["pending", "ongoing", "snoozed"].includes(status)) continue;
    counts.active++;
    const ts = asString(meta["remind-at"]) || asString(meta["snoozed-until"]);
    if (!ts) continue;
    const parsed = Date.parse(ts.replace("Z", ""));
    if (Number.isNaN(parsed)) continue;
    if (parsed < now) counts.pastDue++;
    else if (parsed <= horizon) counts.upcoming7d++;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Load-bearing context inlining
//
// CLAUDE.md (structure, schemas, conventions, governance) is required
// per-turn. Reading "on demand" is a regression from the Claude Code
// baseline — Claude Code's native provider auto-loaded CLAUDE.md into
// the system prompt regardless of session hooks. omp does not provide an
// equivalent loader for files outside `.claude/` or `.omp/AGENTS.md`, so
// session-orient inlines the load-bearing surfaces directly into the
// orientation custom_message.
//
// Inlined:
//   - Full CLAUDE.md
//   - voice.md `## How to Collaborate` section only
//   - project-map.md `## Principle Lattice` section only
//
// Token cost ~10K per session. The dynamic surfaces (current-state.md,
// the full project-map, knowledge/README.md) remain read-on-demand.
// ---------------------------------------------------------------------------

function readFileSafe(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Extract a top-level `## <Header>` section through to (but not including)
 * the next `## ` header or EOF. Returns empty string if not found.
 */
function extractSection(filePath: string, headerLiteral: string): string {
  const content = readFileSafe(filePath);
  if (!content) return "";
  const headerPattern = new RegExp(
    "^" + headerLiteral.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$",
    "m",
  );
  const match = content.match(headerPattern);
  if (!match || match.index === undefined) return "";
  const startIdx = match.index;
  const afterHeader = content.slice(startIdx + match[0].length);
  const nextHeader = afterHeader.search(/\n## /);
  if (nextHeader === -1) {
    return content.slice(startIdx).trimEnd();
  }
  return content.slice(startIdx, startIdx + match[0].length + nextHeader).trimEnd();
}

interface LoadBearingContext {
  claudeMd: string;
  voiceCollab: string;
  principleLattice: string;
}

function loadCriticalContext(orgDir: string): LoadBearingContext {
  return {
    claudeMd: readFileSafe(join(orgDir, "CLAUDE.md")).trimEnd(),
    voiceCollab: extractSection(
      join(orgDir, "context", "voice.md"),
      "## How to Collaborate",
    ),
    principleLattice: extractSection(
      join(orgDir, "context", "project-map.md"),
      "## Principle Lattice",
    ),
  };
}

// ---------------------------------------------------------------------------
// Principle lookup
//
// Extract a single principle from the Principle Lattice section of
// context/project-map.md. Used by both the `principle_lookup` LLM-callable
// tool and the `/principle` operator slash command.
// ---------------------------------------------------------------------------

interface PrincipleResult {
  symbol: string;
  name: string;
  content: string;
}

function lookupPrinciple(orgDir: string, identifier: string): PrincipleResult | null {
  const lattice = extractSection(
    join(orgDir, "context", "project-map.md"),
    "## Principle Lattice",
  );
  if (!lattice) return null;

  // Collect all `### <symbol> : <name>` entries in the lattice.
  const principleRe = /^### (\S+(?:[^\n]*?))\s*:\s*([^\n]+)$/gm;
  const matches: Array<{ symbol: string; name: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = principleRe.exec(lattice)) !== null) {
    matches.push({
      symbol: m[1].trim(),
      name: m[2].trim(),
      start: m.index,
    });
  }
  if (matches.length === 0) return null;

  const idNorm = identifier.trim();
  const idLower = idNorm.toLowerCase();

  // Match by exact symbol first (∞→0, Σ→1, ⊕, etc. — these are precise).
  // Fall back to case-insensitive substring on the name.
  let targetIdx = matches.findIndex((p) => p.symbol === idNorm);
  if (targetIdx === -1) {
    targetIdx = matches.findIndex((p) => p.name.toLowerCase().includes(idLower));
  }
  if (targetIdx === -1) return null;

  const target = matches[targetIdx];
  const next = matches[targetIdx + 1];
  const endIdx = next ? next.start : lattice.length;
  return {
    symbol: target.symbol,
    name: target.name,
    content: lattice.slice(target.start, endIdx).trimEnd(),
  };
}

function listPrincipleSymbols(orgDir: string): string {
  const lattice = extractSection(
    join(orgDir, "context", "project-map.md"),
    "## Principle Lattice",
  );
  if (!lattice) return "(no Principle Lattice found)";
  const principleRe = /^### (\S+(?:[^\n]*?))\s*:\s*([^\n]+)$/gm;
  const items: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = principleRe.exec(lattice)) !== null) {
    items.push(`${m[1].trim()} : ${m[2].trim()}`);
  }
  return items.length > 0 ? items.join(", ") : "(no principles found)";
}

// ---------------------------------------------------------------------------
// Mercury heartbeat
// ---------------------------------------------------------------------------

function stimulateMercury(orgDir: string): void {
  const wakePath = join(orgDir, "instruments", "mercury", "mercury.wake");
  try {
    writeFileSync(wakePath, new Date().toISOString());
  } catch {
    /* mercury may not be installed in this tree */
  }
}

// ---------------------------------------------------------------------------
// Orientation rendering
// ---------------------------------------------------------------------------

function renderTaskLine(label: string, items: TaskMeta[], limit = 3): string {
  if (items.length === 0) return "";
  const names = items.slice(0, limit).map((t) => t.filename).join(", ");
  const tail = items.length > limit ? "..." : "";
  return `  \u21B3 ${label}: ${names}${tail}`;
}

function emitOpusOrientation(orgDir: string): string {
  const tasks = scanTasks(orgDir);
  const inbox = scanInbox(orgDir);
  const mercury = scanMercuryQueue(orgDir);
  const reminders = scanReminders(orgDir);
  const ctx = loadCriticalContext(orgDir);

  const lines: string[] = [];
  lines.push('<session-context source="session-orient extension" org="opus">');
  lines.push("## Opus session brief");
  lines.push("");
  lines.push("### Dynamic state (this session)");
  lines.push("");
  lines.push(
    `**Tasks**: ${tasks.active.length} active \u00B7 ${tasks.blocked.length} blocked \u00B7 ${tasks.review.length} review \u00B7 ${tasks.backlog.length} backlog \u00B7 ${tasks.incubating.length} incubating \u00B7 ${tasks.paused.length} paused`,
  );
  const blockedLine = renderTaskLine("blocked", tasks.blocked);
  if (blockedLine) lines.push(blockedLine);
  const reviewLine = renderTaskLine("review", tasks.review);
  if (reviewLine) lines.push(reviewLine);

  if (inbox.total > 0) {
    const parts = Array.from(inbox.bySubfolder.entries()).map(
      ([sub, n]) => `${n} ${sub}`,
    );
    lines.push(`**Inbox**: ${inbox.total} total (${parts.join(", ")})`);
  } else {
    lines.push("**Inbox**: clear");
  }

  if (mercury.pendingProposals > 0 || mercury.pendingPipelines > 0) {
    const parts: string[] = [];
    if (mercury.pendingProposals > 0) parts.push(`${mercury.pendingProposals} proposals`);
    if (mercury.pendingPipelines > 0) parts.push(`${mercury.pendingPipelines} pipelines pending review`);
    lines.push(`**Mercury**: ${parts.join(" \u00B7 ")}`);
  } else {
    lines.push("**Mercury**: queue clear");
  }

  if (reminders.active > 0) {
    const parts = [`${reminders.active} active`];
    if (reminders.pastDue > 0) parts.push(`${reminders.pastDue} past-due`);
    if (reminders.upcoming7d > 0) parts.push(`${reminders.upcoming7d} within 7d`);
    lines.push(`**Reminders**: ${parts.join(" \u00B7 ")}`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("### Inlined (always loaded — do not depend on re-read)");
  lines.push("");

  if (ctx.claudeMd) {
    lines.push("#### From `CLAUDE.md`");
    lines.push("");
    lines.push(ctx.claudeMd);
    lines.push("");
  }

  if (ctx.voiceCollab) {
    lines.push("#### From `context/voice.md`");
    lines.push("");
    lines.push(ctx.voiceCollab);
    lines.push("");
  }

  if (ctx.principleLattice) {
    lines.push("#### From `context/project-map.md`");
    lines.push("");
    lines.push(ctx.principleLattice);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("### Read on demand (dynamic or large surfaces)");
  lines.push("");
  lines.push("- `context/current-state.md` (active tasks/projects/inbox snapshot, ~150KB, dynamic)");
  lines.push("- `context/project-map.md` (full file with conceptual threads; principle lattice already inlined above)");
  lines.push("- `context/voice.md` (full file; collaboration section already inlined above)");
  lines.push("- `knowledge/README.md` (KB index; query with `mcp__qmd__query` for content)");
  lines.push("</session-context>");

  return lines.join("\n");
}

function emitMateriaOrientation(orgDir: string): string {
  // Materia gets the same compact treatment — original Python materia branch
  // emitted ~150 lines of detail, but the point of orientation is "what
  // changed", not "dump everything I could find". Materia operators can lift
  // the full output by extending this function if desired.
  const tasks = scanTasks(orgDir);
  const inbox = scanInbox(orgDir);
  const mercury = scanMercuryQueue(orgDir);
  const reminders = scanReminders(orgDir);

  const lines: string[] = [];
  lines.push('<session-context source="session-orient extension" org="materia">');
  lines.push("## Materia orientation");
  lines.push("");
  lines.push(
    `**Tasks**: ${tasks.active.length} active \u00B7 ${tasks.blocked.length} blocked \u00B7 ${tasks.review.length} review \u00B7 ${tasks.backlog.length} backlog \u00B7 ${tasks.incubating.length} incubating \u00B7 ${tasks.paused.length} paused`,
  );
  const blockedLine = renderTaskLine("blocked", tasks.blocked);
  if (blockedLine) lines.push(blockedLine);
  const reviewLine = renderTaskLine("review", tasks.review);
  if (reviewLine) lines.push(reviewLine);

  if (inbox.total > 0) {
    const parts = Array.from(inbox.bySubfolder.entries()).map(
      ([sub, n]) => `${n} ${sub}`,
    );
    lines.push(`**Inbox**: ${inbox.total} total (${parts.join(", ")})`);
  } else {
    lines.push("**Inbox**: clear");
  }

  if (mercury.pendingProposals > 0 || mercury.pendingPipelines > 0) {
    const parts: string[] = [];
    if (mercury.pendingProposals > 0) parts.push(`${mercury.pendingProposals} proposals`);
    if (mercury.pendingPipelines > 0) parts.push(`${mercury.pendingPipelines} pipelines pending review`);
    lines.push(`**Mercury**: ${parts.join(" \u00B7 ")}`);
  } else {
    lines.push("**Mercury**: queue clear");
  }

  if (reminders.active > 0) {
    const parts = [`${reminders.active} active`];
    if (reminders.pastDue > 0) parts.push(`${reminders.pastDue} past-due`);
    if (reminders.upcoming7d > 0) parts.push(`${reminders.upcoming7d} within 7d`);
    lines.push(`**Reminders**: ${parts.join(" \u00B7 ")}`);
  }

  lines.push("");
  lines.push("Detail lives in authoritative files \u2014 read on demand:");
  lines.push("- `CLAUDE.md` (structure, conventions)");
  lines.push("- `context/current-state.md` (active state)");
  lines.push("- `context/voice.md` (collaboration style)");
  lines.push("- `context/project-map.md` (project topology)");
  lines.push("- `knowledge/README.md` (KB map)");
  lines.push("</session-context>");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Resume detection
// ---------------------------------------------------------------------------

const ORIENT_CUSTOM_TYPE = "session-orient";

function branchAlreadyOriented(branch: readonly unknown[]): boolean {
  for (const entry of branch) {
    const e = entry as { type?: string; customType?: string } | undefined;
    if (e?.type === "custom_message" && e.customType === ORIENT_CUSTOM_TYPE) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Extension entry
// ---------------------------------------------------------------------------

export default function sessionOrient(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const { profile, orgDir } = detectProfile(ctx.cwd);
    if (!orgDir) return;

    const claudeMd = join(orgDir, "CLAUDE.md");
    if (!existsSync(claudeMd)) return;

    // Skip on resume: orientation already in the branch.
    try {
      const branch = ctx.sessionManager.getBranch();
      if (branchAlreadyOriented(branch)) return;
    } catch {
      // If we can't read the branch, fall through and emit — better to
      // double-orient than miss a fresh session entirely.
    }

    stimulateMercury(orgDir);

    const content =
      profile === "opus"
        ? emitOpusOrientation(orgDir)
        : emitMateriaOrientation(orgDir);

    try {
      await pi.sendMessage(
        {
          customType: ORIENT_CUSTOM_TYPE,
          content,
          display: true,
          attribution: "agent",
        },
        { deliverAs: "nextTurn" },
      );
    } catch (err) {
      pi.logger?.warn?.(
        `session-orient: sendMessage failed: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  });

  // -------------------------------------------------------------------------
  // /orient — re-emit the orientation block on demand
  // -------------------------------------------------------------------------
  pi.registerCommand("orient", {
    description: "Re-emit the session orientation block (architecture + lattice + dynamic state)",
    handler: async (_args, ctx) => {
      const { profile, orgDir } = detectProfile(ctx.cwd);
      if (!orgDir) {
        ctx.ui.notify("Not in opus/materia tree — /orient is a no-op here.", "warning");
        return;
      }
      stimulateMercury(orgDir);
      const content =
        profile === "opus"
          ? emitOpusOrientation(orgDir)
          : emitMateriaOrientation(orgDir);
      try {
        await pi.sendMessage(
          {
            customType: ORIENT_CUSTOM_TYPE,
            content,
            display: true,
            attribution: "agent",
          },
          { deliverAs: "nextTurn" },
        );
        ctx.ui.notify("Orientation re-emitted; will land in next prompt's context.", "info");
      } catch (err) {
        ctx.ui.notify(
          `Failed to inject orientation: ${(err as Error)?.message ?? String(err)}`,
          "error",
        );
      }
    },
  });

  // -------------------------------------------------------------------------
  // /principle <symbol-or-name> — look up an opus principle
  // -------------------------------------------------------------------------
  pi.registerCommand("principle", {
    description: "Look up an opus principle from the Lattice by symbol or name (e.g. /principle ⊕, /principle Inversion)",
    handler: async (args, ctx) => {
      const { orgDir } = detectProfile(ctx.cwd);
      if (!orgDir) {
        ctx.ui.notify("Not in opus/materia tree — /principle is a no-op here.", "warning");
        return;
      }
      const identifier = (args ?? "").trim();
      if (!identifier) {
        ctx.ui.notify(
          `Usage: /principle <symbol-or-name>. Available: ${listPrincipleSymbols(orgDir)}`,
          "warning",
        );
        return;
      }
      const result = lookupPrinciple(orgDir, identifier);
      if (!result) {
        ctx.ui.notify(
          `No principle matches "${identifier}". Available: ${listPrincipleSymbols(orgDir)}`,
          "warning",
        );
        return;
      }
      try {
        await pi.sendMessage(
          {
            customType: "principle-lookup",
            content: `<principle-lookup symbol="${result.symbol}" name="${result.name}">\n${result.content}\n</principle-lookup>`,
            display: true,
            attribution: "agent",
          },
          { deliverAs: "nextTurn" },
        );
        ctx.ui.notify(
          `Principle "${result.symbol} : ${result.name}" injected into next prompt's context.`,
          "info",
        );
      } catch (err) {
        ctx.ui.notify(
          `Failed to inject principle: ${(err as Error)?.message ?? String(err)}`,
          "error",
        );
      }
    },
  });

  // -------------------------------------------------------------------------
  // principle_lookup — LLM-callable tool variant. Lets the agent ground
  // reasoning in a specific principle without re-reading the 54KB
  // project-map.md.
  // -------------------------------------------------------------------------
  const { z } = pi.zod;
  pi.registerTool({
    name: "principle_lookup",
    label: "Look up an opus principle",
    description:
      "Return the content of a named opus principle from the Principle Lattice in context/project-map.md. Accepts the principle's symbol (∞→0, 1→7, Δ, Σ→1, ⊕, ≡, ∮, ⊢) or its name (Inversion, Single-Source Multiplicity, Intimate Knowledge Over Broadcast, Irreducible Form, Self-Sovereignty, Structural Correctness Over Functional Adequacy, Visibility / Transparency, Logical Coherence). Use this to ground reasoning in a specific principle without re-reading the full project-map.",
    parameters: z.object({
      identifier: z
        .string()
        .describe(
          "Principle symbol (e.g. '⊕', 'Σ→1') or name fragment (e.g. 'Sovereignty', 'Inversion'). Case-insensitive substring match on names.",
        ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { orgDir } = detectProfile(ctx.cwd);
      if (!orgDir) {
        return {
          content: [{ type: "text", text: "principle_lookup: not in an opus/materia tree." }],
        };
      }
      const result = lookupPrinciple(orgDir, params.identifier);
      if (!result) {
        return {
          content: [
            {
              type: "text",
              text: `No principle matches "${params.identifier}". Available: ${listPrincipleSymbols(orgDir)}`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: result.content }],
        details: { symbol: result.symbol, name: result.name },
      };
    },
  });
}
