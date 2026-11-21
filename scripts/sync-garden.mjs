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

// Topic groups and note-type labels shared with the site components.
const topicsConfig = readJson(path.join(ROOT, "garden.topics.json"))
// Vault hubs the site no longer uses as topics: hidden, their notes re-classified.
const retiredHubs = new Set(topicsConfig.retiredHubs ?? [])

// "P - title", "O - title", "DI - title": note-type prefixes used in the vault.
const PREFIX = /^([A-Z]{1,3})\s*-\s+(.+)$/

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
  // Show "[[P - 제목]]" as "제목": the prefix is shown as a badge instead.
  out = out.replace(/(?<!!)\[\[([^\]|#]+)(#[^\]|]*)?\]\]/g, (m, target, anchor = "") => {
    const hit = path.posix.basename(target.trim()).match(PREFIX)
    return hit ? `[[${target}${anchor}|${hit[2]}]]` : m
  })
  // Many notes keep their creation date as a "Created: YYYY-MM-DD" line near
  // the top; move it into frontmatter so Quartz can show and sort by it.
  const created = out.match(/^(?:[^\n]*\n){0,5}?\s*Created(?: Time)?:\s*(\d{4}-\d{2}-\d{2})[^\n]*\n?/)
  if (created) {
    // The line is written by hand when the note is made, so it wins over a
    // frontmatter date that a template may have copied from another note.
    data.created = created[1]
    // Template leftovers can also leave an "updated" date earlier than that.
    for (const key of ["updated", "modified", "lastmod"]) {
      const d = data[key] && new Date(String(data[key]))
      if (d && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) < created[1]) delete data[key]
    }
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

function toDate(value) {
  if (!value) return undefined
  const d = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(d.getTime()) ? undefined : d
}

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
    if (data.title == null || String(data.title).trim() === "") delete data.title
    // Permalinks written by the old plugin point at the retired `_notes/` tree.
    if (typeof data.permalink === "string" && data.permalink.includes("_notes")) {
      delete data.permalink
    }
    normalizeTags(data)
    data.publish = true

    const fileBase = path.basename(file, ".md")
    const body = normalizeBody(parsed.content, data, fileBase)
    // The note's own written date (frontmatter or a "Created:" line), before
    // fillDates falls back to file times, which for some sources are copy times.
    let ownDate = toDate(data.created ?? data.date)
    // A source may name the day its files were copied; that date says nothing
    // about when a note was written.
    if (ownDate && source.copyDate && isoDate(ownDate) === source.copyDate) ownDate = undefined
    fillDates(data, stat)
    for (const ref of attachmentRefs(body)) wanted.add(ref)

    seen.add(base)
    const dest = path.join(destRoot, rel)

    if (base !== "index.md") {
      // Note type comes from the top-level folder; root-level notes are topic hubs.
      const destRel = toPosix(path.relative(contentDir, dest))
      const top = destRel.includes("/") ? destRel.split("/")[0] : ""
      if (!top && retiredHubs.has(fileBase)) {
        // Still reachable by URL, but out of menus, search and the map.
        data.unlisted = true
      } else {
        const type = top ? topicsConfig.noteTypes?.[folderTitle(top)] : "주제"
        if (type) data.noteType = type
      }
      // Drop the "P - " style prefix from the displayed title.
      const prefixed = String(data.title ?? fileBase).match(PREFIX)
      if (prefixed) data.title = prefixed[2]

      // Candidates for "최근에 수정한 글": the later of the file's own modification
      // time and any updated/modified date in its frontmatter. Sources whose file
      // times are copy times, not edits, opt out with "recent": false.
      if (source.recent !== false) {
        const stamps = [data.updated, data.modified, data.lastmod]
          .map(toDate)
          .filter(Boolean)
          .map((d) => d.getTime())
        const when = new Date(Math.max(stat.mtimeMs, ...stamps))
        state.recent.push({ name: fileBase, title: String(data.title ?? fileBase), when })
        state.dates.set(fileBase, when)
      } else {
        // Copy times are meaningless here; the written date is the best we have.
        if (ownDate) state.dates.set(fileBase, ownDate)
      }
    }
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
    // A "folder note" (folder/folder.md) already becomes the folder page.
    if (fs.existsSync(path.join(dir, `${path.basename(dir)}.md`))) continue
    const data = { title: folderTitle(path.basename(dir)), publish: true }
    fs.writeFileSync(index, matter.stringify({ content: "" }, data))
  }
}

// ---------------------------------------------------------------------------
// Topic assignments (garden.assignments.json, written by Claude Code on request)

// Text usable as a wikilink alias: no "|" and no square brackets.
const aliasText = (title) =>
  title
    .replace(/\|/g, " ")
    .replace(/[[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()

const linkTargets = (text) =>
  new Set([...text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => path.posix.basename(m[1].trim())))

function contentNotes() {
  const notes = new Map() // name → file
  for (const f of walk(contentDir)) {
    const name = path.basename(f, ".md")
    if (f.endsWith(".md") && name !== "index" && !retiredHubs.has(name)) notes.set(name, f)
  }
  return notes
}

function hubFiles() {
  return new Map(
    fs
      .readdirSync(contentDir)
      .filter((f) => f.endsWith(".md") && f !== "index.md" && !retiredHubs.has(f.slice(0, -3)))
      .map((f) => [f.slice(0, -3), path.join(contentDir, f)]),
  )
}

// Add high-confidence assignments to their hub pages, so the topic menu,
// "속한 주제" and the garden map all pick them up as ordinary links.
function applyAssignments(stats) {
  const assigned = readJson(path.join(ROOT, "garden.assignments.json")).notes ?? {}
  const notes = contentNotes()
  const hubs = hubFiles()
  const additions = new Map()
  for (const [name, a] of Object.entries(assigned)) {
    if (!notes.has(name)) continue
    if (a.confidence === "low") stats.topics.review++
    if (a.confidence === "none") stats.topics.none++
    if (a.confidence !== "high") continue
    for (const hub of a.hubs ?? []) {
      if (!hubs.has(hub)) {
        console.warn(`  ! garden.assignments.json: '${hub}' 허브가 가든에 없습니다 (${name})`)
        continue
      }
      if (!additions.has(hub)) additions.set(hub, [])
      additions.get(hub).push(name)
    }
  }
  for (const [hub, names] of additions) {
    const file = hubs.get(hub)
    const text = fs.readFileSync(file, "utf8")
    const already = linkTargets(text)
    const extra = names
      .filter((n) => !already.has(n))
      .map((n) => ({ n, t: aliasText(String(assigned[n].title ?? n)) }))
      .sort((a, b) => a.t.localeCompare(b.t, "ko"))
    if (!extra.length) continue
    stats.topics.applied += extra.length
    const list = extra.map(({ n, t }) => `- [[${n}|${t}]]`).join("\n")
    // Site-only hubs have no list of their own, so "다른" would read oddly there.
    const heading = already.size ? "이 주제의 다른 노트" : "이 주제의 노트"
    fs.writeFileSync(
      file,
      `${text.trimEnd()}\n\n## ${heading}\n\n<p class="auto-topic-note">내용을 보고 이 주제로 분류한 노트입니다.</p>\n\n${list}\n`,
    )
  }
}

// Notes no hub links to and nobody has classified yet: list them for Claude Code.
function reportUnassigned(stats) {
  const assigned = readJson(path.join(ROOT, "garden.assignments.json")).notes ?? {}
  const notes = contentNotes()
  const hubs = hubFiles()
  const covered = new Set()
  for (const file of hubs.values()) for (const t of linkTargets(fs.readFileSync(file, "utf8"))) covered.add(t)
  const pending = [...notes.keys()].filter((n) => !hubs.has(n) && !covered.has(n) && !(n in assigned))
  stats.topics.unassigned = pending.length

  const outFile = path.join(ROOT, ".garden", "unassigned.md")
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  const items = pending.map((n) => {
    const parsed = matter(fs.readFileSync(notes.get(n), "utf8"))
    const folder = toPosix(path.relative(contentDir, path.dirname(notes.get(n))))
    const text = parsed.content
      .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
      .replace(/[#>*`]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    return { name: n, title: String(parsed.data.title ?? n), folder, excerpt: text.slice(0, 220), text: text.slice(0, 1500) }
  })
  // Machine-readable copy for scripts/classify-garden.mjs (Gemini).
  fs.writeFileSync(
    path.join(ROOT, ".garden", "unassigned.json"),
    JSON.stringify({ hubs: [...hubs.keys()], notes: items }, null, 2),
  )
  const lines = items.map(
    (i) => `- **${i.name}** (${i.folder})\n  - 제목: ${i.title}\n  - 앞부분: ${i.excerpt}`,
  )
  fs.writeFileSync(
    outFile,
    `# 미분류 노트 ${pending.length}개\n\n` +
      `허브: ${[...hubs.keys()].join(", ")}\n\n` +
      (lines.length ? lines.join("\n") : "없음") +
      "\n",
  )
}

// One list per hub page: the vault's own list and the classified notes merged,
// newest first, each with its date; notes from the last 14 days get a "새 글" mark.
function rebuildHubLists(dates) {
  const pad = (n) => String(n).padStart(2, "0")
  const fmt = (d) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`
  const fresh = Date.now() - 14 * 24 * 3600 * 1000
  const notes = contentNotes()
  for (const [hub, file] of hubFiles()) {
    const parsed = matter(fs.readFileSync(file, "utf8"))
    const keep = []
    const entries = new Map()
    for (const line of parsed.content.split(/\r?\n/)) {
      const item = line.match(/^\s*[-*]\s+\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]\s*$/)
      if (item) {
        const target = path.posix.basename(item[1].trim())
        if (notes.has(target) && !entries.has(target)) entries.set(target, item[2]?.trim() ?? target)
        else if (!notes.has(target)) keep.push(line) // unpublished links stay as they were
        continue
      }
      if (/^## 이 주제의 (다른 )?노트/.test(line) || /class="auto-topic-note"/.test(line)) continue
      keep.push(line)
    }
    if (!entries.size) continue
    const rows = [...entries]
      .map(([name, alias]) => ({ name, alias: aliasText(alias), when: dates.get(name) }))
      .sort((a, b) => (b.when?.getTime() ?? 0) - (a.when?.getTime() ?? 0) || a.alias.localeCompare(b.alias, "ko"))
    const list = rows
      .map((r) => {
        const date = r.when ? ` <span class="note-date">${fmt(r.when)}</span>` : ""
        const badge = r.when && r.when.getTime() > fresh ? ` <span class="new-badge">새 글</span>` : ""
        return `- [[${r.name}|${r.alias}]]${badge}${date}`
      })
      .join("\n")
    const intro = keep.join("\n").replace(/\n{3,}/g, "\n\n").trim()
    const body = `${intro ? intro + "\n\n" : ""}## 노트 ${rows.length}개\n\n<p class="auto-topic-note">최근에 수정한 노트부터 보여 줍니다.</p>\n\n${list}\n`
    fs.writeFileSync(file, matter.stringify({ content: body }, parsed.data))
  }
}

// Fill the home page's "최근에 수정한 글" with the most recently edited notes.
function writeRecentSection(recent, limit = 8) {
  const index = path.join(contentDir, "index.md")
  if (!fs.existsSync(index)) return
  const text = fs.readFileSync(index, "utf8")
  const re = /(<!-- recent:start[^>]*-->)[\s\S]*?(<!-- recent:end -->)/
  if (!re.test(text)) return
  const pad = (n) => String(n).padStart(2, "0")
  const fmt = (d) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`
  const md = [...recent]
    .sort((a, b) => b.when - a.when)
    .slice(0, limit)
    .map((r) => `- [[${r.name}|${aliasText(r.title)}]] <span class="recent-date">${fmt(r.when)}</span>`)
    .join("\n")
  fs.writeFileSync(index, text.replace(re, (_, start, end) => `${start}\n\n${md}\n\n${end}`))
}

// Fill the home page's topic section from garden.topics.json.
function writeTopicSection() {
  const index = path.join(contentDir, "index.md")
  if (!fs.existsSync(index)) return
  const text = fs.readFileSync(index, "utf8")
  const re = /(<!-- topics:start[^>]*-->)[\s\S]*?(<!-- topics:end -->)/
  if (!re.test(text)) return
  const hubs = [...hubFiles().keys()]
  const groups = (topicsConfig.groups ?? []).map((g) => {
    for (const h of g.hubs) {
      if (!hubs.includes(h)) console.warn(`  ! garden.topics.json의 '${h}' 허브 노트가 가든에 없습니다.`)
    }
    return { name: g.name, hubs: g.hubs.filter((h) => hubs.includes(h)) }
  })
  const placed = new Set(groups.flatMap((g) => g.hubs))
  const rest = hubs.filter((h) => !placed.has(h)).sort((a, b) => a.localeCompare(b, "ko"))
  if (rest.length) groups.push({ name: "그 밖의 주제", hubs: rest })
  const md = groups
    .filter((g) => g.hubs.length)
    .map((g) => `### ${g.name}\n\n${g.hubs.map((h) => `- [[${h}]]`).join("\n")}`)
    .join("\n\n")
  fs.writeFileSync(index, text.replace(re, (_, start, end) => `${start}\n\n${md}\n\n${end}`))
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
  recent: [],
  dates: new Map(), // note name → last edit (or written) date, for hub lists
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
    topics: { applied: 0, review: 0, none: 0, unassigned: 0 },
  },
}
// Safety: a source folder that has gone missing (a USB drive unplugged, a folder
// deleted) must not turn into "all of its notes were removed". Stop before
// content/ is touched; publishing then stops too, so nothing is deployed.
const missing = config.sources
  .filter((s) => !s.optional && !fs.existsSync(path.resolve(ROOT, s.path)))
  .map((s) => s.path)
if (missing.length) {
  console.error(
    [
      `✖ 원본 폴더를 찾지 못해 동기화를 멈췄습니다: ${missing.join(", ")}`,
      "  드라이브가 연결돼 있는지 확인하세요. 그 노트들을 정말 사이트에서 빼려면",
      "  garden.sync.json에서 그 원본을 지우거나 \"optional\": true를 붙이세요.",
    ].join("\n"),
  )
  process.exit(1)
}

const countNotes = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).reduce(
        (n, e) => n + (e.isDirectory() ? countNotes(path.join(dir, e.name)) : e.name.endsWith(".md") ? 1 : 0),
        0,
      )
    : 0
const notesBefore = countNotes(contentDir)

if (!DRY_RUN) await cleanContent()
for (const source of config.sources) syncSource(source, state)
if (!DRY_RUN) {
  applyAssignments(state.stats)
  reportUnassigned(state.stats)
  rebuildHubLists(state.dates)
  writeFolderIndexes()
  writeTopicSection()
  writeRecentSection(state.recent)
}

const { stats } = state
console.log(
  `${DRY_RUN ? "[dry-run] " : ""}복사 ${stats.copied}개 · 첨부 ${stats.attachments}개 · 공개 표시 없음 ${stats.unflagged}개 · 제외 폴더 ${stats.blocked}개 · 중복 ${stats.duplicates.length}개 · 머리말 오류 ${stats.broken.length}개`,
)
for (const [src, n] of Object.entries(stats.bySource)) console.log(`  ${src}: ${n}개`)
console.log(`  걸린 시간: ${stats.timing.join(", ")}`)
for (const file of stats.broken) console.warn(`  ! 머리말(frontmatter) 형식이 깨져 건너뜀: ${file}`)
for (const name of stats.missingAttachments) console.warn(`  ! 첨부 파일을 찾지 못함: ${name}`)
if (!DRY_RUN) {
  const t = stats.topics
  console.log(
    `주제 분류: 자동 반영 ${t.applied}개 · 확인 대기 ${t.review}개 · 맞는 주제 없음 ${t.none}개 · 미분류 ${t.unassigned}개`,
  )
  if (t.unassigned > 0) {
    console.log("  → Claude Code에 '미분류 정리해 줘'라고 하면 분류합니다. (목록: .garden/unassigned.md)")
  }
}
// Safety: a sudden large drop in notes is far more likely a mistake than a
// clean-up. Fail so that garden:publish does not commit or push it.
if (!DRY_RUN && !process.env.GARDEN_ALLOW_SHRINK) {
  const notesAfter = countNotes(contentDir)
  if (notesBefore >= 50 && notesAfter < notesBefore * 0.8) {
    console.error(
      [
        `✖ 노트가 ${notesBefore}개에서 ${notesAfter}개로 크게 줄어 배포를 멈췄습니다.`,
        "  원본 폴더나 publish 표시를 확인하세요. 의도한 정리라면",
        "  GARDEN_ALLOW_SHRINK=1 을 붙여 다시 실행하세요.",
      ].join("\n"),
    )
    process.exit(1)
  }
}
if (!DRY_RUN && !privacyCheck()) process.exit(1)
