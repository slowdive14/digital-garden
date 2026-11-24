// Sharing a note on X: the "공유" button under the title, and a small
// "인용해 공유" button that appears when you select text in the note.
// NOTE: Quartz's inline loader strips the first occurrence of the e-x-p-o-r-t
// keyword from this file, so that word must not appear anywhere in it.

const TAG = "#잔향의마음로그"
const intent = (text: string, url: string) =>
  `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
const pageUrl = () => location.href.split("#")[0].split("?")[0]
const noteTitle = () =>
  document.querySelector("h1.article-title")?.textContent?.trim() ?? document.title

// twitter-text weighting: Latin and common punctuation count 1, the rest 2.
const charWeight = (c: number) =>
  c <= 4351 || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247) ? 1 : 2
const weight = (s: string) => [...s].reduce((n, ch) => n + charWeight(ch.codePointAt(0)!), 0)
function fit(s: string, max: number): string {
  if (weight(s) <= max) return s
  let out = ""
  let n = 0
  for (const ch of s) {
    const w = charWeight(ch.codePointAt(0)!)
    if (n + w > max - 1) break
    out += ch
    n += w
  }
  return out.trimEnd() + "…"
}

let bubble: HTMLAnchorElement | undefined

function hideBubble() {
  if (bubble) bubble.hidden = true
}

function onSelect() {
  const sel = window.getSelection()
  const text = sel?.toString().replace(/\s+/g, " ").trim() ?? ""
  const article = document.querySelector("article")
  if (!sel || sel.isCollapsed || text.length < 8 || !article || !sel.anchorNode || !article.contains(sel.anchorNode)) {
    hideBubble()
    return
  }
  if (!bubble) {
    bubble = document.createElement("a")
    bubble.className = "quote-share"
    bubble.target = "_blank"
    bubble.rel = "noopener"
    bubble.textContent = "인용해 X에 공유"
    bubble.addEventListener("mousedown", (e) => e.preventDefault())
    document.body.append(bubble)
  }
  // X allows 280 "weighted" characters: Korean and other CJK count 2, a link
  // counts 23. Shorten a long title first, then the quote, to fit.
  const title = fit(noteTitle(), 40)
  const fixed = weight(`“”\n— ${title}\n${TAG}`) + 1 + 23 + 4
  const quote = fit(text, 280 - fixed)
  bubble.href = intent(`“${quote}”\n— ${title}\n${TAG}`, pageUrl())
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  bubble.hidden = false
  const w = bubble.offsetWidth
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 8)
  const top = rect.top > 48 ? rect.top - 40 : rect.bottom + 8
  bubble.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
}

function setupShare() {
  for (const a of document.querySelectorAll<HTMLAnchorElement>("a[data-share-x]")) {
    a.href = intent(`${noteTitle()}\n${TAG}`, pageUrl())
  }
  hideBubble()
}

const w = window as unknown as { __noteShareReady?: boolean }
if (!w.__noteShareReady) {
  w.__noteShareReady = true
  document.addEventListener("nav", setupShare)
  document.addEventListener("selectionchange", () => window.setTimeout(onSelect, 0))
  window.addEventListener("scroll", hideBubble, { passive: true })
}
