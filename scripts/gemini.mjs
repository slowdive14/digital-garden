// Shared Gemini REST helper for the garden scripts (classify-garden, link-garden).
// Key: GEMINI_API_KEY from the environment, or from the .env file named in
// garden.local.json → gemini.envFile (kept out of git). Same model fallback as
// the newsletter scripts.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DEFAULT_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]

const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {})
const local = readJson(path.join(ROOT, "garden.local.json"))
const gemini = local.gemini ?? {}
export const models = gemini.models?.length ? gemini.models : DEFAULT_MODELS

export function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
  if (gemini.envFile && fs.existsSync(gemini.envFile)) {
    for (const line of fs.readFileSync(gemini.envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*"?([^"\s#]+)"?/)
      if (m) return m[1]
    }
  }
  return undefined
}

const TRANSIENT = /\b(429|500|502|503|504)\b|overloaded|unavailable|resource_exhausted|deadline/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Ask for JSON; returns { text, model }. Tries each model, retrying transient errors. */
export async function generate(key, prompt, { maxOutputTokens = 8192 } = {}) {
  let lastError
  for (const model of models) {
    let wait = 6000
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.2, responseMimeType: "application/json", maxOutputTokens },
            }),
            signal: AbortSignal.timeout(180_000),
          },
        )
        const body = await res.text()
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
        const data = JSON.parse(body)
        const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("")
        if (!text.trim()) throw new Error("빈 응답")
        return { text, model }
      } catch (err) {
        lastError = err
        if (TRANSIENT.test(String(err)) && attempt < 2) {
          console.log(`  … [${model}] 혼잡·한도 오류, ${wait / 1000}초 후 재시도`)
          await sleep(wait)
          wait *= 3
          continue
        }
        console.log(`  ✗ [${model}] ${String(err).slice(0, 160)}`)
        break
      }
    }
  }
  throw lastError ?? new Error("모든 모델 실패")
}

export const parseJson = (text) => JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""))
