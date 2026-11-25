// Open the topic menu on wide screens, keep it folded on phones.
// NOTE: Quartz's inline loader strips the first occurrence of the e-x-p-o-r-t
// keyword from this file, so that word must not appear anywhere in it.

const wide = window.matchMedia("(min-width: 801px)")

function setup() {
  for (const details of document.querySelectorAll<HTMLDetailsElement>(".topic-nav__toggle")) {
    details.open = wide.matches
    const closeOnPick = () => {
      if (!wide.matches) details.open = false
    }
    const links = details.querySelectorAll("a")
    for (const a of links) a.addEventListener("click", closeOnPick)
    const onChange = () => {
      details.open = wide.matches
    }
    // On phones, a tap anywhere outside the open list folds it again.
    const onOutside = (e: Event) => {
      if (!wide.matches && details.open && !details.contains(e.target as Node)) details.open = false
    }
    wide.addEventListener("change", onChange)
    document.addEventListener("click", onOutside)
    window.addCleanup(() => {
      for (const a of links) a.removeEventListener("click", closeOnPick)
      wide.removeEventListener("change", onChange)
      document.removeEventListener("click", onOutside)
    })
  }
}

// Reader mode (Quartz plugin) hides both sidebars behind a bare book icon. Say what
// it does on the button, and give a visible way back: on phones the header itself
// sits in the hidden sidebar, so the icon disappears along with it.
const READER_TIP = "집중 읽기: 양옆 메뉴를 숨기고 본문만 보여 줍니다"

function setupReader() {
  for (const btn of document.querySelectorAll<HTMLButtonElement>("button.readermode")) {
    btn.setAttribute("aria-label", READER_TIP)
    btn.dataset.tip = "집중 읽기"
    btn.querySelector("title")?.replaceChildren(READER_TIP)
  }
  if (document.querySelector(".reader-exit")) return
  const exit = document.createElement("button")
  exit.type = "button"
  exit.className = "reader-exit"
  exit.textContent = "집중 읽기 끄기 · 메뉴 다시 보기"
  exit.addEventListener("click", () => {
    document.querySelector<HTMLButtonElement>("button.readermode")?.click()
  })
  document.body.append(exit)
}

// GitHub Pages lets browsers reuse a page for 10 minutes, so right after a deploy
// the first page opened can be an old copy (a new note missing from lists and
// counts). Ask the server once whether it has a newer page; if so, swap it in
// through the SPA router, without a visible reload.
async function refreshIfStale() {
  try {
    const res = await fetch(location.href, { method: "HEAD", cache: "no-cache" })
    const server = Date.parse(res.headers.get("last-modified") ?? "")
    const mine = Date.parse(document.lastModified)
    const nav = (window as unknown as { spaNavigate?: (u: URL, isBack?: boolean) => void }).spaNavigate
    if (server && mine && server - mine > 1000 && nav) nav(new URL(location.href), true)
  } catch {
    // offline or blocked: keep the page as it is
  }
}

// Total visits in the footer, from GoatCounter's public counter
// (spacekatb.goatcounter.com; "allow visitor counts" is on in its settings).
// Ad and tracker blockers often block goatcounter.com; then fall back to the
// count saved on this site at the last publish (visits.json).
let visits: Promise<string | undefined> | undefined
const readCount = (url: string, init?: RequestInit) =>
  fetch(url, init)
    .then((r) => (r.ok ? r.json() : undefined))
    .then((j) => (j?.count ? String(j.count).replace(/\s/g, "") : undefined))
    .catch(() => undefined)
function showVisits() {
  const base = (window as unknown as { quartzStaticUrl?: string }).quartzStaticUrl ?? location.href
  visits ??= readCount("https://spacekatb.goatcounter.com/counter/TOTAL.json").then(
    (live) => live ?? readCount(new URL("../visits.json", base).href, { cache: "no-cache" }),
  )
  void visits.then((count) => {
    const footer = document.querySelector("footer")
    if (!count || !footer || footer.querySelector(".visit-count")) return
    const n = Number(count.replace(/,/g, ""))
    const p = document.createElement("p")
    p.className = "visit-count"
    p.textContent = `지금까지 방문 ${Number.isFinite(n) ? n.toLocaleString("ko-KR") : count}`
    footer.prepend(p)
  })
}

// Search: the search plugin indexes Korean one syllable at a time, so "베이지안"
// also matched notes that merely contain 베, 이, 지 and 안 somewhere. Keep only
// results whose title or text contains each Korean word of the query as typed.
const hangul = /[가-힯㄰-㆏]/
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ")
let filtering = false
async function filterResults(container: Element) {
  if (filtering) return
  const input = document.querySelector<HTMLInputElement>(".search-bar")
  const words = squash(input?.value ?? "")
    .split(" ")
    .filter((w) => hangul.test(w))
  const cards = [...container.querySelectorAll<HTMLElement>("a.result-card")]
  if (!words.length) {
    for (const c of cards) c.hidden = false
    return
  }
  filtering = true
  const index = await fetchData
  for (const card of cards) {
    const entry = index[decodeURIComponent(card.id)]
    const text = entry ? squash(`${entry.title ?? ""} ${entry.content ?? ""}`) : ""
    card.hidden = !!entry && !words.every((w) => text.includes(w))
  }
  // Keep keyboard focus and the preview on a result that is still shown.
  const focused = container.querySelector<HTMLElement>("a.result-card.focus")
  if (focused?.hidden) {
    focused.classList.remove("focus")
    cards.find((c) => !c.hidden)?.classList.add("focus")
  }
  filtering = false
}
// The results list is (re)built by the search plugin when the search opens, so
// attach to it when someone types rather than on page load.
function watchSearch(e: Event) {
  if (!(e.target instanceof HTMLInputElement) || !e.target.classList.contains("search-bar")) return
  const container = document.querySelector<HTMLElement>(".results-container")
  if (!container) return
  if (!container.dataset.koFilter) {
    container.dataset.koFilter = "on"
    new MutationObserver(() => void filterResults(container)).observe(container, { childList: true })
  }
  window.setTimeout(() => void filterResults(container), 0)
}

const g = window as unknown as { __topicNavReady?: boolean }
if (!g.__topicNavReady) {
  g.__topicNavReady = true
  document.addEventListener("nav", setup)
  document.addEventListener("nav", setupReader)
  document.addEventListener("nav", showVisits)
  document.addEventListener("input", watchSearch, true)
  void refreshIfStale()
}
