// Garden search (see GardenSearch.tsx).
// NOTE: Quartz's inline loader strips the first occurrence of the e-x-p-o-r-t
// keyword from this file, so that word must not appear anywhere in it.

type Entry = { title?: string; content?: string; filePath?: string }

let panel: HTMLDivElement | undefined
let input: HTMLInputElement
let gsStatus: HTMLParagraphElement
let list: HTMLUListElement
let docs: { slug: string; title: string; kind: string; lowTitle: string; text: string; lowText: string }[] | undefined
let active = 0
let timer = 0

const KIND: Record<string, string> = {
  "1. 문헌 메모": "문헌 메모",
  "1. 영구노트": "문헌 메모",
  "2. 의견": "의견",
  "2-1. 개요": "개요",
  "3. Projects": "프로젝트",
  "4. Books": "책",
  "5. 임상 및 상담심리": "임상·상담 메모",
  "1.4. CS": "CS·통계 메모",
  posts: "글",
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

async function loadDocs() {
  if (docs) return docs
  // fetchData is the page's top-level const (renderPage.tsx), not a window property.
  const index = ((await fetchData) ?? {}) as Record<string, Entry>
  docs = Object.entries(index)
    .filter(([slug]) => slug !== "404" && !slug.startsWith("tags/") && !slug.endsWith("/index"))
    .map(([slug, e]) => {
      const title = e.title ?? slug
      const text = (e.content ?? "").replace(/\s+/g, " ").trim()
      const top = (e.filePath ?? "").split("/")[0]
      const kind = slug === "index" ? "첫 화면" : !slug.includes("/") ? "주제" : (KIND[top] ?? "")
      return { slug, title, kind, lowTitle: title.toLowerCase(), text, lowText: text.toLowerCase() }
    })
  return docs
}

function count(hay: string, word: string) {
  let n = 0
  for (let i = hay.indexOf(word); i >= 0 && n < 50; i = hay.indexOf(word, i + word.length)) n++
  return n
}

function highlight(text: string, words: string[]) {
  let html = esc(text)
  for (const w of [...words].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
    html = html.replace(re, (m) => `<mark>${m}</mark>`)
  }
  return html
}

function snippet(text: string, low: string, words: string[]) {
  const at = Math.min(...words.map((w) => low.indexOf(w)).filter((i) => i >= 0))
  if (!Number.isFinite(at)) return text.slice(0, 110)
  const start = Math.max(0, at - 40)
  return (start > 0 ? "…" : "") + text.slice(start, start + 140) + (start + 140 < text.length ? "…" : "")
}

const href = (slug: string) => {
  const base = (document.body.dataset.slug ?? "").split("/").length - 1
  return (base > 0 ? "../".repeat(base) : "./") + (slug === "index" ? "" : slug)
}

async function run() {
  const q = input.value.trim().toLowerCase()
  list.replaceChildren()
  active = 0
  if (!q) {
    gsStatus.textContent = "제목과 본문에서 검색어가 들어 있는 노트를 모두 찾습니다."
    return
  }
  const words = q.split(/\s+/).filter(Boolean)
  const all = await loadDocs()
  const hits = all
    .filter((d) => words.every((w) => d.lowTitle.includes(w) || d.lowText.includes(w)))
    .map((d) => {
      const inTitle = words.filter((w) => d.lowTitle.includes(w)).length
      const times = words.reduce((n, w) => n + count(d.lowText, w), 0)
      return { d, score: inTitle * 1000 + (d.kind === "주제" || d.kind === "첫 화면" ? 0 : 100) + times }
    })
    .sort((a, b) => b.score - a.score || a.d.title.localeCompare(b.d.title, "ko"))
  gsStatus.textContent = hits.length ? `${hits.length}개 노트` : "검색어가 들어 있는 노트가 없습니다."
  for (const [i, { d }] of hits.entries()) {
    const li = document.createElement("li")
    const a = document.createElement("a")
    a.className = "gsearch__hit"
    a.href = href(d.slug)
    a.dataset.noPopover = "true"
    a.innerHTML =
      `<span class="gsearch__title">${highlight(d.title, words)}</span>` +
      (d.kind ? `<span class="gsearch__kind">${esc(d.kind)}</span>` : "") +
      `<span class="gsearch__snip">${highlight(snippet(d.text, d.lowText, words), words)}</span>`
    a.addEventListener("click", () => close())
    a.addEventListener("mousemove", () => select(i))
    li.append(a)
    list.append(li)
  }
  select(0)
}

function select(i: number) {
  const hits = [...list.querySelectorAll<HTMLAnchorElement>(".gsearch__hit")]
  if (!hits.length) return
  active = (i + hits.length) % hits.length
  hits.forEach((h, j) => h.classList.toggle("is-active", j === active))
}

function build() {
  panel = document.createElement("div")
  panel.className = "gsearch"
  panel.hidden = true
  panel.innerHTML = `
    <div class="gsearch__box" role="dialog" aria-label="검색">
      <div class="gsearch__bar">
        <input class="gsearch__input" type="search" placeholder="검색어를 입력하세요" aria-label="검색어" autocomplete="off" />
        <button class="gsearch__close" type="button" aria-label="닫기">닫기</button>
      </div>
      <p class="gsearch__status"></p>
      <ul class="gsearch__list"></ul>
    </div>`
  document.body.append(panel)
  input = panel.querySelector(".gsearch__input")!
  gsStatus = panel.querySelector(".gsearch__status")!
  list = panel.querySelector(".gsearch__list")!
  panel.addEventListener("click", (e) => {
    if (e.target === panel) close()
  })
  panel.querySelector(".gsearch__close")!.addEventListener("click", () => close())
  input.addEventListener("input", () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void run(), 120)
  })
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      select(active + (e.key === "ArrowDown" ? 1 : -1))
      list.querySelector(".is-active")?.scrollIntoView({ block: "nearest" })
    } else if (e.key === "Enter") {
      const a = list.querySelector<HTMLAnchorElement>(".is-active")
      if (a) {
        e.preventDefault()
        a.click()
      }
    } else if (e.key === "Escape") close()
  })
}

function open() {
  // SPA navigation replaces <body>, taking the panel with it: build it again.
  if (!panel || !panel.isConnected) build()
  panel!.hidden = false
  document.documentElement.classList.add("gsearch-lock")
  input.select()
  input.focus()
  void run()
}

function close() {
  document.documentElement.classList.remove("gsearch-lock")
  if (!panel) return
  panel.hidden = true
  document.documentElement.classList.remove("gsearch-lock")
}

const gsWin = window as unknown as { __gardenSearchReady?: boolean }
if (!gsWin.__gardenSearchReady) {
  gsWin.__gardenSearchReady = true
  // Take over the plugin's button and shortcut before its own listeners run.
  document.addEventListener(
    "click",
    (e) => {
      const btn = (e.target as Element | null)?.closest?.(".search-button")
      if (!btn) return
      e.preventDefault()
      e.stopPropagation()
      open()
    },
    true,
  )
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (panel && !panel.hidden) close()
        else open()
      } else if (e.key === "Escape" && panel && !panel.hidden) close()
    },
    true,
  )
  document.addEventListener("nav", () => close())
}
