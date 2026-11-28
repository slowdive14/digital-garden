#!/usr/bin/env node
// One command to publish the garden: sync notes → privacy check → commit → push.
// GitHub Actions (.github/workflows/deploy.yml) builds and deploys after the push.
//
// Progress is shown in the window and appended to .garden/publish.log.
//
// Usage: npm run garden:publish
//        node scripts/publish-garden.mjs --hold   keep the window open at the end
//                                                 (used by the scheduled task)

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "garden.sync.json"), "utf8"))
const BRANCH = config.publishBranch ?? "main"
const HOLD = process.argv.includes("--hold")
// Only note-related paths are committed; code and config changes stay separate.
const PUBLISH_PATHS = ["content", "site", "import", "garden.sync.json", "garden.assignments.json"]
const SITE = "https://slowdive14.github.io/digital-garden/"

// D: is not NTFS, so git refuses the repo unless it is marked safe. Do that per
// process instead of touching the user's global git config.
const env = {
  ...process.env,
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "safe.directory",
  GIT_CONFIG_VALUE_0: ROOT.replaceAll("\\", "/"),
}

// ---------------------------------------------------------------------------
// Output: the window and .garden/publish.log get the same lines.

fs.mkdirSync(path.join(ROOT, ".garden"), { recursive: true })
const log = fs.createWriteStream(path.join(ROOT, ".garden", "publish.log"), { flags: "a" })
// Another run may hold the log open; then show progress in the window only.
log.on("error", () => {})
const started = Date.now()
const clock = () => new Date().toLocaleTimeString("ko-KR", { hour12: false, timeZone: "Asia/Seoul" })
function say(text = "") {
  process.stdout.write(text + "\n")
  log.write(text + "\n")
}

const STEPS = 6
let stepNo = 0
function step(title) {
  stepNo++
  say("")
  say(`[${stepNo}/${STEPS}] ${title}   (${clock()})`)
}

// Run a child process, passing its output through as it arrives.
function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env })
    const pass = (chunk) => {
      process.stdout.write(chunk)
      log.write(chunk)
    }
    child.stdout.on("data", pass)
    child.stderr.on("data", pass)
    child.on("error", (err) => {
      say(`  ! ${cmd} 실행 실패: ${err.message}`)
      resolve(1)
    })
    child.on("close", (code) => resolve(code ?? 1))
  })
}

// Quick commands whose output we only need to read.
function capture(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: ROOT, env, encoding: "utf8" })
  return { code: res.status, out: (res.stdout ?? "").trim() }
}

async function finish(code, message) {
  if (message) say(message)
  const secs = Math.round((Date.now() - started) / 1000)
  say("")
  say(`■ ${code === 0 ? "끝났습니다" : "멈췄습니다"}   (${clock()}, ${Math.floor(secs / 60)}분 ${secs % 60}초 걸림)`)
  say("=".repeat(60))
  await new Promise((r) => log.end(r))
  if (HOLD && process.stdout.isTTY) {
    process.stdout.write("\n이 창은 30초 뒤 자동으로 닫힙니다. (Enter를 누르면 바로 닫기)\n")
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 30_000)
      process.stdin.once("data", () => {
        clearTimeout(t)
        resolve()
      })
    })
  }
  process.exit(code)
}

// ---------------------------------------------------------------------------

process.title = "디지털 가든 배포"
say("=".repeat(60))
say(`디지털 가든 배포 시작   ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`)

const sync = async () => {
  if ((await run(process.execPath, [path.join("scripts", "sync-garden.mjs")])) !== 0) {
    await finish(1, "✖ 동기화 또는 개인정보 검사에서 멈췄습니다. 위 메시지를 확인하세요.")
  }
}

// 1. Fill the empty "연결" section of newly published vault notes with related
//    notes (Gemini). A failure never blocks publishing; it retries next run.
step("비어 있는 '연결' 채우기 (Gemini)")
if ((await run(process.execPath, [path.join("scripts", "link-garden.mjs")])) !== 0) {
  say("  ! 자동 연결에 실패했습니다. 다음 실행에서 다시 시도합니다.")
}

// 2. Sync + privacy check
step("볼트에서 노트 가져오기와 개인정보 검사")
await sync()

// 3. New notes that no hub covers yet: classify with Gemini, then sync again so
//    the hub pages pick them up. A failed classification never blocks publishing.
step("새 노트 주제 분류 (Gemini)")
const pendingFile = path.join(ROOT, ".garden", "unassigned.json")
const pending = fs.existsSync(pendingFile) ? (JSON.parse(fs.readFileSync(pendingFile, "utf8")).notes ?? []) : []
if (!pending.length) say("  · 분류할 새 노트가 없습니다.")
else {
  say(`  · 미분류 ${pending.length}개`)
  if ((await run(process.execPath, [path.join("scripts", "classify-garden.mjs")])) === 0) {
    say("  · 분류 결과를 반영해 다시 동기화합니다.")
    await sync()
  } else say("  ! 자동 분류에 실패했습니다. 다음 실행에서 다시 시도합니다.")
}

// 4. "함께 읽을 노트" by meaning (embeddings) and the footer's visit count.
step("함께 읽을 노트 계산 (Gemini 임베딩)과 방문 수")
if ((await run(process.execPath, [path.join("scripts", "embed-garden.mjs")])) !== 0) {
  say("  ! 임베딩 계산에 실패했습니다. 사이트는 링크 기준 추천으로 대신합니다.")
}
try {
  const res = await fetch("https://spacekatb.goatcounter.com/counter/TOTAL.json", {
    signal: AbortSignal.timeout(15_000),
  })
  if (res.ok) {
    const { count } = await res.json()
    fs.writeFileSync(path.join(ROOT, "content", "visits.json"), JSON.stringify({ count }) + "\n")
    say(`  · 지금까지 방문 ${count}`)
  }
} catch {
  say("  · 방문 수를 받지 못해 지난 값을 그대로 둡니다.")
}

// 5. Commit note changes only, to the garden's own repository.
step("바뀐 노트 커밋과 푸시")
const origin = capture("git", ["remote", "get-url", "origin"])
if (origin.code !== 0 || /jackyzha0\/quartz/i.test(origin.out)) {
  await finish(2, "■ 가든을 올릴 GitHub 저장소가 연결되지 않아 배포는 하지 않았습니다.")
}
const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]).out
if (branch !== BRANCH) await finish(1, `✖ 현재 브랜치가 '${branch}'입니다. '${BRANCH}' 브랜치에서 실행하세요.`)

capture("git", ["add", "-A", "--", ...PUBLISH_PATHS])
const staged = capture("git", ["diff", "--cached", "--name-only", "-z", "--", ...PUBLISH_PATHS])
const files = staged.out.split("\0").filter(Boolean)
if (!files.length) await finish(0, "✔ 바뀐 노트가 없어서 배포할 것이 없습니다.")
say(`  · 바뀐 파일 ${files.length}개`)
for (const f of files.filter((f) => f.endsWith(".md")).slice(0, 8)) say(`    - ${f}`)
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16)
if ((await run("git", ["commit", "-q", "-m", `garden: 노트 동기화 ${stamp} (${files.length}개 파일)`])) !== 0) {
  await finish(1, "✖ 커밋하지 못했습니다.")
}
// Prefer the GitHub CLI login when available: Git Credential Manager can stall
// waiting for a sign-in window that never comes to the front.
const ghReady = spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status === 0
const pushArgs = ghReady
  ? ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", "push", "origin", BRANCH]
  : ["push", "origin", BRANCH]
if ((await run("git", pushArgs)) !== 0) await finish(1, "✖ 푸시하지 못했습니다. 네트워크나 GitHub 로그인 상태를 확인하세요.")
say("  ✔ 푸시했습니다.")

// 6. Watch GitHub Actions build and publish the site.
step("사이트 배포 (GitHub Actions)")
if (!ghReady) await finish(0, "  · GitHub CLI가 없어 배포 결과는 확인하지 않습니다. 1~2분 뒤 사이트에 반영됩니다.")
const sha = capture("git", ["rev-parse", "HEAD"]).out
let runId = ""
for (let i = 0; i < 12 && !runId; i++) {
  await new Promise((r) => setTimeout(r, 5000))
  const q = capture("gh", ["run", "list", "--commit", sha, "-L", "1", "--json", "databaseId", "-q", ".[0].databaseId"])
  runId = q.out
}
if (!runId) await finish(0, "  · 배포 작업을 찾지 못했습니다. 몇 분 뒤 사이트를 확인하세요.")
say("  · 사이트를 다시 만드는 중입니다. 보통 1~2분 걸립니다.")
const watched = spawnSync("gh", ["run", "watch", runId, "--exit-status", "--interval", "10"], {
  cwd: ROOT,
  env,
  stdio: "ignore",
  timeout: 10 * 60 * 1000,
})
if (watched.status === 0) await finish(0, `  ✔ 사이트에 반영됐습니다: ${SITE}`)
await finish(1, `  ✖ 사이트 배포가 실패했거나 오래 걸립니다. 확인: https://github.com/slowdive14/digital-garden/actions/runs/${runId}`)
