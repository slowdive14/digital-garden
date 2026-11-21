#!/usr/bin/env node
// One command to publish the garden: sync notes → privacy check → commit → push.
// GitHub Actions (.github/workflows/deploy.yml) builds and deploys after the push.
//
// Usage: npm run garden:publish

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "garden.sync.json"), "utf8"))
const BRANCH = config.publishBranch ?? "main"
// Only note-related paths are committed; code and config changes stay separate.
const PUBLISH_PATHS = ["content", "site", "import", "garden.sync.json", "garden.assignments.json"]

// D: is not NTFS, so git refuses the repo unless it is marked safe. Do that per
// process instead of touching the user's global git config.
const env = {
  ...process.env,
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "safe.directory",
  GIT_CONFIG_VALUE_0: ROOT.replaceAll("\\", "/"),
}

function run(cmd, args, { capture = false } = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  })
  if (res.error) throw res.error
  return { code: res.status, out: (res.stdout ?? "").trim(), err: (res.stderr ?? "").trim() }
}

function stop(message, code = 1) {
  console.error(message)
  process.exit(code)
}

// 1. Sync + privacy check
const sync = () => {
  if (run(process.execPath, [path.join("scripts", "sync-garden.mjs")]).code !== 0) {
    stop("✖ 동기화 또는 개인정보 검사에서 멈췄습니다. 위 메시지를 확인하세요.")
  }
}
// 0. Fill the empty "연결" section of newly published vault notes with related
//    notes (Gemini). A failure never blocks publishing; it retries next run.
console.log("▶ 비어 있는 '연결' 채우기 (Gemini)")
if (run(process.execPath, [path.join("scripts", "link-garden.mjs")]).code !== 0) {
  console.log("  ! 자동 연결에 실패했습니다. 다음 실행에서 다시 시도합니다.")
}

console.log("▶ 노트 동기화")
sync()

// 1b. New notes that no hub covers yet: classify with Gemini, then sync again so
//     the hub pages pick them up. A failed classification never blocks publishing;
//     those notes simply wait for the next run.
const pendingFile = path.join(ROOT, ".garden", "unassigned.json")
const pending = fs.existsSync(pendingFile) ? JSON.parse(fs.readFileSync(pendingFile, "utf8")).notes ?? [] : []
if (pending.length) {
  console.log(`▶ 미분류 ${pending.length}개 자동 분류 (Gemini)`)
  if (run(process.execPath, [path.join("scripts", "classify-garden.mjs")]).code === 0) sync()
  else console.log("  ! 자동 분류에 실패했습니다. 다음 실행에서 다시 시도합니다.")
}

// 2. Make sure we push to the garden's own repository, never to Quartz upstream.
const origin = run("git", ["remote", "get-url", "origin"], { capture: true })
if (origin.code !== 0 || /jackyzha0\/quartz/i.test(origin.out)) {
  stop(
    [
      "",
      "■ 아직 가든을 올릴 GitHub 저장소가 연결되지 않아 배포는 하지 않았습니다.",
      "  content/는 갱신되었으니 `npx quartz build --serve`로 미리 볼 수 있습니다.",
      "  저장소를 만든 뒤 `git remote set-url origin <저장소 주소>`로 연결하세요.",
    ].join("\n"),
    2,
  )
}
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { capture: true }).out
if (branch !== BRANCH) {
  stop(`✖ 현재 브랜치가 '${branch}'입니다. '${BRANCH}' 브랜치에서 실행하세요.`)
}

// 3. Commit note changes only
run("git", ["add", "-A", "--", ...PUBLISH_PATHS])
const staged = run("git", ["diff", "--cached", "--name-only", "--", ...PUBLISH_PATHS], {
  capture: true,
})
const changed = staged.out ? staged.out.split("\n").length : 0
if (changed === 0) {
  console.log("✔ 바뀐 노트가 없어서 배포할 것이 없습니다.")
  process.exit(0)
}
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16)
if (run("git", ["commit", "-m", `garden: 노트 동기화 ${stamp} (${changed}개 파일)`]).code !== 0) {
  stop("✖ 커밋하지 못했습니다.")
}

// 4. Push; GitHub Actions takes it from here.
console.log(`▶ ${BRANCH} 브랜치로 푸시`)
// Prefer the GitHub CLI login when available: Git Credential Manager can stall
// waiting for a sign-in window that never comes to the front.
const ghReady = spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status === 0
const pushArgs = ghReady
  ? ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", "push", "origin", BRANCH]
  : ["push", "origin", BRANCH]
if (run("git", pushArgs).code !== 0) {
  stop("✖ 푸시하지 못했습니다. 네트워크나 GitHub 로그인 상태를 확인하세요.")
}
console.log("✔ 푸시했습니다. 몇 분 뒤 GitHub Actions가 사이트를 다시 배포합니다.")
