#!/usr/bin/env bun
/**
 * strip-emojis.ts
 *
 * Idempotent in-place patch of the installed `@oh-my-pi/pi-coding-agent`
 * source tree to replace user-facing emoji literals with ASCII/non-emoji
 * equivalents. Keeps box-drawing characters, arrows, and dingbats
 * (╭ ─ ❯ ✔ ✘ ⚠ etc.) — strips only Emoticons / Pictographs / Transport &
 * Symbol blocks.
 *
 * Run after every `bun install -g @oh-my-pi/pi-coding-agent` upgrade:
 *
 *     bun ~/.omp/customizations/strip-emojis.ts
 *
 * Exits 0 on success (including when already fully stripped). Each
 * replacement is verified to have happened (or to already be applied),
 * so a partial omp update that renames a file or shifts a literal will
 * surface as a hard error rather than a silent miss.
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ROOT = join(
  homedir(),
  ".bun",
  "install",
  "global",
  "node_modules",
  "@oh-my-pi",
  "pi-coding-agent",
  "src",
);

interface Replacement {
  /** Substring that must be present pre-patch. Replaced verbatim. */
  before: string;
  /** Replacement substring. */
  after: string;
}

interface FilePatch {
  relPath: string;
  replacements: Replacement[];
}

// Theme's UNICODE_SYMBOLS — swap the 24 emoji values for non-emoji
// equivalents. Values chosen to preserve column width where practical
// (most renderers treat these as 1-cell). We keep keys that already
// resolve to non-emoji Unicode (✦ ⌘ ✎ ⚖ ⏸ ↻ ⎇ ⑂ ⤴ ◫ ⏱ π ⤵ ⟲ etc.)
// untouched.
const THEME_PATCHES: Replacement[] = [
  // Icons
  { before: `"icon.plan": "🗺",`,            after: `"icon.plan": "[plan]",` },
  { before: `"icon.goal": "🎯",`,            after: `"icon.goal": "[goal]",` },
  { before: `"icon.folder": "📁",`,          after: `"icon.folder": "[dir]",` },
  { before: `"icon.scratchFolder": "🗑",`,   after: `"icon.scratchFolder": "[tmp]",` },
  { before: `"icon.file": "📄",`,            after: `"icon.file": "[file]",` },
  { before: `"icon.tokens": "🪙",`,          after: `"icon.tokens": "tok",` },
  { before: `"icon.cost": "💲",`,            after: `"icon.cost": "$",` },
  { before: `"icon.agents": "👥",`,          after: `"icon.agents": "ag",` },
  { before: `"icon.cache": "💾",`,           after: `"icon.cache": "cache",` },
  { before: `"icon.host": "🖥",`,            after: `"icon.host": "host",` },
  { before: `"icon.session": "🆔",`,         after: `"icon.session": "id",` },
  { before: `"icon.package": "📦",`,         after: `"icon.package": "pkg",` },
  { before: `"icon.fast": "⚡",`,            after: `"icon.fast": ">>",` },
  { before: `"icon.extensionTool": "🛠",`,   after: `"icon.extensionTool": "tool",` },
  { before: `"icon.extensionMcp": "🔌",`,    after: `"icon.extensionMcp": "mcp",` },
  { before: `"icon.extensionHook": "🪝",`,   after: `"icon.extensionHook": "hook",` },
  { before: `"icon.extensionContextFile": "📎",`, after: `"icon.extensionContextFile": "ctx",` },
  { before: `"icon.extensionInstruction": "📘",`, after: `"icon.extensionInstruction": "ins",` },
  { before: `"icon.mic": "🎤",`,             after: `"icon.mic": "mic",` },
  // Languages (icons rendered in the file picker / tool output)
  { before: `"lang.typescript": "🟦",`,      after: `"lang.typescript": "ts",` },
  { before: `"lang.javascript": "🟨",`,      after: `"lang.javascript": "js",` },
  { before: `"lang.python": "🐍",`,          after: `"lang.python": "py",` },
  { before: `"lang.rust": "🦀",`,            after: `"lang.rust": "rs",` },
  { before: `"lang.go": "🐹",`,              after: `"lang.go": "go",` },
  { before: `"lang.java": "☕",`,            after: `"lang.java": "java",` },
  { before: `"lang.ruby": "💎",`,            after: `"lang.ruby": "rb",` },
  { before: `"lang.php": "🐘",`,             after: `"lang.php": "php",` },
  { before: `"lang.swift": "🕊",`,           after: `"lang.swift": "swift",` },
  { before: `"lang.shell": "💻",`,           after: `"lang.shell": "sh",` },
  { before: `"lang.html": "🌐",`,            after: `"lang.html": "html",` },
  { before: `"lang.css": "🎨",`,             after: `"lang.css": "css",` },
  { before: `"lang.json": "🧾",`,            after: `"lang.json": "json",` },
  { before: `"lang.yaml": "📋",`,            after: `"lang.yaml": "yaml",` },
  { before: `"lang.markdown": "📝",`,        after: `"lang.markdown": "md",` },
  { before: `"lang.sql": "🗄",`,             after: `"lang.sql": "sql",` },
  { before: `"lang.docker": "🐳",`,          after: `"lang.docker": "docker",` },
  { before: `"lang.lua": "🌙",`,             after: `"lang.lua": "lua",` },
  { before: `"lang.text": "🗒",`,            after: `"lang.text": "txt",` },
  { before: `"lang.env": "🔧",`,             after: `"lang.env": "env",` },
  { before: `"lang.toml": "🧾",`,            after: `"lang.toml": "toml",` },
  { before: `"lang.log": "📜",`,             after: `"lang.log": "log",` },
  { before: `"lang.csv": "📑",`,             after: `"lang.csv": "csv",` },
  { before: `"lang.tsv": "📑",`,             after: `"lang.tsv": "tsv",` },
  { before: `"lang.image": "🖼",`,           after: `"lang.image": "img",` },
  { before: `"lang.pdf": "📕",`,             after: `"lang.pdf": "pdf",` },
  { before: `"lang.archive": "🗜",`,         after: `"lang.archive": "zip",` },
  // Settings tab icons
  { before: `"tab.appearance": "🎨",`,       after: `"tab.appearance": "[A]",` },
  { before: `"tab.model": "🤖",`,            after: `"tab.model": "[M]",` },
  { before: `"tab.context": "📋",`,          after: `"tab.context": "[X]",` },
  { before: `"tab.editing": "💻",`,          after: `"tab.editing": "[E]",` },
  { before: `"tab.tools": "🔧",`,            after: `"tab.tools": "[T]",` },
  { before: `"tab.memory": "🧠",`,           after: `"tab.memory": "[Y]",` },
  { before: `"tab.tasks": "📦",`,            after: `"tab.tasks": "[K]",` },
  { before: `"tab.providers": "🌐",`,        after: `"tab.providers": "[P]",` },
];

// Hard-coded prose literals.
const OVERLAY_PATCHES: Replacement[] = [
  {
    before: `theme.fg("dim", "💭 Thinking")`,
    after: `theme.fg("dim", "Thinking")`,
  },
];

// Bug-report easter-egg dialogs — strip the leading emoji + trailing space.
const INTERACTIVE_PATCHES: Replacement[] = [
  { before: `"😤 Your agent is fuming about a tool."`,
    after:  `"Your agent is fuming about a tool."` },
  { before: `"😵\u200d💫 Your agent is having an existential crisis over a tool."`,
    after:  `"Your agent is having an existential crisis over a tool."` },
  { before: `"😭 Your agent wants to cry about a misbehaving tool."`,
    after:  `"Your agent wants to cry about a misbehaving tool."` },
  { before: `"🤬 Your agent is BIG MAD at one of the tools."`,
    after:  `"Your agent is BIG MAD at one of the tools."` },
  { before: `"🫠 Your agent is melting down over a tool."`,
    after:  `"Your agent is melting down over a tool."` },
  { before: `"🤯 Your agent's brain broke at a tool's nonsense."`,
    after:  `"Your agent's brain broke at a tool's nonsense."` },
  { before: `"😩 Your agent is begging to file a complaint about a tool."`,
    after:  `"Your agent is begging to file a complaint about a tool."` },
  { before: `"🥲 Your agent put on a brave face but a tool did it dirty."`,
    after:  `"Your agent put on a brave face but a tool did it dirty."` },
];

const FILES: FilePatch[] = [
  { relPath: "modes/theme/theme.ts", replacements: THEME_PATCHES },
  { relPath: "modes/components/session-observer-overlay.ts", replacements: OVERLAY_PATCHES },
  { relPath: "modes/interactive-mode.ts", replacements: INTERACTIVE_PATCHES },
];

interface Outcome {
  file: string;
  applied: number;
  alreadyApplied: number;
  missing: string[];
}

function applyOne(filePath: string, reps: Replacement[]): Outcome {
  const content = readFileSync(filePath, "utf-8");
  let next = content;
  const outcome: Outcome = {
    file: filePath,
    applied: 0,
    alreadyApplied: 0,
    missing: [],
  };
  for (const r of reps) {
    if (next.includes(r.before)) {
      next = next.split(r.before).join(r.after);
      outcome.applied++;
    } else if (next.includes(r.after)) {
      outcome.alreadyApplied++;
    } else {
      outcome.missing.push(r.before.slice(0, 50));
    }
  }
  if (next !== content) {
    writeFileSync(filePath, next, "utf-8");
  }
  return outcome;
}

function main(): void {
  try {
    statSync(ROOT);
  } catch {
    console.error(`pi-coding-agent source not found at ${ROOT}`);
    process.exit(1);
  }

  let totalApplied = 0;
  let totalAlready = 0;
  let totalMissing = 0;

  for (const fp of FILES) {
    const abs = join(ROOT, fp.relPath);
    try {
      statSync(abs);
    } catch {
      console.error(`MISSING FILE: ${abs}`);
      process.exit(2);
    }
    const o = applyOne(abs, fp.replacements);
    totalApplied += o.applied;
    totalAlready += o.alreadyApplied;
    totalMissing += o.missing.length;
    const status =
      o.missing.length > 0
        ? `INCOMPLETE (${o.missing.length} unmatched)`
        : o.applied > 0
          ? `applied ${o.applied}`
          : `already stripped`;
    console.log(`${fp.relPath}: ${status}`);
    for (const m of o.missing) {
      console.log(`  unmatched: ${m}...`);
    }
  }

  console.log("---");
  console.log(
    `summary: ${totalApplied} replaced, ${totalAlready} already-applied, ${totalMissing} unmatched`,
  );
  if (totalMissing > 0) {
    console.error(
      "One or more patterns did not match. The omp source likely shifted on upgrade — update strip-emojis.ts before relying on the strip.",
    );
    process.exit(3);
  }
}

main();
