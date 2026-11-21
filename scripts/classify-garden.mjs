#!/usr/bin/env node
// Classify unassigned garden notes into topic hubs with Gemini and record the
// result in garden.assignments.json (entries already there are never changed).
//
// Input: .garden/unassigned.json, written by `npm run garden:sync`.
// Key:   GEMINI_API_KEY from the environment, or from the .env file named in
//        garden.local.json → gemini.envFile (kept out of git).
//
// Usage:
//   node scripts/classify-garden.mjs            classify and save
//   node scripts/classify-garden.mjs --sample 5 classify 5 already-classified notes
//                                                 and print a comparison (nothing saved)

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import matter from "gray-matter"
import { apiKey, generate } from "./gemini.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const sampleIdx = args.indexOf("--sample")
const SAMPLE = sampleIdx >= 0 ? Number(args[sampleIdx + 1] ?? 5) : 0
const BATCH = 15

const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {})
// ---------------------------------------------------------------------------
// What each hub is about: its description, or the titles of notes it links to.

function hubProfiles(hubNames) {
  const contentDir = path.join(ROOT, "content")
  return hubNames.map((name) => {
    const file = path.join(contentDir, `${name}.md`)
    if (!fs.existsSync(file)) return { name, about: "" }
    const parsed = matter(fs.readFileSync(file, "utf8"))
    if (parsed.data.description) return { name, about: String(parsed.data.description) }
    const titles = [...parsed.content.matchAll(/\[\[[^\]|]+\|([^\]]+)\]\]|\[\[([^\]|#]+)\]\]/g)]
      .map((m) => (m[1] ?? m[2]).trim())
      .slice(0, 10)
    return { name, about: `예시 노트: ${titles.join(" / ")}` }
  })
}

function buildPrompt(hubs, notes) {
  return [
    "너는 심리치료와 글쓰기를 다루는 개인 디지털 가든의 편집자다.",
    "아래 노트를 주제 허브에 분류한다.",
    "",
    "## 규칙",
    "- 노트마다 허브를 0~2개 고른다. 가장 잘 맞는 허브를 먼저 쓴다.",
    "- 허브 이름은 아래 목록의 이름을 글자 그대로 쓴다. 목록에 없는 이름은 쓰지 않는다.",
    '- confidence: 내용이 그 허브의 중심 주제와 분명히 맞으면 "high", 맞을 수도 있지만 애매하면 "low", 맞는 허브가 없으면 "none"(이때 hubs는 빈 배열).',
    '- 맞는 허브가 없고 새 주제가 필요해 보이면 suggest에 새 허브 이름(짧은 한국어 명사구)을 적는다. 없으면 suggest를 빼거나 빈 문자열로 둔다.',
    "- name은 입력에 적힌 값을 한 글자도 바꾸지 않고 그대로 돌려준다.",
    "",
    '## 출력: JSON 배열만. 예: [{"name": "...", "hubs": ["동기"], "confidence": "high", "suggest": ""}]',
    "",
    "## 허브 목록",
    ...hubs.map((h) => `- ${h.name}: ${h.about}`),
    "",
    "## 분류할 노트",
    ...notes.map((n) =>
      JSON.stringify({ name: n.name, title: n.title, folder: n.folder, text: n.text }),
    ),
  ].join("\n")
}

function parseResult(text, hubNames, batch) {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "")
  const rows = JSON.parse(cleaned)
  const byName = new Map(batch.map((n) => [n.name, n]))
  const out = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const note = byName.get(row?.name)
    if (!note) continue
    const hubs = [...new Set((row.hubs ?? []).filter((h) => hubNames.includes(h)))].slice(0, 2)
    let confidence = ["high", "low", "none"].includes(row.confidence) ? row.confidence : "low"
    if (!hubs.length) confidence = "none"
    const entry = { title: note.title, hubs, confidence }
    if (row.suggest && confidence !== "high") entry.suggest = String(row.suggest).trim()
    out.set(note.name, entry)
  }
  return out
}

// ---------------------------------------------------------------------------

async function main() {
  const key = apiKey()
  if (!key) {
    console.log("! GEMINI_API_KEY를 찾지 못해 자동 분류를 건너뜁니다. (garden.local.json의 gemini.envFile 확인)")
    process.exit(0)
  }
  const assignFile = path.join(ROOT, "garden.assignments.json")
  const doc = readJson(assignFile)
  doc.notes ??= {}
  const input = readJson(path.join(ROOT, ".garden", "unassigned.json"))
  const hubNames = input.hubs ?? []
  if (!hubNames.length) {
    console.log("! .garden/unassigned.json이 없습니다. 먼저 npm run garden:sync를 실행하세요.")
    process.exit(1)
  }

  let notes = input.notes ?? []
  if (SAMPLE) {
    // Re-classify a few notes that already have a high-confidence answer, to compare.
    const known = Object.entries(doc.notes).filter(([, v]) => v.confidence === "high")
    const picked = known.sort(() => Math.random() - 0.5).slice(0, SAMPLE)
    const contentFiles = new Map()
    ;(function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (p.endsWith(".md")) contentFiles.set(path.basename(p, ".md"), p)
      }
    })(path.join(ROOT, "content"))
    notes = picked
      .filter(([name]) => contentFiles.has(name))
      .map(([name, v]) => {
        const text = matter(fs.readFileSync(contentFiles.get(name), "utf8")).content.replace(/\s+/g, " ")
        return { name, title: v.title, folder: "", text: text.slice(0, 1500), expected: v.hubs }
      })
  }
  if (!notes.length) {
    console.log("✔ 분류할 미분류 노트가 없습니다.")
    return
  }

  const profiles = hubProfiles(hubNames)
  const results = new Map()
  let usedModel = ""
  for (let i = 0; i < notes.length; i += BATCH) {
    const batch = notes.slice(i, i + BATCH)
    const { text, model } = await generate(key, buildPrompt(profiles, batch))
    usedModel = model
    for (const [name, entry] of parseResult(text, hubNames, batch)) results.set(name, entry)
    console.log(`  · ${Math.min(i + BATCH, notes.length)}/${notes.length} (${model})`)
  }

  if (SAMPLE) {
    for (const n of notes) {
      const got = results.get(n.name)
      console.log(`- ${n.title.slice(0, 40)}\n    기존: ${n.expected.join(", ")}\n    제미나이: ${got ? `${got.hubs.join(", ") || "-"} (${got.confidence})` : "응답 없음"}`)
    }
    return
  }

  let added = 0
  for (const [name, entry] of results) {
    if (doc.notes[name]) continue // never overwrite an existing (possibly hand-edited) entry
    doc.notes[name] = { ...entry, by: "gemini" }
    added++
  }
  doc.lastAutoClassified = new Date().toISOString()
  fs.writeFileSync(assignFile, JSON.stringify(doc, null, 2) + "\n")
  const missing = notes.length - results.size
  console.log(`✔ 제미나이 분류 ${added}개 저장 (${usedModel})${missing ? ` · 응답 없음 ${missing}개는 다음 실행에서 다시 시도` : ""}`)
}

main().catch((err) => {
  console.error(`✖ 자동 분류 실패: ${String(err).slice(0, 300)}`)
  process.exit(1)
})
