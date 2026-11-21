#!/usr/bin/env node
// Fill the empty "연결" section of published vault notes with 1–3 related notes,
// chosen by Gemini from the vault folders the garden reads (1. 문헌 메모, 2. 의견).
//
// - Only notes with `publish: true` whose "연결" section has no [[link]] yet.
// - Links to notes already on the garden get a 🌱 after them (kept up to date
//   on later runs); the site itself drops the mark.
// - Each note is filled once (recorded in .garden/linked.json); if you later
//   delete or change the links, they are left alone.
// - The note is backed up to .garden/backup/ before it is changed, and only the
//   "연결" section is touched; frontmatter and everything else stay byte-for-byte.
//
// Usage:
//   node scripts/link-garden.mjs           write links into the vault notes
//   node scripts/link-garden.mjs --dry     show what would be written, change nothing
//   node scripts/link-garden.mjs --limit 3 at most 3 notes this run

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import matter from "gray-matter"
import { apiKey, generate, parseJson } from "./gemini.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const DRY = args.includes("--dry")
const limitIdx = args.indexOf("--limit")
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1] ?? 5) : 20

const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {})
const config = readJson(path.join(ROOT, "garden.sync.json"))
const local = readJson(path.join(ROOT, "garden.local.json"))
const blocked = new Set([...(config.blockedPathSegments ?? []), ...(local.blockedPathSegments ?? [])])

// The vault folders the garden reads: sources outside this repository.
const folders = (config.sources ?? [])
  .map((s) => s.path)
  .filter((p) => path.isAbsolute(p) && fs.existsSync(p))

const stateFile = path.join(ROOT, ".garden", "linked.json")
const state = readJson(stateFile)

function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (blocked.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.name.endsWith(".md")) out.push(p)
  }
  return out
}

// Marks a link whose note is on the garden (stripped from the site by sync-garden).
const MARK = "🌱"

const displayTitle = (name) => name.replace(/^[A-Z]\s*-\s+/, "").trim()
const isPublished = (data) => data.publish === true || data["dg-publish"] === true

// "연결" section: its heading line index and the lines up to the next heading,
// the "키워드::" line or the end of the note.
function findSection(lines) {
  const start = lines.findIndex((l) => /^#{1,6}\s*연결\s*$/.test(l.trim()))
  if (start < 0) return undefined
  let end = start + 1
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end].trim()) && !/^키워드::/.test(lines[end].trim())) end++
  return { start, end }
}

function buildPrompt(note, candidates) {
  return [
    "너는 심리치료와 글쓰기를 다루는 개인 지식 노트(제텔카스텐)의 편집자다.",
    "아래 '대상 노트'와 생각이 이어지는 노트를 '후보 노트 목록'에서 1~3개 고른다.",
    "",
    "## 규칙",
    "- 같은 낱말이 나오는 것보다, 주장·개념·사례가 서로 보완하거나 이어지는 노트를 고른다.",
    "- 정말 관련 있는 노트만 고른다. 확신이 서는 것이 하나뿐이면 하나만 고른다.",
    "- reason은 왜 연결되는지 한국어 한 문장(40자 안팎)으로, '~함', '~임'처럼 명사형으로 끝낸다.",
    "- id는 후보 목록의 번호를 그대로 쓴다.",
    "",
    '## 출력: JSON 배열만. 예: [{"id": 12, "reason": "목표 설정이 동기에 미치는 영향을 다른 각도에서 설명함"}]',
    "",
    "## 대상 노트",
    `제목: ${note.title}`,
    note.text,
    "",
    "## 후보 노트 목록",
    ...candidates.map((c, i) => `${i}: ${c.title}`),
  ].join("\n")
}

async function main() {
  if (!folders.length) {
    console.log("! 볼트 폴더를 찾지 못해 자동 연결을 건너뜁니다.")
    return
  }
  const files = folders.flatMap(walk)
  const notes = []
  for (const file of files) {
    let raw
    let parsed
    try {
      raw = fs.readFileSync(file, "utf8")
      parsed = matter(raw)
    } catch {
      continue
    }
    const name = path.basename(file, ".md")
    notes.push({ file, name, title: displayTitle(String(parsed.data.title ?? name)), raw, parsed })
  }

  // Notes on the garden: last sync's content/ plus notes marked to publish now.
  const published = new Set(notes.filter((n) => isPublished(n.parsed.data)).map((n) => n.name))
  const contentDir = path.join(ROOT, "content")
  if (fs.existsSync(contentDir)) {
    for (const f of walk(contentDir)) if (path.basename(f) !== "index.md") published.add(path.basename(f, ".md"))
  }
  const linkLine = (name) => `- [[${name}]]${published.has(name) ? ` ${MARK}` : ""}`

  // Keep the 🌱 marks on links this script added in step with the garden: a
  // linked note may have been published or taken down since. Links written by
  // hand are never touched.
  if (!DRY) {
    for (const n of notes) {
      const links = state[n.file]?.links
      if (!links?.length) continue
      const eol = n.raw.includes("\r\n") ? "\r\n" : "\n"
      const lines = n.raw.split(/\r?\n/)
      const sec = findSection(lines)
      if (!sec) continue
      let changed = false
      for (let i = sec.start + 1; i < sec.end; i++) {
        const m = lines[i].match(/^- \[\[([^\]]+)\]\](?: 🌱)?\s*$/)
        if (!m || !links.includes(m[1])) continue
        const want = linkLine(m[1])
        if (lines[i] !== want) {
          lines[i] = want
          changed = true
        }
      }
      if (changed) {
        fs.writeFileSync(n.file, lines.join(eol))
        console.log(`  ~ ${n.title}: 가든 표시(${MARK}) 갱신`)
      }
    }
  }

  const targets = notes.filter((n) => {
    if (!isPublished(n.parsed.data) || state[n.file]) return false
    const lines = n.raw.split(/\r?\n/)
    const sec = findSection(lines)
    return sec && !lines.slice(sec.start + 1, sec.end).some((l) => /\[\[|https?:\/\//.test(l))
  })
  if (!targets.length) {
    console.log("✔ 연결을 채울 노트가 없습니다.")
    return
  }
  const key = apiKey()
  if (!key) {
    console.log("! GEMINI_API_KEY를 찾지 못해 자동 연결을 건너뜁니다.")
    return
  }

  let done = 0
  for (const note of targets.slice(0, LIMIT)) {
    const body = note.parsed.content
    const already = new Set([...body.matchAll(/\[\[([^\]|#]+)/g)].map((m) => path.basename(m[1].trim())))
    const candidates = notes.filter((c) => c.file !== note.file && !already.has(c.name))
    const text = body.replace(/\s+/g, " ").slice(0, 2500)
    let picks
    let model
    try {
      const res = await generate(key, buildPrompt({ title: note.title, text }, candidates), { maxOutputTokens: 2048 })
      model = res.model
      picks = (parseJson(res.text) ?? [])
        .filter((p) => Number.isInteger(p?.id) && candidates[p.id])
        .slice(0, 3)
        .map((p) => ({ name: candidates[p.id].name, reason: String(p.reason ?? "").trim() }))
    } catch (err) {
      console.log(`  ! ${note.title}: ${String(err).slice(0, 160)} (다음 실행에서 다시 시도)`)
      continue
    }
    if (!picks.length) {
      console.log(`  · ${note.title}: 어울리는 노트가 없다는 응답`)
      continue
    }

    const eol = note.raw.includes("\r\n") ? "\r\n" : "\n"
    const lines = note.raw.split(/\r?\n/)
    const sec = findSection(lines)
    // Keep anything already written in the section except empty bullets.
    const kept = lines.slice(sec.start + 1, sec.end).filter((l) => l.trim() && !/^\s*[-*]\s*$/.test(l))
    const added = picks.flatMap((p) => [linkLine(p.name), ...(p.reason ? [`    - ${p.reason}`] : [])])
    // Only the section changes; one blank line before whatever follows it.
    const rest = lines.slice(sec.end)
    const gap = rest.length && rest[0].trim() ? [""] : []
    const out = [...lines.slice(0, sec.start + 1), ...kept, ...added, ...gap, ...rest].join(eol)

    console.log(`  + ${note.title}`)
    for (const p of picks) console.log(`      → ${displayTitle(p.name)}${published.has(p.name) ? ` ${MARK}` : ""} — ${p.reason}`)
    if (DRY) continue

    const stamp = new Date().toISOString().slice(0, 10)
    const backup = path.join(ROOT, ".garden", "backup", `link-${stamp}`, path.basename(note.file))
    fs.mkdirSync(path.dirname(backup), { recursive: true })
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, note.raw)
    fs.writeFileSync(note.file, out)
    state[note.file] = { at: new Date().toISOString(), model, links: picks.map((p) => p.name) }
    fs.mkdirSync(path.dirname(stateFile), { recursive: true })
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n")
    done++
  }
  console.log(DRY ? "✔ 미리 보기만 했습니다(--dry)." : `✔ 노트 ${done}개의 '연결'을 채웠습니다. 원본은 .garden/backup/에 있습니다.`)
}

main().catch((err) => {
  console.error(`✖ 자동 연결 실패: ${String(err).slice(0, 300)}`)
  process.exit(1)
})
