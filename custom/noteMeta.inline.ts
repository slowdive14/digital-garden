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
  // X counts a link as 23 characters; keep the post within 280.
  const room = 280 - 23 - noteTitle().length - TAG.length - 10
  const quote = text.length > room ? text.slice(0, room - 1) + "…" : text
  bubble.href = intent(`“${quote}”\n— ${noteTitle()}\n${TAG}`, pageUrl())
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
