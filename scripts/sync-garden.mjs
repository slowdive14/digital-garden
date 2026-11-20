#!/usr/bin/env node
// Copy publishable notes from Obsidian folders into Quartz `content/`.
//
// Replaces the Obsidian "Digital Garden" plugin: notes are selected by a
// frontmatter flag (`publish: true`, legacy `dg-publish: true`), normalized for
// Quartz, then scanned for personal data before anything can be committed.
//
// Usage:
//   node scripts/sync-garden.mjs            sync + privacy check
//   node scripts/sync-garden.mjs --dry-run  show what would be copied
//   node scripts/sync-garden.mjs --check    privacy check on content/ only
//
// Config: garden.sync.json (committed) + garden.local.json (git-ignored, for
// folder names and paths that must not be published).

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import matter from "gray-matter"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has("--dry-run")
const CHECK_ONLY = args.has("--check")

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
}

const baseConfig = readJson(path.join(ROOT, "garden.sync.json"))
const localConfig = readJson(path.join(ROOT, baseConfig.localConfig ?? "garden.local.json"))
const config = {
  ...baseConfig,
  blockedPathSegments: [
    ...(baseConfig.blockedPathSegments ?? []),
    ...(localConfig.blockedPathSegments ?? []),
  ],
  allowSensitive: [...(baseConfig.allowSensitive ?? []), ...(localConfig.allowSensitive ?? [])],
}

const contentDir = path.resolve(ROOT, config.contentDir ?? "content")
if (!contentDir.startsWith(ROOT + path.sep)) {
  throw new Error(`contentDir must live inside the repository: ${contentDir}`)
}

// Frontmatter keys that only made sense for the old plugin / Hugo theme.
const DROP_KEYS = [
  "dg-publish",
  "dg-path",
  "dg-home",
  "dg-permalink",
  "dg-note-icon",
  "noteIcon",
  "comments",
  "ShowToc",
  "draft",
]

const ATTACHMENT_EXT = /\.(png|jpe?g|gif|webp|svg|avif|pdf|mp3|m4a|mp4|webm)$/i

// ---------------------------------------------------------------------------
// Privacy check

const SENSITIVE_PATTERNS = [
  { name: "휴대전화 번호", re: /(?<!\d)01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g },
  {
    name: "주민등록번호",
    // YYMMDD + gender digit; the date check keeps ISBNs (978…) out.
    re: /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[-\s]?[1-4]\d{6}(?!\d)/g,
  },
  { name: "이메일 주소", re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
]

// Numbers inside URLs (article ids, barcodes, timestamps) are not personal data.
const stripUrls = (line) => line.replace(/https?:\/\/[^\s)>\]]+/g, " ")

function loadDenylist() {
  const file = path.resolve(ROOT, config.denylistFile ?? ".garden-denylist.txt")
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
}

function scanFile(file, denylist) {
  const hits = []
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/)
  lines.forEach((rawLine, i) => {
    const line = stripUrls(rawLine)
    for (const { name, re } of SENSITIVE_PATTERNS) {
      re.lastIndex = 0
      if (re.test(line)) hits.push({ line: i + 1, reason: name })
    }
    for (const word of denylist) {
      if (line.includes(word)) hits.push({ line: i + 1, reason: "금지어 목록" })
    }
  })
  return hits
}

function privacyCheck() {
  const denylist = loadDenylist()
  const allow = new Set(config.allowSensitive)
  const report = []
  for (const file of walk(contentDir)) {
    if (!file.endsWith(".md")) continue
    const rel = toPosix(path.relative(contentDir, file))
    if (allow.has(rel)) continue
    const hits = scanFile(file, denylist)
    if (hits.length) report.push({ rel, hits })
  }
  if (!report.length) {
    console.log("✔ 개인정보 검사 통과")
    return true
  }
  console.error("✖ 개인정보로 보이는 내용이 있습니다. 확인 전에는 배포하지 마세요.")
  for (const { rel, hits } of report) {
    for (const h of hits) console.error(`  ${rel}:${h.line}  (${h.reason})`)
  }
  console.error("  괜찮은 항목이면 garden.local.json의 allowSensitive에 파일 경로를 추가하세요.")
  return false
}

// ---------------------------------------------------------------------------
// Helpers

const toPosix = (p) => p.split(path.sep).join("/")

// Walks a tree, never entering blocked folders (so private notes are not even read).
function* walk(dir, isBlockedDir = () => false, root = dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (isBlockedDir(toPosix(path.relative(root, full)))) continue
      yield* walk(full, isBlockedDir, root)
    } else {
      yield full
    }
  }
}

function blockedSegments(source) {
  return new Set([...config.blockedPathSegments, ...(source.exclude ?? [])])
}

function hasBlockedSegment(relPosix, blocked) {
  return relPosix.split("/").some((seg) => blocked.has(seg))
}

// Cheap pre-check: only the first few KB are read for each of thousands of notes.
function looksFlagged(file) {
  const fd = fs.openSync(file, "r")
  try {
    const buf = Buffer.alloc(4096)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    const head = buf.subarray(0, n).toString("utf8").replace(/^﻿/, "")
    if (!head.startsWith("---")) return false
    // Top-level keys only: nested ones like `tistory: { publish: true }` belong
    // to other plugins and must not publish a note.
    return /(^|[{,]\s*)"?(dg-)?publish"?\s*:\s*true\b/m.test(head)
  } finally {
    fs.closeSync(fd)
  }
}

function isFlagged(data) {
  return data.publish === true || data["dg-publish"] === true
}

function normalizeTags(data) {
  const raw = []
  for (const key of ["tags", "categories"]) {
    const value = data[key]
    if (Array.isArray(value)) raw.push(...value)
    else if (typeof value === "string" && value.trim()) raw.push(...value.split(","))
    delete data[key]
  }
  const tags = [
    ...new Set(
      raw
        .filter((t) => t != null)
        .map((t) => String(t).trim().replace(/^#/, "").replace(/\s+/g, "-"))
        .filter(Boolean),
    ),
  ]
  if (tags.length) data.tags = tags
}

// ```ad-note … ``` blocks from the Admonition plugin → Obsidian callouts.
function admonitionsToCallouts(text) {
  return text.replace(/^```ad-([\w-]+)[^\n]*\n([\s\S]*?)^```[ \t]*$/gm, (_, type, inner) => {
    const lines = inner.replace(/\n$/, "").split("\n")
    let title = ""
    while (lines.length && /^(title|collapse|icon|color):/i.test(lines[0])) {
      const [key, ...rest] = lines.shift().split(":")
      if (key.toLowerCase() === "title") title = rest.join(":").trim()
    }
    const head = `> [!${type}]${title ? ` ${title}` : ""}`
    return [head, ...lines.map((l) => (l ? `> ${l}` : ">"))].join("\n")
  })
}

// [text](obsidian://open?vault=…&file=folder%2Fnote) → [[note|text]]
function obsidianUrisToWikilinks(text) {
  return text.replace(/\[([^\]]*)\]\(obsidian:\/\/open\?[^)]*?file=([^)&\s]+)[^)]*\)/g, (m, label, file) => {
    try {
      const name = path.posix.basename(decodeURIComponent(file)).replace(/\.md$/, "")
      return label && label !== name ? `[[${name}|${label}]]` : `[[${name}]]`
    } catch {
      return label || m
    }
  })
}

function normalizeBody(body, data, fileTitle) {
  let out = body
  // Old vault links pointed at a `_notes/` folder that no longer exists.
  out = out.replace(/\[\[_notes\//g, "[[")
  out = admonitionsToCallouts(out)
  out = obsidianUrisToWikilinks(out)
  // Many notes keep their creation date as a "Created: YYYY-MM-DD" line near
  // the top; move it into frontmatter so Quartz can show and sort by it.
  const created = out.match(/^(?:[^\n]*\n){0,5}?\s*Created(?: Time)?:\s*(\d{4}-\d{2}-\d{2})[^\n]*\n?/)
  if (created) {
    if (!data.created) data.created = created[1]
    out = out.replace(/^\s*Created(?: Time)?:\s*\d{4}-\d{2}-\d{2}[^\n]*\n?/m, "")
  }
  // Notes often repeat their title as the first heading; Quartz already shows it.
  const titles = [data.title, fileTitle].filter(Boolean).map((t) => String(t).trim())
  const firstHeading = out.match(/^\s*#{1,6}\s+(.+?)\s*(?:\r?\n|$)/)
  if (firstHeading && titles.includes(firstHeading[1].trim())) {
    out = out.slice(firstHeading[0].length)
  }
  return out
}

function attachmentRefs(text) {
  const refs = new Set()
  for (const m of text.matchAll(/!\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) refs.add(m[1].trim())
  for (const m of text.matchAll(/!\[[^\]]*\]\((?!https?:)([^)\s]+)\)/g)) {
    try {
      refs.add(decodeURIComponent(m[1]))
    } catch {
      refs.add(m[1])
    }
  }
  return [...refs].filter((r) => ATTACHMENT_EXT.test(r)).map((r) => path.posix.basename(r))
}

const isoDate = (d) => d.toISOString().slice(0, 10)

// Dates must come from the source note, not from the copy we just wrote.
function fillDates(data, stat) {
  const born = stat.birthtimeMs > 0 ? Math.min(stat.birthtimeMs, stat.mtimeMs) : stat.mtimeMs
  if (!data.created && !data.date) data.created = isoDate(new Date(born))
  if (!data.modified && !data.updated) data.modified = isoDate(stat.mtime)
}

// Folder titles without the "1.2. " style numbering, used for the explorer.
const folderTitle = (name) => name.replace(/^\d+(?:[.-]\d+)*\.?\s+/, "") || name

// ---------------------------------------------------------------------------
// Sync

function syncSource(source, state) {
  const { stats, seen } = state
  const srcRoot = path.resolve(ROOT, source.path)
  if (!fs.existsSync(srcRoot)) {
    console.warn(`! 원본 폴더가 없습니다: ${srcRoot}`)
    return
  }
  const destRoot = path.resolve(contentDir, source.dest ?? ".")
  const blocked = blockedSegments(source)
  const attachments = new Map() // basename → full path, for embeds
  const wanted = new Set()
  const started = Date.now()

  for (const file of walk(srcRoot, (rel) => hasBlockedSegment(rel, blocked))) {
    const rel = path.relative(srcRoot, file)
    const relPosix = toPosix(rel)
    if (!file.endsWith(".md")) {
      if (ATTACHMENT_EXT.test(file)) attachments.set(path.basename(file), file)
      continue
    }
    if (hasBlockedSegment(relPosix, blocked)) {
      stats.blocked++
      continue
    }
    if (source.requireFlag !== false && !looksFlagged(file)) {
      stats.unflagged++
      continue
    }

    const base = path.basename(file)
    if (base !== "index.md" && seen.has(base)) {
      stats.duplicates.push(`${source.path}/${relPosix}`)
      continue
    }

    const stat = fs.statSync(file)
    let parsed
    try {
      parsed = matter(fs.readFileSync(file, "utf8"))
    } catch {
      stats.broken.push(`${source.path}/${relPosix}`)
      continue
    }
    const data = { ...parsed.data }
    if (source.requireFlag !== false && !isFlagged(data)) {
      stats.unflagged++
      continue
    }

    for (const key of DROP_KEYS) delete data[key]
    if (data.aliases == null || data.aliases === "") delete data.aliases
    // Permalinks written by the old plugin point at the retired `_notes/` tree.
    if (typeof data.permalink === "string" && data.permalink.includes("_notes")) {
      delete data.permalink
    }
    normalizeTags(data)
    data.publish = true

    const body = normalizeBody(parsed.content, data, path.basename(file, ".md"))
    fillDates(data, stat)
    for (const ref of attachmentRefs(body)) wanted.add(ref)

    seen.add(base)
    const dest = path.join(destRoot, rel)
    stats.copied++
    stats.bySource[source.path] = (stats.bySource[source.path] ?? 0) + 1
    if (DRY_RUN) {
      console.log(`  + ${toPosix(path.relative(contentDir, dest))}`)
      continue
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    // Pass an object, not a string: gray-matter would otherwise try to parse a
    // body that starts with a `---` horizontal rule as frontmatter.
    fs.writeFileSync(dest, matter.stringify({ content: body }, data))
    fs.utimesSync(dest, stat.atime, stat.mtime)
  }

  // Copy only the attachments that published notes embed.
  for (const name of wanted) {
    const src = attachments.get(name)
    if (!src) {
      stats.missingAttachments.push(name)
      continue
    }
    stats.attachments++
    if (DRY_RUN) continue
    const dest = path.join(contentDir, "attachments", name)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }

  stats.timing.push(`${source.path}: ${((Date.now() - started) / 1000).toFixed(1)}초`)
}

// Give every folder an index page so the explorer shows "영구 메모" instead of "1.3. 영구 메모".
function writeFolderIndexes() {
  for (const dir of walkDirs(contentDir)) {
    if (dir === contentDir || path.basename(dir) === "attachments") continue
    const index = path.join(dir, "index.md")
    if (fs.existsSync(index)) continue
    const data = { title: folderTitle(path.basename(dir)), publish: true }
    fs.writeFileSync(index, matter.stringify({ content: "" }, data))
  }
}

function* walkDirs(dir) {
  yield dir
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) yield* walkDirs(path.join(dir, entry.name))
  }
}

async function cleanContent() {
  const keep = new Set(config.keep ?? [])
  if (!fs.existsSync(contentDir)) fs.mkdirSync(contentDir, { recursive: true })
  for (const entry of fs.readdirSync(contentDir)) {
    if (keep.has(entry)) continue
    // fs.rmSync silently kills Node 24 on Windows for non-ASCII file names;
    // the promise-based rm does not have that problem.
    await fs.promises.rm(path.join(contentDir, entry), { recursive: true, force: true })
  }
}

if (CHECK_ONLY) {
  process.exit(privacyCheck() ? 0 : 1)
}

const state = {
  seen: new Set(),
  stats: {
    copied: 0,
    unflagged: 0,
    blocked: 0,
    attachments: 0,
    bySource: {},
    broken: [],
    duplicates: [],
    missingAttachments: [],
    timing: [],
  },
}
if (!DRY_RUN) await cleanContent()
for (const source of config.sources) syncSource(source, state)
if (!DRY_RUN) writeFolderIndexes()

const { stats } = state
console.log(
  `${DRY_RUN ? "[dry-run] " : ""}복사 ${stats.copied}개 · 첨부 ${stats.attachments}개 · 공개 표시 없음 ${stats.unflagged}개 · 제외 폴더 ${stats.blocked}개 · 중복 ${stats.duplicates.length}개 · 머리말 오류 ${stats.broken.length}개`,
)
for (const [src, n] of Object.entries(stats.bySource)) console.log(`  ${src}: ${n}개`)
console.log(`  걸린 시간: ${stats.timing.join(", ")}`)
for (const file of stats.broken) console.warn(`  ! 머리말(frontmatter) 형식이 깨져 건너뜀: ${file}`)
for (const name of stats.missingAttachments) console.warn(`  ! 첨부 파일을 찾지 못함: ${name}`)
if (!DRY_RUN && !privacyCheck()) process.exit(1)
