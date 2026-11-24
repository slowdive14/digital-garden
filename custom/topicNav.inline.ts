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

const g = window as unknown as { __topicNavReady?: boolean }
if (!g.__topicNavReady) {
  g.__topicNavReady = true
  document.addEventListener("nav", setup)
  document.addEventListener("nav", setupReader)
  void refreshIfStale()
}
