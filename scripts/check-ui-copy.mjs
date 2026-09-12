#!/usr/bin/env node
/**
 * Fail if engineering / process phrases leak into user-facing UI copy.
 *
 * Scans:
 *   - src/app, src/components — JSX text + UI attrs (title/alt/aria/placeholder/label)
 *     and prose-like string literals (contains whitespace). Code comments skipped.
 *   - committed public/archive JSON — blurb, discoveryNotes, highlights
 *     (skips public/archive/bulk)
 *   - src/data/pois/*.json — summary (and other COPY_FIELDS)
 *
 * Code identifiers (`hasGas`, import paths, object keys) are allowed.
 * The same tokens in user-facing prose / attrs / archive fields are banned.
 *
 * Usage: node scripts/check-ui-copy.mjs
 *        npm test   (wired)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** Multi-word / process phrases — any user-facing string. */
const PHRASE_BANNED = [
  "ingest slice",
  "sample ingest",
  "archive host",
  "hand-enriched",
  "sparse archive card",
  "wired to archive",
  "curated showcase",
  "fail-open",
  "store b",
  "session prime",
  "generate:catalog",
  "npm run",
  // Product-voice meta (post d7c42a6 scrub)
  "phase 1 catalog",
  "orbitpedia catalog",
  "archive system (sparse)",
  "load the full graph",
];

/** Schema / flag tokens — UI attrs, JSX text, archive copy only. */
const IDENT_BANNED = [
  "hasgas",
  "pl_bmasse",
  "pl_rade",
  "textureid",
  "archive_out",
];

const UI_ATTR_RE =
  /\b(?:title|alt|placeholder|label|aria-[\w-]+)\s*=\s*(["'`])/gi;

const COPY_FIELDS = new Set(["blurb", "discoveryNotes", "highlights", "summary"]);

/** JSX text that looks like source, not copy (TS generics false positives). */
function looksLikeCode(s) {
  return (
    /(?:const |let |var |=>|useState|useRef|useMemo|return false|return true)/.test(
      s,
    ) || /;\s*$/.test(s.trim())
  );
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`ok  ${msg}`);
}

function walkFiles(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === "\n") line++;
  }
  return line;
}

/** Replace comments with spaces; keep newlines so line numbers stay honest. */
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c;
      i++;
      while (i < n) {
        const ch = src[i];
        out += ch;
        if (ch === "\\") {
          if (i + 1 < n) {
            out += src[i + 1];
            i += 2;
            continue;
          }
        }
        if (q === "`" && ch === "$" && src[i + 1] === "{") {
          i++;
          continue;
        }
        if (ch === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function extractQuoted(src, start) {
  const q = src[start];
  let i = start + 1;
  let value = "";
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      value += src[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (ch === q) return { value, end: i + 1 };
    value += ch;
    i++;
  }
  return { value, end: i };
}

function* stringLiterals(src) {
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const { value, end } = extractQuoted(src, i);
      yield { value, index: i };
      i = end;
      continue;
    }
    i++;
  }
}

function* jsxText(src) {
  const re = />([^<>{]+)</g;
  let m;
  while ((m = re.exec(src))) {
    const raw = m[1];
    if (!raw.trim()) continue;
    if (!/[A-Za-z]/.test(raw)) continue;
    const value = raw.replace(/\s+/g, " ").trim();
    if (looksLikeCode(value)) continue;
    yield { value, index: m.index + 1 };
  }
}

function* uiAttrValues(src) {
  UI_ATTR_RE.lastIndex = 0;
  let m;
  while ((m = UI_ATTR_RE.exec(src))) {
    const quote = m[1];
    const start = m.index + m[0].length - 1;
    if (src[start] !== quote) continue;
    const { value, end } = extractQuoted(src, start);
    yield { value, index: start };
    UI_ATTR_RE.lastIndex = end;
  }
}

function matchesPhrase(low) {
  return PHRASE_BANNED.filter((p) => low.includes(p));
}

function matchesIdent(low) {
  return IDENT_BANNED.filter((p) => {
    // Word-ish: avoid matching random substrings inside longer tokens when exact key.
    if (low === p) return true;
    // Prose / compound UI copy containing the token.
    return (
      low.includes(p) &&
      (/\s/.test(low) || low.includes("/") || low.includes("(") || low.length > p.length + 2)
    );
  });
}

function checkTsx(rel, src) {
  const code = stripComments(src);
  const hits = [];

  const add = (index, value, reasons) => {
    if (!reasons.length) return;
    hits.push({
      line: lineAt(src, index),
      value: value.replace(/\s+/g, " ").trim().slice(0, 80),
      reasons,
    });
  };

  // Prose string literals only (whitespace) — catches tooltips built as consts.
  for (const { value, index } of stringLiterals(code)) {
    if (!/\s/.test(value)) continue;
    if (looksLikeCode(value)) continue;
    // Skip import paths / module specs.
    if (/^@?\//.test(value) || /\.(ts|tsx|js|mjs)["']?$/.test(value)) continue;
    const low = value.toLowerCase();
    add(index, value, [...matchesPhrase(low), ...matchesIdent(low)]);
  }
  for (const { value, index } of jsxText(code)) {
    const low = value.toLowerCase();
    add(index, value, [...matchesPhrase(low), ...matchesIdent(low)]);
  }
  for (const { value, index } of uiAttrValues(code)) {
    const low = value.toLowerCase();
    add(index, value, [...matchesPhrase(low), ...matchesIdent(low)]);
  }

  for (const h of hits) {
    fail(
      `${rel}:${h.line} "${h.value}" contains ${h.reasons.map((r) => JSON.stringify(r)).join(", ")}`,
    );
  }
  return hits.length;
}

function walkCopyFields(obj, onStr) {
  if (obj == null) return;
  if (Array.isArray(obj)) {
    for (const item of obj) walkCopyFields(item, onStr);
    return;
  }
  if (typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    if (COPY_FIELDS.has(k)) {
      if (typeof v === "string") onStr(k, v);
      else if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === "string") onStr(k, item);
        }
      }
    } else {
      walkCopyFields(v, onStr);
    }
  }
}

function checkArchive(rel, json) {
  let n = 0;
  walkCopyFields(json, (field, value) => {
    const low = value.toLowerCase();
    const reasons = [...matchesPhrase(low), ...matchesIdent(low)];
    if (!reasons.length) return;
    n++;
    fail(
      `${rel} ${field} "${value.replace(/\s+/g, " ").trim().slice(0, 80)}" contains ${reasons.map((r) => JSON.stringify(r)).join(", ")}`,
    );
  });
  return n;
}

function main() {
  let files = 0;
  let hits = 0;

  const uiFiles = [
    ...walkFiles(path.join(ROOT, "src/app"), (p) => /\.(ts|tsx)$/.test(p)),
    ...walkFiles(path.join(ROOT, "src/components"), (p) =>
      /\.(ts|tsx)$/.test(p),
    ),
  ].sort();

  for (const abs of uiFiles) {
    const rel = path.relative(ROOT, abs);
    files++;
    hits += checkTsx(rel, fs.readFileSync(abs, "utf8"));
  }

  const archiveRoot = path.join(ROOT, "public/archive");
  const archiveFiles = walkFiles(archiveRoot, (p) => {
    if (!p.endsWith(".json")) return false;
    const rel = path.relative(archiveRoot, p);
    if (rel.split(path.sep)[0] === "bulk") return false;
    return true;
  }).sort();

  for (const abs of archiveFiles) {
    const rel = path.relative(ROOT, abs);
    files++;
    let json;
    try {
      json = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (err) {
      fail(`${rel} invalid JSON: ${err.message}`);
      continue;
    }
    hits += checkArchive(rel, json);
  }

  const poisRoot = path.join(ROOT, "src/data/pois");
  const poiFiles = walkFiles(poisRoot, (p) => p.endsWith(".json")).sort();
  for (const abs of poiFiles) {
    const rel = path.relative(ROOT, abs);
    files++;
    let json;
    try {
      json = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (err) {
      fail(`${rel} invalid JSON: ${err.message}`);
      continue;
    }
    hits += checkArchive(rel, json);
  }

  if (process.exitCode) {
    console.error(`\ncheck-ui-copy FAILED (${hits} hit${hits === 1 ? "" : "s"})`);
    process.exit(process.exitCode);
  }
  ok(`${files} files, no banned UI-copy phrases`);
  console.log("\ncheck-ui-copy PASSED");
}

main();
