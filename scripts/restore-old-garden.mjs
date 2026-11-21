#!/usr/bin/env node
// One-off recovery: rebuild the old garden's notes (once synced from D:/slowdive/notes,
// a folder that no longer exists) from a commit of content/, into import/old-garden/.
// Strips what the sync itself had added (noteType/unlisted and the generated hub
// lists). Dates stay as they were, so pages show what they showed before; the
// old copy date is excluded from hub-list dates by "copyDate" in garden.sync.json.
//
// Usage: node scripts/restore-old-garden.mjs <extracted content dir> <NUL-separated list of paths>

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import matter from "gray-matter"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const [srcRoot, listFile] = process.argv.slice(2)
const dest = path.join(ROOT, "import", "old-garden")

const rels = fs
  .readFileSync(listFile, "utf8")
  .split("\0")
  .filter(Boolean)
  .map((p) => p.replace(/^content\//, ""))

let written = 0
for (const rel of rels) {
  const src = path.join(srcRoot, rel)
  const out = path.join(dest, rel)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  if (!rel.endsWith(".md")) {
    fs.copyFileSync(src, out)
    written++
    continue
  }
  const parsed = matter(fs.readFileSync(src, "utf8"))
  const data = parsed.data
  delete data.noteType
  delete data.unlisted
  let body = parsed.content
  if (!rel.includes("/")) {
    // Hub page: back to a plain list of links.
    body = body
      .split(/\r?\n/)
      .filter((l) => !/^## 노트 \d+개\s*$/.test(l) && !/class="auto-topic-note"/.test(l))
      .map((l) => l.replace(/\]\](\s*<span class="(?:new-badge|note-date)">[^<]*<\/span>)+\s*$/, "]]"))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
  }
  fs.writeFileSync(out, matter.stringify({ content: body }, data))
  written++
}
console.log(`restored ${written} files into import/old-garden`)
