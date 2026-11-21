// Client script for the garden map (see GardenMap.tsx).
// NOTE: Quartz's inline loader strips the first occurrence of the e-x-p-o-r-t
// keyword from this file, so that word must not appear anywhere in it.

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force"
import { select } from "d3-selection"
import { zoom as d3zoom, zoomIdentity, type ZoomTransform } from "d3-zoom"
import topicsConfig from "../garden.topics.json"

type IndexEntry = { title?: string; links?: string[] }
declare const fetchData: Promise<Record<string, IndexEntry>>

type Cat = "hub" | "permanent" | "opinion" | "clinical" | "other"

interface GNode extends SimulationNodeDatum {
  id: string
  title: string
  cat: Cat
  degree: number
  r: number
  depth: number
}

interface GLink {
  source: GNode
  target: GNode
}

interface Graph {
  nodes: Map<string, GNode>
  adj: Map<string, Set<string>>
}

// Legend order is fixed; colors come from CSS variables (see gardenMap.scss).
const CATS: { key: Cat; label: string; cssVar: string }[] = [
  { key: "hub", label: "주제 허브", cssVar: "--gm-hub" },
  { key: "permanent", label: "문헌 메모", cssVar: "--gm-permanent" },
  { key: "opinion", label: "의견·글", cssVar: "--gm-opinion" },
  { key: "clinical", label: "임상·상담 메모", cssVar: "--gm-clinical" },
  { key: "other", label: "책·프로젝트·기타", cssVar: "--gm-other" },
]

function category(slug: string): Cat {
  if (!slug.includes("/")) return "hub"
  const top = slug.split("/")[0]
  if (/영구|문헌/.test(top)) return "permanent"
  if (top === "posts" || /의견|개요/.test(top)) return "opinion"
  if (/임상|심리치료|평가|상담/.test(top)) return "clinical"
  return "other"
}

const skip = (slug: string) =>
  slug === "index" || slug === "404" || slug.endsWith("/index") || slug.startsWith("tags/")

let graphPromise: Promise<Graph> | undefined

function loadGraph(): Promise<Graph> {
  graphPromise ??= fetchData.then((index) => {
    const nodes = new Map<string, GNode>()
    for (const [slug, entry] of Object.entries(index)) {
      if (skip(slug)) continue
      nodes.set(slug, {
        id: slug,
        title: entry.title ?? slug,
        cat: category(slug),
        degree: 0,
        r: 0,
        depth: 0,
      })
    }
    const adj = new Map<string, Set<string>>()
    for (const id of nodes.keys()) adj.set(id, new Set())
    for (const [slug, entry] of Object.entries(index)) {
      if (!nodes.has(slug)) continue
      for (const target of entry.links ?? []) {
        if (target === slug || !nodes.has(target)) continue
        adj.get(slug)!.add(target)
        adj.get(target)!.add(slug)
      }
    }
    for (const [id, set] of adj) nodes.get(id)!.degree = set.size
    return { nodes, adj }
  })
  return graphPromise
}

// Relative path from the current page to the site root (Quartz uses relative links).
function rootPrefix(): string {
  const slug = document.body.dataset.slug ?? ""
  const depth = slug.split("/").length - 1
  return depth > 0 ? "../".repeat(depth) : "./"
}

function goTo(slug: string, hash = "") {
  const url = new URL(rootPrefix() + slug + hash, window.location.href)
  const nav = (window as unknown as { spaNavigate?: (u: URL) => void }).spaNavigate
  if (nav) nav(url)
  else window.location.assign(url)
}

function readColors(el: HTMLElement) {
  const css = getComputedStyle(el)
  const v = (name: string) => css.getPropertyValue(name).trim()
  const colors = Object.fromEntries(CATS.map((c) => [c.key, v(c.cssVar)])) as Record<Cat, string>
  return {
    cat: colors,
    edge: v("--gm-edge"),
    edgeStrong: v("--gm-edge-strong"),
    surface: v("--gm-surface"),
    ink: v("--gm-ink"),
    accent: v("--secondary"),
    font: v("--bodyFont") || "sans-serif",
  }
}

function buildSubgraph(graph: Graph, mode: "global" | "local", center: string) {
  let ids: string[]
  if (mode === "global") {
    ids = [...graph.nodes.values()].filter((n) => n.degree > 0).map((n) => n.id)
    for (const id of ids) graph.nodes.get(id)!.depth = 0
  } else {
    if (!graph.nodes.has(center)) return undefined
    // Two steps out, unless that floods the small panel.
    const bfs = (maxDepth: number) => {
      const seen = new Map<string, number>([[center, 0]])
      let frontier = [center]
      for (let d = 1; d <= maxDepth; d++) {
        const next: string[] = []
        for (const id of frontier) {
          for (const nb of graph.adj.get(id) ?? []) {
            if (!seen.has(nb)) {
              seen.set(nb, d)
              next.push(nb)
            }
          }
        }
        frontier = next
      }
      return seen
    }
    let seen = bfs(2)
    if (seen.size > 70) seen = bfs(1)
    ids = [...seen.keys()]
    // Copies so the global layout is not disturbed.
    const local = ids.map((id) => ({ ...graph.nodes.get(id)!, depth: seen.get(id)! }))
    return makeLayout(local, graph, mode, center)
  }
  const nodes = ids.map((id) => ({ ...graph.nodes.get(id)! }))
  return makeLayout(nodes, graph, mode, center)
}

function makeLayout(nodes: GNode[], graph: Graph, mode: "global" | "local", center: string) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const links: GLink[] = []
  for (const n of nodes) {
    for (const nb of graph.adj.get(n.id) ?? []) {
      if (n.id < nb && byId.has(nb)) links.push({ source: n, target: byId.get(nb)! })
    }
  }
  // Small dots: size hints at how connected a note is without covering its neighbours.
  for (const n of nodes) {
    const base = mode === "global" ? 2 : 2.6
    n.r = base + Math.sqrt(n.degree) * (mode === "global" ? 0.95 : 0.75)
    if (n.cat === "hub") n.r = Math.max(n.r, mode === "global" ? 5.5 : 4.5)
    if (mode === "local" && n.id === center) {
      n.r = Math.max(n.r, 5.5)
      n.fx = 0
      n.fy = 0
    }
  }
  const sim = forceSimulation<GNode>(nodes)
    .force(
      "link",
      forceLink<GNode, GLink>(links)
        // Leaves sit close to their hub; hub-to-hub links stay long.
        .distance((l) => (mode === "global" ? 16 + Math.min(l.source.r, l.target.r) * 3 : 50))
        .strength(mode === "global" ? 0.55 : 0.6),
    )
    .force(
      "charge",
      forceManyBody<GNode>()
        // Hubs push each other apart so each topic gets its own territory.
        .strength((d) => (mode === "global" ? -20 - d.degree * 7 : -150))
        .distanceMax(mode === "global" ? 320 : 400),
    )
    .force("collide", forceCollide<GNode>((d) => d.r + (mode === "global" ? 3.5 : 5)))
    .force("x", forceX<GNode>(0).strength(mode === "global" ? 0.07 : 0.08))
    .force("y", forceY<GNode>(0).strength(mode === "global" ? 0.09 : 0.08))
    .stop()
  // A static layout reads like a map and costs nothing after the first paint.
  for (let i = 0; i < 320; i++) sim.tick()
  return { nodes, links, center: byId.get(center) }
}

type Layout = NonNullable<ReturnType<typeof buildSubgraph>>

function mount(root: HTMLElement, layout: Layout, mode: "global" | "local") {
  // ---- DOM
  const frame = document.createElement("div")
  frame.className = "garden-map__frame"
  const canvas = document.createElement("canvas")
  canvas.className = "garden-map__canvas"
  canvas.setAttribute("role", "img")
  canvas.setAttribute(
    "aria-label",
    mode === "global"
      ? `정원 지도: 서로 연결된 노트 ${layout.nodes.length}개. 아래 범례와 주제 목록에서도 같은 노트를 찾을 수 있습니다.`
      : `이 노트와 연결된 노트 ${layout.nodes.length - 1}개를 보여 주는 지도`,
  )
  const tooltip = document.createElement("div")
  tooltip.className = "garden-map__tooltip"
  tooltip.hidden = true
  const tools = document.createElement("div")
  tools.className = "garden-map__tools"
  const resetBtn = document.createElement("button")
  resetBtn.type = "button"
  resetBtn.textContent = "전체 보기"
  tools.append(resetBtn)
  let expandBtn: HTMLButtonElement | undefined
  if (mode === "global") {
    expandBtn = document.createElement("button")
    expandBtn.type = "button"
    expandBtn.textContent = "크게 보기"
    tools.append(expandBtn)
  }
  frame.append(canvas, tooltip, tools)

  const legend = document.createElement("ul")
  legend.className = "garden-map__legend"
  const counts = new Map<Cat, number>()
  for (const n of layout.nodes) counts.set(n.cat, (counts.get(n.cat) ?? 0) + 1)
  const chips = new Map<Cat, HTMLButtonElement>()
  for (const c of CATS) {
    const count = counts.get(c.key) ?? 0
    if (!count) continue
    const li = document.createElement("li")
    const btn = document.createElement("button")
    btn.type = "button"
    btn.setAttribute("aria-pressed", "false")
    btn.innerHTML = `<span class="garden-map__swatch" style="background: var(${c.cssVar})"></span>${c.label} <span class="garden-map__count">${count}</span>`
    li.append(btn)
    legend.append(li)
    chips.set(c.key, btn)
  }

  // Topic buttons (home map): focus a hub and everything linked to it.
  const topicChips = new Map<string, HTMLButtonElement>()
  let topics: HTMLDivElement | undefined
  if (mode === "global") {
    topics = document.createElement("div")
    topics.className = "garden-map__topics"
    const label = document.createElement("span")
    label.className = "garden-map__topics-label"
    label.textContent = "주제로 보기"
    topics.append(label)
    // Same order as the topic menu (garden.topics.json), then the rest by size.
    const order = topicsConfig.groups.flatMap((g) => g.hubs)
    const rank = (n: GNode) => {
      const i = order.indexOf(n.title)
      return i === -1 ? order.length : i
    }
    const hubs = layout.nodes
      .filter((n) => n.cat === "hub")
      .sort((a, b) => rank(a) - rank(b) || b.degree - a.degree)
    for (const hub of hubs) {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.setAttribute("aria-pressed", "false")
      btn.textContent = hub.title
      topics.append(btn)
      topicChips.set(hub.id, btn)
    }
  }

  // Titles of the focused topic, next to the map: easier to read than labels on dots.
  const body = document.createElement("div")
  body.className = "garden-map__body"
  const list = document.createElement("aside")
  list.className = "garden-map__list"
  list.hidden = true
  body.append(frame, list)

  root.querySelector(".garden-map__topics")?.remove()
  root.querySelector(".garden-map__body")?.remove()
  root.querySelector(".garden-map__frame")?.remove()
  root.querySelector(".garden-map__legend")?.remove()
  root.querySelector(".garden-map__more")?.remove()
  if (topics) root.append(topics)
  root.append(body, legend)
  if (mode === "local") {
    const more = document.createElement("a")
    more.className = "garden-map__more"
    more.href = rootPrefix() + "#정원-지도"
    more.textContent = "정원 전체 지도 보기 →"
    root.append(more)
  }

  // ---- State
  const ctx = canvas.getContext("2d")!
  let colors = readColors(root)
  let width = 0
  let height = 0
  let transform: ZoomTransform = zoomIdentity
  let hovered: GNode | undefined
  let catFocus: Cat | undefined
  let topicFocus: GNode | undefined
  const neighbors = new Map<string, Set<string>>()
  for (const n of layout.nodes) neighbors.set(n.id, new Set())
  for (const l of layout.links) {
    neighbors.get(l.source.id)!.add(l.target.id)
    neighbors.get(l.target.id)!.add(l.source.id)
  }

  const focusSet = (): Set<string> | undefined => {
    if (hovered) return new Set([hovered.id, ...neighbors.get(hovered.id)!])
    if (topicFocus) return new Set([topicFocus.id, ...neighbors.get(topicFocus.id)!])
    if (catFocus) return new Set(layout.nodes.filter((n) => n.cat === catFocus).map((n) => n.id))
    return undefined
  }

  // ---- Topic list (home map): every title of the focused topic, readable at once.
  const listItems = new Map<string, HTMLAnchorElement>()

  function renderList() {
    listItems.clear()
    list.replaceChildren()
    if (!topicFocus) {
      list.hidden = true
      return
    }
    const hub = topicFocus
    const members = layout.nodes
      .filter((n) => n !== hub && neighbors.get(hub.id)!.has(n.id))
      .sort((a, b) => a.title.localeCompare(b.title, "ko"))
    const head = document.createElement("div")
    head.className = "garden-map__list-head"
    const hubLink = document.createElement("a")
    hubLink.href = rootPrefix() + hub.id
    hubLink.className = "internal"
    hubLink.dataset.noPopover = "true"
    hubLink.textContent = hub.title
    const count = document.createElement("span")
    count.textContent = `노트 ${members.length}개`
    head.append(hubLink, count)
    const ul = document.createElement("ul")
    for (const n of members) {
      const li = document.createElement("li")
      const a = document.createElement("a")
      a.href = rootPrefix() + n.id
      a.className = "internal"
      a.dataset.noPopover = "true"
      const dot = document.createElement("span")
      dot.className = "garden-map__swatch"
      dot.style.background = `var(${CATS.find((c) => c.key === n.cat)!.cssVar})`
      const t = document.createElement("span")
      t.textContent = n.title
      a.append(dot, t)
      a.addEventListener("mouseenter", () => {
        hovered = n
        draw()
        syncListHover()
      })
      a.addEventListener("mouseleave", () => {
        hovered = undefined
        draw()
        syncListHover()
      })
      li.append(a)
      ul.append(li)
      listItems.set(n.id, a)
    }
    list.append(head, ul)
    list.hidden = false
  }

  // Mirror the hovered dot in the list, scrolling only the list itself.
  function syncListHover() {
    for (const [id, a] of listItems) a.classList.toggle("is-hover", id === hovered?.id)
    const a = hovered ? listItems.get(hovered.id) : undefined
    if (!a || list.hidden) return
    const lr = list.getBoundingClientRect()
    const ar = a.getBoundingClientRect()
    if (ar.top < lr.top) list.scrollTop -= lr.top - ar.top + 8
    else if (ar.bottom > lr.bottom) list.scrollTop += ar.bottom - lr.bottom + 8
  }

  // Dots grow only slightly when zooming in, so zoom spreads them apart instead of
  // making them bigger. World-space radius for the current zoom:
  const radius = (n: GNode) => n.r / Math.pow(transform.k, 0.65)

  // ---- Drawing
  function draw() {
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const focus = focusSet()
    const k = transform.k

    ctx.save()
    ctx.translate(transform.x, transform.y)
    ctx.scale(k, k)

    // Edges: recessive, stronger only around the focus.
    ctx.lineWidth = 1 / k
    for (const l of layout.links) {
      const on = focus ? focus.has(l.source.id) && focus.has(l.target.id) : false
      if (focus && !on) {
        ctx.globalAlpha = 0.04
        ctx.strokeStyle = colors.edge
      } else {
        ctx.globalAlpha = on ? 0.9 : 0.55
        ctx.strokeStyle = on ? colors.edgeStrong : colors.edge
      }
      ctx.beginPath()
      ctx.moveTo(l.source.x!, l.source.y!)
      ctx.lineTo(l.target.x!, l.target.y!)
      ctx.stroke()
    }

    // Nodes: small first so hubs sit on top; a surface ring separates overlaps.
    const ordered = [...layout.nodes].sort((a, b) => a.r - b.r)
    for (const n of ordered) {
      const r = radius(n)
      ctx.globalAlpha = focus && !focus.has(n.id) ? 0.1 : 1
      ctx.beginPath()
      ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2)
      ctx.fillStyle = colors.cat[n.cat]
      ctx.fill()
      ctx.lineWidth = 1.5 / k
      ctx.strokeStyle = colors.surface
      ctx.stroke()
      if (n === layout.center || n === hovered) {
        ctx.beginPath()
        ctx.arc(n.x!, n.y!, r + 3 / k, 0, Math.PI * 2)
        ctx.lineWidth = 2 / k
        ctx.strokeStyle = colors.accent
        ctx.stroke()
      }
    }
    ctx.restore()
    ctx.globalAlpha = 1
    drawLabels(focus)
  }

  // Labels in screen space so they stay crisp. Few of them, each placed in the
  // first free spot around its dot (below, above, right, left) that covers no
  // other label and no visible dot; if none is free, the label is skipped and
  // the title is still one hover (or one list entry) away.
  type Box = [number, number, number, number]
  const overlaps = (a: Box, b: Box) =>
    a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]

  function drawLabels(focus: Set<string> | undefined) {
    const k = transform.k
    const wanted: { n: GNode; prio: number }[] = []
    for (const n of layout.nodes) {
      let prio = -1
      if (n === hovered) prio = 1000
      else if (n === layout.center || n === topicFocus) prio = 900
      else if (focus) {
        if (focus.has(n.id)) prio = 500 + n.degree
      } else if (n.cat === "hub") prio = 300 + n.degree
      else if (mode === "local" && n.depth === 1 && neighbors.get(layout.center!.id)!.size <= 6)
        prio = 250 + n.degree
      else if (mode === "global" && k > 2.6 && n.degree >= 2) prio = n.degree
      if (prio >= 0) wanted.push({ n, prio })
    }
    wanted.sort((a, b) => b.prio - a.prio)
    const cap = mode === "global" ? 14 : 7

    // Dots that are drawn at full strength act as obstacles for labels.
    const dots = layout.nodes
      .filter((n) => !focus || focus.has(n.id))
      .map((n) => {
        const r = radius(n) * k
        const x = transform.x + n.x! * k
        const y = transform.y + n.y! * k
        return { n, box: [x - r - 1, y - r - 1, 2 * r + 2, 2 * r + 2] as Box }
      })

    const placed: Box[] = []
    let shown = 0
    ctx.textBaseline = "middle"
    for (const { n, prio } of wanted) {
      if (shown >= cap && prio < 900) break
      const big = n.cat === "hub" || prio >= 900
      ctx.font = `${big ? 600 : 500} ${big ? 12.5 : 11.5}px ${colors.font}`
      const max = prio >= 1000 ? 40 : mode === "local" ? 12 : 16
      const text = n.title.length > max ? n.title.slice(0, max - 1) + "…" : n.title
      const w = ctx.measureText(text).width + 10
      const h = 18
      const cx = transform.x + n.x! * k
      const cy = transform.y + n.y! * k
      const gap = radius(n) * k + 3
      const spots: Box[] = [
        [cx - w / 2, cy + gap, w, h],
        [cx - w / 2, cy - gap - h, w, h],
        [cx + gap, cy - h / 2, w, h],
        [cx - gap - w, cy - h / 2, w, h],
      ]
      const inside = (b: Box) => b[0] >= 2 && b[1] >= 2 && b[0] + b[2] <= width - 2 && b[1] + b[3] <= height - 2
      const free = (b: Box) =>
        inside(b) && !placed.some((p) => overlaps(p, b)) && !dots.some((d) => d.n !== n && overlaps(d.box, b))
      let box = spots.find(free)
      // Hovered and centre labels must show even when crowded.
      if (!box && prio >= 900) box = spots.find(inside) ?? spots[0]
      if (!box) continue
      placed.push(box)
      shown++

      ctx.globalAlpha = 0.88
      ctx.fillStyle = colors.surface
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(box[0], box[1], box[2], box[3], 5)
      else ctx.rect(box[0], box[1], box[2], box[3])
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.fillStyle = colors.ink
      ctx.textAlign = "left"
      ctx.fillText(text, box[0] + 5, box[1] + h / 2 + 0.5)
    }
  }

  // ---- Fit & resize
  function fit(only?: GNode[]) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    // Ignore the few farthest stragglers so the main body fills the frame.
    let fitNodes = only ?? layout.nodes
    if (!only && mode === "global" && layout.nodes.length > 40) {
      const cx = layout.nodes.reduce((s, n) => s + n.x!, 0) / layout.nodes.length
      const cy = layout.nodes.reduce((s, n) => s + n.y!, 0) / layout.nodes.length
      const byDist = [...layout.nodes].sort(
        (a, b) => Math.hypot(a.x! - cx, a.y! - cy) - Math.hypot(b.x! - cx, b.y! - cy),
      )
      fitNodes = byDist.slice(0, Math.ceil(byDist.length * 0.96))
    }
    for (const n of fitNodes) {
      minX = Math.min(minX, n.x! - n.r)
      minY = Math.min(minY, n.y! - n.r)
      maxX = Math.max(maxX, n.x! + n.r)
      maxY = Math.max(maxY, n.y! + n.r)
    }
    const pad = only ? 60 : mode === "global" ? 28 : 22
    const bw = Math.max(maxX - minX, 1)
    const bh = Math.max(maxY - minY, 1)
    const k = Math.min((width - pad * 2) / bw, (height - pad * 2 - 14) / bh, only ? 2.2 : 2.4)
    const tx = width / 2 - ((minX + maxX) / 2) * k
    const ty = (height - 14) / 2 - ((minY + maxY) / 2) * k
    return zoomIdentity.translate(tx, ty).scale(k)
  }

  const zoomBehavior = d3zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([0.25, 8])
    .on("zoom", (e) => {
      transform = e.transform
      draw()
    })
  const sel = select(canvas)
  sel.call(zoomBehavior)

  function resize() {
    const rect = frame.getBoundingClientRect()
    width = Math.max(rect.width, 10)
    height = Math.max(rect.height, 10)
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const members = topicFocus
      ? layout.nodes.filter((n) => n === topicFocus || neighbors.get(topicFocus!.id)!.has(n.id))
      : undefined
    sel.call(zoomBehavior.transform, fit(members))
  }

  // ---- Pointer
  function nodeAt(clientX: number, clientY: number): GNode | undefined {
    const rect = canvas.getBoundingClientRect()
    const [x, y] = transform.invert([clientX - rect.left, clientY - rect.top])
    let best: GNode | undefined
    let bestD = Infinity
    for (const n of layout.nodes) {
      const d = Math.hypot(n.x! - x, n.y! - y)
      const reach = radius(n) + 6 / transform.k
      if (d < reach && d < bestD) {
        best = n
        bestD = d
      }
    }
    return best
  }

  function showTooltip(n: GNode | undefined, clientX = 0, clientY = 0) {
    if (!n) {
      tooltip.hidden = true
      return
    }
    const label = CATS.find((c) => c.key === n.cat)!.label
    tooltip.innerHTML = ""
    const t = document.createElement("strong")
    t.textContent = n.title
    const meta = document.createElement("span")
    meta.textContent = `${label} · 연결 ${n.degree}개`
    tooltip.append(t, meta)
    tooltip.hidden = false
    const rect = frame.getBoundingClientRect()
    const x = Math.min(clientX - rect.left + 12, rect.width - tooltip.offsetWidth - 8)
    const y = Math.min(clientY - rect.top + 12, rect.height - tooltip.offsetHeight - 8)
    tooltip.style.transform = `translate(${Math.max(x, 8)}px, ${Math.max(y, 8)}px)`
  }

  let lastPointerType = "mouse"
  const onMove = (e: PointerEvent) => {
    lastPointerType = e.pointerType
    if (e.pointerType === "touch") return
    const n = nodeAt(e.clientX, e.clientY)
    canvas.style.cursor = n ? "pointer" : "grab"
    if (n !== hovered) {
      hovered = n
      draw()
      syncListHover()
    }
    showTooltip(n, e.clientX, e.clientY)
  }
  const onLeave = () => {
    hovered = undefined
    showTooltip(undefined)
    draw()
    syncListHover()
  }
  const onClick = (e: MouseEvent) => {
    const n = nodeAt(e.clientX, e.clientY)
    if (!n) {
      if (hovered) onLeave()
      return
    }
    // On touch, the first tap previews and the second opens.
    if (lastPointerType === "touch" && hovered !== n) {
      hovered = n
      draw()
      showTooltip(n, e.clientX, e.clientY)
      return
    }
    if (n === layout.center) return
    goTo(n.id)
  }
  canvas.addEventListener("pointermove", onMove)
  canvas.addEventListener("pointerdown", onMove)
  canvas.addEventListener("pointerleave", onLeave)
  canvas.addEventListener("click", onClick)

  const syncPressed = () => {
    for (const [c, b] of chips) b.setAttribute("aria-pressed", String(c === catFocus))
    for (const [id, b] of topicChips) b.setAttribute("aria-pressed", String(id === topicFocus?.id))
  }

  for (const [cat, btn] of chips) {
    btn.addEventListener("click", () => {
      catFocus = catFocus === cat ? undefined : cat
      topicFocus = undefined
      syncPressed()
      renderList()
      sel.call(zoomBehavior.transform, fit())
    })
  }

  for (const [id, btn] of topicChips) {
    btn.addEventListener("click", () => {
      const hub = layout.nodes.find((n) => n.id === id)!
      topicFocus = topicFocus === hub ? undefined : hub
      catFocus = undefined
      syncPressed()
      renderList()
      const members = topicFocus
        ? layout.nodes.filter((n) => n === hub || neighbors.get(hub.id)!.has(n.id))
        : undefined
      sel.call(zoomBehavior.transform, fit(members))
    })
  }

  const onReset = () => {
    topicFocus = undefined
    catFocus = undefined
    syncPressed()
    renderList()
    sel.call(zoomBehavior.transform, fit())
  }
  resetBtn.addEventListener("click", onReset)

  const onExpand = () => {
    const expanded = root.classList.toggle("garden-map--expanded")
    expandBtn!.textContent = expanded ? "닫기" : "크게 보기"
    document.documentElement.classList.toggle("garden-map-lock", expanded)
    resize()
  }
  expandBtn?.addEventListener("click", onExpand)
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && root.classList.contains("garden-map--expanded")) onExpand()
  }
  document.addEventListener("keydown", onKey)

  const onTheme = () => {
    colors = readColors(root)
    draw()
  }
  document.addEventListener("themechange", onTheme)

  const observer = new ResizeObserver(() => resize())
  observer.observe(frame)
  resize()

  window.addCleanup(() => {
    observer.disconnect()
    document.removeEventListener("themechange", onTheme)
    document.removeEventListener("keydown", onKey)
    document.documentElement.classList.remove("garden-map-lock")
    canvas.removeEventListener("pointermove", onMove)
    canvas.removeEventListener("pointerdown", onMove)
    canvas.removeEventListener("pointerleave", onLeave)
    canvas.removeEventListener("click", onClick)
    sel.on(".zoom", null)
  })
}

async function setupAll() {
  const roots = document.querySelectorAll<HTMLElement>(".garden-map")
  if (!roots.length) return
  const graph = await loadGraph()
  const slug = document.body.dataset.slug ?? ""
  for (const root of roots) {
    const mode = root.dataset.mode === "global" ? "global" : "local"
    const layout = buildSubgraph(graph, mode, slug)
    if (!layout || layout.nodes.length < 2) {
      // Nothing to map: hide the local panel rather than show an empty box.
      if (mode === "local") root.hidden = true
      continue
    }
    root.hidden = false
    mount(root, layout, mode)
  }
}

const w = window as unknown as { __gardenMapReady?: boolean }
if (!w.__gardenMapReady) {
  w.__gardenMapReady = true
  document.addEventListener("nav", () => {
    void setupAll()
  })
}
