/**
 * omp-self-heal
 *
 * omp's `bun install -g @oh-my-pi/pi-coding-agent` auto-upgrades overwrite
 * the package source files at `~/.bun/install/global/node_modules/@oh-my-pi/
 * pi-coding-agent/src/`. Our source-level customizations (currently just the
 * emoji strip at ~/.omp/customizations/strip-emojis.ts) get blown away every
 * time. This extension detects the revert at session_start and re-applies
 * the strip automatically.
 *
 * Detection: presence of a known pre-strip emoji literal in theme.ts. If
 * found, the strip wasn't applied. If absent, we're already stripped.
 *
 * Action on revert detection:
 *   1. Spawn `bun ~/.omp/customizations/strip-emojis.ts` and wait
 *   2. Notify the operator via ctx.ui.notify
 *
 * Caveat: the strip modifies source files that omp has ALREADY loaded into
 * memory by the time session_start fires. The patches don't take effect
 * until the next omp restart. The notification states this clearly.
 *
 * Extending to additional customizations: add another `Customization`
 * entry to the CUSTOMIZATIONS array with its own detection probe and
 * script path. The session_start handler iterates and re-applies all
 * stale ones in one pass.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

interface Customization {
  /** Display name for notifications. */
  name: string;
  /** Path to the file we probe for revert detection. */
  probePath: string;
  /** Substring whose presence means the customization was reverted. */
  revertedMarker: string;
  /** Absolute path to the re-apply script (Bun-executable). */
  scriptPath: string;
}

const OMP_PACKAGE_SRC = join(
  homedir(),
  ".bun",
  "install",
  "global",
  "node_modules",
  "@oh-my-pi",
  "pi-coding-agent",
  "src",
);

const CUSTOMIZATIONS: Customization[] = [
  {
    name: "emoji strip",
    probePath: join(OMP_PACKAGE_SRC, "modes", "theme", "theme.ts"),
    // The first emoji-key replacement in strip-emojis.ts is icon.plan.
    // If "🗺" is back in theme.ts, the patch was reverted.
    revertedMarker: '"icon.plan": "🗺",',
    scriptPath: join(homedir(), ".omp", "customizations", "strip-emojis.ts"),
  },
];

interface ReapplyResult {
  customization: string;
  status: "already-applied" | "re-applied" | "missing-script" | "failed";
  detail?: string;
}

function checkCustomization(c: Customization): ReapplyResult | null {
  try {
    if (!existsSync(c.probePath)) {
      // omp's source layout may have changed in a future upgrade. Surface
      // this so we know to update the probe path.
      return {
        customization: c.name,
        status: "failed",
        detail: `probe path missing: ${c.probePath}`,
      };
    }
    const content = readFileSync(c.probePath, "utf-8");
    if (!content.includes(c.revertedMarker)) {
      // Already stripped — nothing to do.
      return null;
    }
  } catch (err) {
    return {
      customization: c.name,
      status: "failed",
      detail: `probe read failed: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  // Revert detected. Re-apply the script.
  if (!existsSync(c.scriptPath)) {
    return {
      customization: c.name,
      status: "missing-script",
      detail: c.scriptPath,
    };
  }
  try {
    const r = spawnSync("bun", [c.scriptPath], {
      encoding: "utf-8",
      shell: true,
      timeout: 30_000,
    });
    if (r.status !== 0) {
      return {
        customization: c.name,
        status: "failed",
        detail: `exit ${r.status}: ${(r.stderr ?? "").slice(0, 200)}`,
      };
    }
    return { customization: c.name, status: "re-applied" };
  } catch (err) {
    return {
      customization: c.name,
      status: "failed",
      detail: (err as Error)?.message ?? String(err),
    };
  }
}

export default function ompSelfHeal(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const results: ReapplyResult[] = [];
    for (const c of CUSTOMIZATIONS) {
      const r = checkCustomization(c);
      if (r) results.push(r);
    }
    if (results.length === 0) return;

    const reapplied = results.filter((r) => r.status === "re-applied");
    const failed = results.filter((r) => r.status !== "re-applied");

    if (reapplied.length > 0) {
      const names = reapplied.map((r) => r.customization).join(", ");
      ctx.ui.notify(
        `omp upgrade reverted source-level customizations (${names}). Re-applied. Restart omp for the patches to take effect.`,
        "warning",
      );
    }
    for (const f of failed) {
      ctx.ui.notify(
        `omp-self-heal: failed to re-apply ${f.customization} — ${f.detail ?? "unknown"}`,
        "error",
      );
      pi.logger?.warn?.(
        `omp-self-heal: ${f.customization} ${f.status}: ${f.detail ?? ""}`,
      );
    }
  });
}
