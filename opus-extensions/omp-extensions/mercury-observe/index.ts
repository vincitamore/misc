/**
 * mercury-observe
 *
 * Mercury daemon (opus/instruments/mercury/) reads
 * `instruments/mercury/hook-exec.jsonl` for governance signals — what
 * tools the operator session invoked, when sessions started, when the
 * stop gate fired, etc. Claude Code wrote these entries via the
 * ~/.claude/hooks/*.py hook scripts. When omp took over, those scripts
 * stopped firing and Mercury went hook-blind despite being alive.
 *
 * This extension restores the sensorium under omp by:
 *   - Logging examen MCP tool_result events as `hook: "mcp-observe"` /
 *     `event: "PostToolUse"` (matches Claude Code schema so Mercury's
 *     downstream aggregation continues to work without changes)
 *   - Logging omp session_start as `hook: "session-start-orient"` /
 *     `event: "SessionStart"` so Mercury sees fresh sessions
 *   - Each entry carries `runtime: "omp"` for future-proof filtering
 *
 * Maintenance-gate fires are logged by maintenance-gate itself, not
 * here — each extension owns its own observability so cross-extension
 * coupling stays zero.
 *
 * Also registers `/dream` operator command that calls Mercury's MCP
 * dream sentinel to force a dream cycle.
 *
 * Routing: opus and materia both have `instruments/mercury/` per the
 * org convention. Other cwds are no-ops.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

type Profile = "opus" | "materia" | "other";

interface ProfileInfo {
  profile: Profile;
  orgDir: string | null;
}

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

function normalizeToolName(name: string): string {
  return name.startsWith("proxy_") ? name.slice("proxy_".length) : name;
}

function isExamenTool(name: string): boolean {
  // omp tool names use `mcp__<server>_<tool>` (single underscore between
  // server and method), distinct from Claude Code's `mcp__<server>__<tool>`.
  // The prefix below matches all examen tools without false-positive on
  // a hypothetical "examenxyz" server (there is none, but the trailing
  // underscore preserves the contract).
  return normalizeToolName(name).startsWith("mcp__examen_");
}

interface HookExecEntry {
  ts: string;
  hook: string;
  event: string;
  exit_code: number;
  duration_ms: number;
  error: string | null;
  runtime?: string;
  /** Optional MCP-call detail; absent for non-MCP entries. */
  tool?: string;
}

function appendLogEntry(orgDir: string, entry: HookExecEntry): void {
  const logPath = join(orgDir, "instruments", "mercury", "hook-exec.jsonl");
  try {
    const dir = dirname(logPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch {
    /* best effort — Mercury degrades gracefully if file is unwritable */
  }
}

function isoNow(): string {
  // Match Mercury's existing entry format: ISO without milliseconds.
  return new Date().toISOString().replace(/\.\d{3}Z$/, "");
}

function extractErrorText(event: unknown): string | null {
  const e = event as { content?: unknown[] } | undefined;
  const content = e?.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "text"
    ) {
      const t = (block as { text?: string }).text;
      if (typeof t === "string") return t.slice(0, 200);
    }
  }
  return null;
}

export default function mercuryObserve(pi: ExtensionAPI): void {
  let orgDir: string | null = null;

  // Tracks tool_call → tool_result duration. Keyed by toolCallId, values are
  // millisecond timestamps. Cleaned up on tool_result.
  const callStartTimes = new Map<string, number>();

  pi.on("session_start", async (_event, ctx) => {
    const detected = detectProfile(ctx.cwd);
    orgDir = detected.orgDir;
    if (!orgDir) return;

    appendLogEntry(orgDir, {
      ts: isoNow(),
      hook: "session-start-orient",
      event: "SessionStart",
      exit_code: 0,
      duration_ms: 0,
      error: null,
      runtime: "omp",
    });
  });

  pi.on("session_shutdown", async () => {
    if (!orgDir) return;
    appendLogEntry(orgDir, {
      ts: isoNow(),
      hook: "session-end-cleanup",
      event: "SessionEnd",
      exit_code: 0,
      duration_ms: 0,
      error: null,
      runtime: "omp",
    });
  });

  pi.on("tool_call", async (event) => {
    if (!orgDir) return;
    if (!isExamenTool(event.toolName)) return;
    callStartTimes.set(event.toolCallId, Date.now());
  });

  pi.on("tool_result", async (event) => {
    if (!orgDir) return;
    if (!isExamenTool(event.toolName)) return;
    const startMs = callStartTimes.get(event.toolCallId);
    callStartTimes.delete(event.toolCallId);
    const durationMs = startMs ? Date.now() - startMs : 0;

    appendLogEntry(orgDir, {
      ts: isoNow(),
      hook: "mcp-observe",
      event: "PostToolUse",
      exit_code: event.isError ? 1 : 0,
      duration_ms: durationMs,
      error: event.isError ? extractErrorText(event) : null,
      runtime: "omp",
      tool: normalizeToolName(event.toolName),
    });
  });

  // Operator command: force Mercury into a dream cycle.
  pi.registerCommand("dream", {
    description: "Force Mercury into dreaming phase (operator-initiated dream cycle)",
    handler: async (_args, ctx) => {
      if (!orgDir) {
        ctx.ui.notify("Not in an opus/materia tree — /dream is a no-op here.", "warning");
        return;
      }
      // Write the mercury.dream sentinel directly. Mercury watches for this
      // file (per opus/instruments/mercury/SPEC.md) and consumes it on the
      // next check tick (~2s). One-shot.
      const dreamPath = join(orgDir, "instruments", "mercury", "mercury.dream");
      try {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(dreamPath, isoNow());
        ctx.ui.notify("Mercury dream sentinel written. Dream cycle will begin within ~2s.", "info");
      } catch (err) {
        ctx.ui.notify(
          `Failed to write dream sentinel: ${(err as Error)?.message ?? String(err)}`,
          "error",
        );
      }
    },
  });
}
