#!/usr/bin/env node
// "함께 읽을 노트" by meaning: embed every published note with Gemini and write,
// for each note, the notes closest in meaning to content/related.json.
//
// - Runs after sync-garden (content/ is rebuilt on every sync).
// - Embeddings are cached in .garden/embeddings.json by text hash, so only new
//   or changed notes are sent to Gemini on later runs.
// - If Gemini is unreachable, notes with a cached embedding still get a list;
//   the site falls back to link-based picks for the rest.
//
// Usage: node scripts/embed-garden.mjs

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import matter from "gray-matter"
import { apiKey } from "./gemini.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const CONTENT = path.join(ROOT, "content")
const CACHE = path.join(ROOT, ".garden", "embeddings.json")
const OUT = path.join(CONTENT, "related.json")
const MODEL = "gemini-embedding-001"
const DIMS = 768
const BATCH = 20
const KEEP = 12 // the site drops notes already linked and shows 5

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : e.name.endsWith(".md") ? [p] : []
  })
}

// Plain text of a note: title plus body without markup, links reduced to their words.
function plainText(file) {
  const { data, content } = matter(fs.readFileSync(file, "utf8"))
  const body = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, (_, t) => t.replace(/^[A-Z]\s*-\s+/, ""))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#>*_`|~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const title = String(data.title ?? path.basename(file, ".md"))
  return `${title}\n${body}`.slice(0, 2000)
}

async function embedBatch(key, texts) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${MODEL}`,
          content: { parts: [{ text }] },
          taskType: "SEMANTIC_SIMILARITY",
          outputDimensionality: DIMS,
        })),
      }),
      signal: AbortSignal.timeout(120_000),
    },
  )
  const body = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  return JSON.parse(body).embeddings.map((e) => e.values)
}

const norm = (v) => {
  const n = Math.hypot(...v) || 1
  return v.map((x) => x / n)
}
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)

async function main() {
  if (!fs.existsSync(CONTENT)) {
    console.log("! content/가 없습니다. 먼저 동기화하세요.")
    return
  }
  // Notes only: hubs (top level) and folder pages are not suggested.
  const files = walk(CONTENT).filter((f) => {
    const rel = path.relative(CONTENT, f)
    return rel.includes(path.sep) && path.basename(f) !== "index.md"
  })
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {}
  const notes = files.map((f) => {
    const rel = path.relative(CONTENT, f).split(path.sep).join("/")
    const text = plainText(f)
    return { rel, text, hash: crypto.createHash("sha1").update(text).digest("hex") }
  })

  const todo = notes.filter((n) => cache[n.rel]?.hash !== n.hash)
  if (todo.length) {
    const key = apiKey()
    if (!key) console.log("! GEMINI_API_KEY가 없어 새 노트의 임베딩은 건너뜁니다.")
    else {
      console.log(`  · 임베딩 계산 ${todo.length}개 (${MODEL})`)
      try {
        for (let i = 0; i < todo.length; i += BATCH) {
          const batch = todo.slice(i, i + BATCH)
          // The free tier allows about 100 texts a minute: on 429, wait and retry.
          let vecs
          for (let attempt = 0; ; attempt++) {
            try {
              vecs = await embedBatch(key, batch.map((n) => n.text))
              break
            } catch (err) {
              if (!/HTTP 429/.test(String(err)) || attempt >= 8) throw err
              console.log("  … 분당 한도에 걸려 65초 기다립니다")
              await new Promise((r) => setTimeout(r, 65_000))
            }
          }
          batch.forEach((n, j) => (cache[n.rel] = { hash: n.hash, vec: norm(vecs[j]).map((x) => +x.toFixed(5)) }))
        }
      } catch (err) {
        console.log(`  ! 임베딩 실패: ${String(err).slice(0, 160)} (저장된 값으로 진행)`)
      }
    }
  }
  // Drop cache entries for notes no longer published.
  const live = new Set(notes.map((n) => n.rel))
  for (const k of Object.keys(cache)) if (!live.has(k)) delete cache[k]
  fs.mkdirSync(path.dirname(CACHE), { recursive: true })
  fs.writeFileSync(CACHE, JSON.stringify(cache))

  const ready = notes.filter((n) => cache[n.rel])
  const related = {}
  for (const n of ready) {
    const v = cache[n.rel].vec
    related[n.rel] = ready
      .filter((m) => m !== n)
      .map((m) => [m.rel, dot(v, cache[m.rel].vec)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, KEEP)
      .map(([rel, s]) => [rel, +s.toFixed(3)])
  }
  fs.writeFileSync(OUT, JSON.stringify(related))
  console.log(`✔ 함께 읽을 노트 목록: 노트 ${ready.length}개 (content/related.json)`)
}

main().catch((err) => {
  console.error(`✖ 임베딩 실패: ${String(err).slice(0, 300)}`)
  process.exit(1)
})
