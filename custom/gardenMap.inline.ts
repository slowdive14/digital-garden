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

type IndexEntry = { title?: string; links?: string[]; content?: string; filePath?: string }
declare const fetchData: Promise<Record<string, IndexEntry>>

type Cat = "hub" | "permanent" | "opinion" | "clinical" | "other"

interface GNode extends SimulationNodeDatum {
  id: string
  title: string
  cat: Cat
  degree: number
  r: number
  depth: number
  excerpt: string
}

interface GLink {
  source: GNode
  target: GNode
}

interface Graph {
  nodes: Map<string, GNode>
  adj: Map<string, Set<string>>
  // Direction kept for "이 노트가 링크" / "이 노트를 링크".
  out: Map<string, Set<string>>
  // content-relative file path → slug, to read related.json
  byPath: Map<string, string>
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
let graphAt = 0

// The first page's fetchData is reused for the whole visit (SPA navigation keeps
// it). Fetch the index again once it is a couple of minutes old, so notes
// published during a long visit show up in the maps without a reload.
function freshIndex(): Promise<Record<string, IndexEntry>> {
  if (!graphAt) return fetchData
  const base = (window as unknown as { quartzStaticUrl?: string }).quartzStaticUrl ?? location.href
  return fetch(new URL("contentIndex.json", base), { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : fetchData))
    .catch(() => fetchData)
}

function loadGraph(): Promise<Graph> {
  if (graphPromise && Date.now() - graphAt > 2 * 60 * 1000) graphPromise = undefined
  if (graphPromise) return graphPromise
  const index = freshIndex()
  graphAt = Date.now()
  graphPromise = index.then((index) => {
    const nodes = new Map<string, GNode>()
    const byPath = new Map<string, string>()
    for (const [slug, entry] of Object.entries(index)) {
      if (skip(slug)) continue
      if (entry.filePath) byPath.set(entry.filePath, slug)
      nodes.set(slug, {
        id: slug,
        title: entry.title ?? slug,
        cat: category(slug),
        degree: 0,
        r: 0,
        depth: 0,
        excerpt: makeExcerpt(entry.content ?? ""),
      })
    }
    const adj = new Map<string, Set<string>>()
    const out = new Map<string, Set<string>>()
    for (const id of nodes.keys()) {
      adj.set(id, new Set())
      out.set(id, new Set())
    }
    for (const [slug, entry] of Object.entries(index)) {
      if (!nodes.has(slug)) continue
      for (const target of entry.links ?? []) {
        if (target === slug || !nodes.has(target)) continue
        adj.get(slug)!.add(target)
        adj.get(target)!.add(slug)
        out.get(slug)!.add(target)
      }
    }
    for (const [id, set] of adj) nodes.get(id)!.degree = set.size
    return { nodes, adj, out, byPath }
  })
  return graphPromise
}

// First lines of the note for the preview card, skipping short section headings
// ("생각", "발췌", "References") that open many notes.
function makeExcerpt(text: string): string {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 14)
  const joined = lines.join(" ").replace(/\s+/g, " ").trim()
  // Long enough to fill the preview slot beside a note; the floating card clamps it.
  return joined.length > 320 ? joined.slice(0, 319).trimEnd() + "…" : joined
}

const THREE_D_SRC = "https://cdn.jsdelivr.net/npm/3d-force-graph@1.80.1/dist/3d-force-graph.min.js"
let threeLib: Promise<unknown> | undefined

// The 3D library is large, so it loads only when someone asks for the 3D view.
function loadThree(): Promise<unknown> {
  threeLib ??= new Promise((resolve, reject) => {
    const g = window as unknown as { ForceGraph3D?: unknown }
    if (g.ForceGraph3D) return resolve(g.ForceGraph3D)
    const el = document.createElement("script")
    el.src = THREE_D_SRC
    el.async = true
    el.onload = () => resolve(g.ForceGraph3D)
    el.onerror = () => {
      threeLib = undefined
      reject(new Error("3D 그래프를 불러오지 못했습니다"))
    }
    document.head.append(el)
  })
  return threeLib
}

// Relative path from the current page to the site root (Quartz uses relative links).
function rootPrefix(): string {
  const slug = document.body.dataset.slug ?? ""
  const depth = slug.split("/").length - 1
  return depth > 0 ? "../".repeat(depth) : "./"
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
  let threeBtn: HTMLButtonElement | undefined
  if (mode === "global") {
    threeBtn = document.createElement("button")
    threeBtn.type = "button"
    threeBtn.textContent = "3D로 보기"
    expandBtn = document.createElement("button")
    expandBtn.type = "button"
    expandBtn.textContent = "크게 보기"
    tools.append(threeBtn, expandBtn)
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
  // Set when arriving from a note's "전체 지도에서 이 노트 보기": keep that note framed.
  let arrival: GNode[] | undefined
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
      if (cardNode && !tooltip.hidden && !threeView) placeCard(...dotOnScreen(cardNode))
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
      : arrival
    sel.call(zoomBehavior.transform, fit(members))
  }

  // ---- Pointer
  // `slop` is extra reach in screen pixels; fingers need more than a mouse.
  function nodeAt(clientX: number, clientY: number, slop = 6): GNode | undefined {
    const rect = canvas.getBoundingClientRect()
    const [x, y] = transform.invert([clientX - rect.left, clientY - rect.top])
    let best: GNode | undefined
    let bestD = Infinity
    for (const n of layout.nodes) {
      const d = Math.hypot(n.x! - x, n.y! - y)
      const reach = radius(n) + slop / transform.k
      if (d < reach && d < bestD) {
        best = n
        bestD = d
      }
    }
    return best
  }

  // ---- Preview card: title, opening lines and a link to read on.
  let cardNode: GNode | undefined
  let pinned: GNode | undefined
  let hideTimer = 0
  tooltip.classList.add("garden-map__card")

  function showCard(n: GNode, x: number, y: number) {
    window.clearTimeout(hideTimer)
    cardNode = n
    const cat = CATS.find((c) => c.key === n.cat)!
    tooltip.replaceChildren()
    const chip = document.createElement("p")
    chip.className = "garden-map__card-chip"
    const sw = document.createElement("span")
    sw.className = "garden-map__swatch"
    sw.style.background = `var(${cat.cssVar})`
    chip.append(sw, `${cat.label} · 연결 ${n.degree}개`)
    const title = document.createElement("p")
    title.className = "garden-map__card-title"
    title.textContent = n.title
    tooltip.append(chip, title)
    if (n.excerpt && n.cat !== "hub") {
      const ex = document.createElement("p")
      ex.className = "garden-map__card-excerpt"
      ex.textContent = n.excerpt
      tooltip.append(ex)
    }
    if (n === layout.center) {
      const here = document.createElement("p")
      here.className = "garden-map__card-hint"
      here.textContent = "지금 보고 있는 노트"
      tooltip.append(here)
    } else {
      const a = document.createElement("a")
      a.className = "internal garden-map__card-link"
      a.href = rootPrefix() + n.id
      a.dataset.noPopover = "true"
      a.textContent = n.cat === "hub" ? "주제 페이지 열기 →" : "노트 읽기 →"
      tooltip.append(a)
    }
    tooltip.hidden = false
    placeCard(x, y)
  }

  // The card docks in one corner of the map, the one that covers the fewest of
  // the note and its linked notes (with their titles), so it never hides them.
  // x, y: the note's own position inside the frame.
  let screenOf: ((n: GNode) => [number, number]) | undefined
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]))
  let corner = -1
  let cornerFor: GNode | undefined
  function placeCard(x: number, y: number) {
    const fw = frame.clientWidth
    const fh = frame.clientHeight
    const cw = tooltip.offsetWidth
    const ch = tooltip.offsetHeight
    const m = 10
    const toolsH = tools.offsetHeight + 16
    const spots: [number, number][] = [
      [fw - cw - m, fh - ch - m], // bottom right
      [m, fh - ch - m], // bottom left
      [fw - cw - m, toolsH], // top right, under the buttons
      [m, m], // top left
    ]
    const at = screenOf ?? dotOnScreen
    const pts: { x: number; y: number; w: number }[] = [{ x, y, w: 5 }]
    if (cardNode) {
      for (const id of neighbors.get(cardNode.id) ?? []) {
        const n = nodeById.get(id)
        if (!n) continue
        const [px, py] = at(n)
        pts.push({ x: px, y: py, w: 1 })
      }
    }
    // A dot plus the title drawn under it.
    const cost = ([l, t]: [number, number]) =>
      pts.reduce((sum, p) => {
        const hit = p.x + 90 > l && p.x - 90 < l + cw && p.y + 26 > t && p.y - 8 < t + ch
        return sum + (hit ? p.w : 0)
      }, 0)
    const costs = spots.map(cost)
    // Keep the same corner while it still leaves the note itself uncovered.
    if (cornerFor !== cardNode || corner < 0 || costs[corner] >= 5) {
      corner = costs.indexOf(Math.min(...costs))
      cornerFor = cardNode
    }
    const [left, top] = spots[corner]
    tooltip.style.transform = `translate(${Math.max(m, left)}px, ${Math.max(m, top)}px)`
  }

  function hideCard(delay = 0) {
    window.clearTimeout(hideTimer)
    const run = () => {
      tooltip.hidden = true
      cardNode = undefined
      pinned = undefined
    }
    if (delay) hideTimer = window.setTimeout(run, delay)
    else run()
  }
  // Moving from the dot onto the card keeps it open, so its link can be clicked.
  tooltip.addEventListener("mouseenter", () => window.clearTimeout(hideTimer))
  tooltip.addEventListener("mouseleave", () => {
    if (!pinned) hideCard(250)
  })

  const dotOnScreen = (n: GNode): [number, number] => [
    transform.x + n.x! * transform.k,
    transform.y + n.y! * transform.k,
  ]

  let lastPointerType = "mouse"
  // A dot clicked closed stays closed while the pointer is still on it.
  let dismissed: GNode | undefined
  let focusTimer = 0
  let focusTarget: GNode | undefined
  let anim = 0

  // Smoothly move the view to `to`.
  function animateTo(to: ZoomTransform) {
    cancelAnimationFrame(anim)
    const from = transform
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min((now - start) / 450, 1)
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      const k = from.k + (to.k - from.k) * e
      const x = from.x + (to.x - from.x) * e
      const y = from.y + (to.y - from.y) * e
      sel.call(zoomBehavior.transform, zoomIdentity.translate(x, y).scale(k))
      if (t < 1) anim = requestAnimationFrame(step)
    }
    anim = requestAnimationFrame(step)
  }

  // Hold a note: keep its card and highlight, and bring every note linked to it
  // into view when some of them are off screen.
  function focusNode(n: GNode) {
    pinned = n
    hovered = n
    draw()
    syncListHover()
    if (cardNode !== n) showCard(n, ...dotOnScreen(n))
    const members = layout.nodes.filter((m) => m === n || neighbors.get(n.id)!.has(m.id))
    const pad = 24
    const offScreen = members.some((m) => {
      const [x, y] = dotOnScreen(m)
      return x < pad || y < pad || x > width - pad || y > height - pad
    })
    if (offScreen) animateTo(fit(members))
  }
  const cancelFocus = () => {
    window.clearTimeout(focusTimer)
    focusTarget = undefined
  }
  // Resting on a dot for a moment holds it (a quick pass over dots does not).
  const scheduleFocus = (n: GNode) => {
    if (focusTarget === n || pinned === n) return
    cancelFocus()
    focusTarget = n
    focusTimer = window.setTimeout(() => {
      focusTarget = undefined
      if (hovered === n) focusNode(n)
    }, 350)
  }
  const release = () => {
    cancelFocus()
    hideCard()
    pinned = undefined
    hovered = undefined
    draw()
    syncListHover()
  }

  const onMove = (e: PointerEvent) => {
    lastPointerType = e.pointerType
    if (e.pointerType === "touch") return
    let n = nodeAt(e.clientX, e.clientY)
    canvas.style.cursor = n ? "pointer" : "grab"
    if (n !== dismissed) dismissed = undefined
    else n = undefined
    const want = n ?? pinned
    if (want !== hovered) {
      hovered = want
      draw()
      syncListHover()
    }
    if (n) {
      if (n !== cardNode) showCard(n, ...dotOnScreen(n))
      else window.clearTimeout(hideTimer)
      scheduleFocus(n)
    } else {
      cancelFocus()
      if (pinned) {
        if (cardNode !== pinned) showCard(pinned, ...dotOnScreen(pinned))
      } else if (cardNode) hideCard(250)
    }
  }
  const onLeave = (e?: PointerEvent) => {
    if (e?.pointerType === "touch") return
    cancelFocus()
    hovered = pinned
    if (!pinned) hideCard(250)
    draw()
    syncListHover()
  }
  const onClick = (e: MouseEvent) => {
    const touch = lastPointerType !== "mouse"
    const n = nodeAt(e.clientX, e.clientY, touch ? 18 : 6)
    if (!n) {
      release()
      return
    }
    // Clicking (or tapping) the dot whose card is open closes it again; the note
    // itself opens from the card's "노트 읽기" link.
    if (cardNode === n && !tooltip.hidden) {
      release()
      dismissed = touch ? undefined : n
      return
    }
    cancelFocus()
    focusNode(n)
  }
  canvas.addEventListener("pointerdown", () => cancelAnimationFrame(anim))
  canvas.addEventListener("pointermove", onMove)
  canvas.addEventListener("pointerdown", onMove)
  canvas.addEventListener("pointerleave", onLeave)
  canvas.addEventListener("click", onClick)

  const syncPressed = () => {
    for (const [c, b] of chips) b.setAttribute("aria-pressed", String(c === catFocus))
    for (const [id, b] of topicChips) b.setAttribute("aria-pressed", String(id === topicFocus?.id))
    arrival = undefined
    threeView?.refresh()
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
    if (!expanded && threeView) leaveThree()
    expandBtn!.textContent = expanded ? "닫기" : "크게 보기"
    document.documentElement.classList.toggle("garden-map-lock", expanded)
    resize()
  }
  expandBtn?.addEventListener("click", onExpand)
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && root.classList.contains("garden-map--expanded")) onExpand()
  }
  document.addEventListener("keydown", onKey)

  // ---- 3D view (home map, "3D로 보기"): drag to turn, wheel or pinch to zoom.
  type T3 = { id: string; node: GNode; x?: number; y?: number; z?: number }
  type FG = {
    width(n: number): FG
    height(n: number): FG
    backgroundColor(c: string): FG
    graphData(d: unknown): FG
    nodeVal(f: (n: T3) => number): FG
    nodeRelSize(n: number): FG
    nodeOpacity(n: number): FG
    nodeResolution(n: number): FG
    nodeColor(f: (n: T3) => string): FG
    nodeLabel(f: () => string): FG
    linkColor(f: (l: { source: T3; target: T3 }) => string): FG
    linkVisibility(f: (l: { source: T3; target: T3 }) => boolean): FG
    linkOpacity(n: number): FG
    showNavInfo(b: boolean): FG
    warmupTicks(n: number): FG
    cooldownTicks(n: number): FG
    onNodeHover(f: (n: T3 | null) => void): FG
    onNodeClick(f: (n: T3) => void): FG
    onBackgroundClick(f: () => void): FG
    onEngineStop(f: () => void): FG
    cameraPosition(): { x: number; y: number; z: number }
    cameraPosition(p: object, look?: object, ms?: number): FG
    graph2ScreenCoords(x: number, y: number, z: number): { x: number; y: number }
    zoomToFit(ms?: number, pad?: number): FG
    _destructor(): void
  }
  type FGFactory = (opts?: object) => (el: HTMLElement) => FG
  let threeView: { refresh(): void; destroy(): void } | undefined

  async function enterThree() {
    if (!root.classList.contains("garden-map--expanded")) onExpand()
    threeBtn!.disabled = true
    threeBtn!.textContent = "불러오는 중…"
    let make: FGFactory
    try {
      make = (await loadThree()) as FGFactory
    } catch {
      threeBtn!.disabled = false
      threeBtn!.textContent = "3D를 불러오지 못함"
      return
    }
    hideCard()
    hovered = undefined
    const box = document.createElement("div")
    box.className = "garden-map__three"
    const labels = document.createElement("div")
    labels.className = "garden-map__three-labels"
    frame.prepend(box, labels)
    canvas.hidden = true
    root.classList.add("garden-map--3d")

    const nodes: T3[] = layout.nodes.map((n) => ({ id: n.id, node: n }))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const links = layout.links.map((l) => ({ source: l.source.id, target: l.target.id }))
    const inFocus = (n: T3) => {
      const f = focusSet()
      return !f || f.has(n.id)
    }
    let pointer: [number, number] = [0, 0]
    // Touch screens have no hover. Their last touch point stays behind as a
    // "hover", so a node under the button that opened 3D got held by itself.
    // There, only a tap holds a node.
    let pointerKind = window.matchMedia("(hover: hover)").matches ? "mouse" : "touch"
    const onPointer = (e: PointerEvent) => {
      pointerKind = e.pointerType
      const r = frame.getBoundingClientRect()
      pointer = [e.clientX - r.left, e.clientY - r.top]
    }
    box.addEventListener("pointermove", onPointer)
    box.addEventListener("pointerdown", onPointer)

    // With a note held (or a topic chosen), everything else shrinks to faint
    // specks and unrelated links disappear, so the held note's links stand out.
    const recolor = () =>
      g.nodeColor(nodeColor).nodeVal(nodeVal).linkColor(linkColor).linkVisibility(linkVisible)
    const nodeVal = (n: T3) => (inFocus(n) ? n.node.r ** 2 : Math.max(n.node.r ** 2 * 0.12, 0.6))
    const linkVisible = (l: { source: T3; target: T3 }) => {
      const f = focusSet()
      return !f || (f.has(l.source.id) && f.has(l.target.id))
    }
    const nodeColor = (n: T3) => (inFocus(n) ? colors.cat[n.node.cat] : colors.edge)
    const linkColor = (l: { source: T3; target: T3 }) =>
      inFocus(l.source) && inFocus(l.target) ? colors.edgeStrong : colors.edge
    // Fly the camera to a node, keeping the same direction from the centre.
    const flyTo = (n: T3, dist: number) => {
      const len = Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 1) || 1
      const k = 1 + dist / len
      g.cameraPosition({ x: (n.x ?? 0) * k, y: (n.y ?? 0) * k, z: (n.z ?? 1) * k }, n, 700)
    }

    let dwell3 = 0
    let cardTimer = 0
    // Hold a note: keep its card and colours, and when some of its linked notes are
    // off screen (or `always`), move the camera back along the current view
    // direction until the note and all its links fit.
    function hold3(n: T3, always: boolean) {
      hideCard()
      pinned = n.node
      hovered = n.node
      recolor()
      const members = [n, ...[...neighbors.get(n.id)!].map((id) => byId.get(id)!).filter(Boolean)]
      const fw = frame.clientWidth
      const fh = frame.clientHeight
      const pad = 24
      const offScreen = members.some((m) => {
        const s = g.graph2ScreenCoords(m.x ?? 0, m.y ?? 0, m.z ?? 0)
        return s.x < pad || s.y < pad || s.x > fw - pad || s.y > fh - pad
      })
      const place = () => {
        if (pinned !== n.node) return
        const s = g.graph2ScreenCoords(n.x ?? 0, n.y ?? 0, n.z ?? 0)
        showCard(n.node, s.x, s.y)
      }
      if (!offScreen && !always) {
        place()
        return
      }
      const c = { x: 0, y: 0, z: 0 }
      for (const m of members) {
        c.x += (m.x ?? 0) / members.length
        c.y += (m.y ?? 0) / members.length
        c.z += (m.z ?? 0) / members.length
      }
      let radius = 10
      for (const m of members) {
        radius = Math.max(radius, Math.hypot((m.x ?? 0) - c.x, (m.y ?? 0) - c.y, (m.z ?? 0) - c.z) + 4)
      }
      const cam = g.cameraPosition()
      let dir = { x: cam.x - c.x, y: cam.y - c.y, z: cam.z - c.z }
      const len = Math.hypot(dir.x, dir.y, dir.z)
      dir = len > 1e-6 ? { x: dir.x / len, y: dir.y / len, z: dir.z / len } : { x: 0, y: 0, z: 1 }
      // The library's camera has a 40° vertical field of view; a narrow frame has
      // an even narrower horizontal one.
      const vfov = (40 * Math.PI) / 180
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (fw / fh))
      const dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 1.1
      g.cameraPosition({ x: c.x + dir.x * dist, y: c.y + dir.y * dist, z: c.z + dir.z * dist }, c, 700)
      window.clearTimeout(cardTimer)
      cardTimer = window.setTimeout(place, 720)
    }

    const g = make({ controlType: "orbit" })(box)
      .width(frame.clientWidth)
      .height(frame.clientHeight)
      .backgroundColor(colors.surface)
      .showNavInfo(false)
      .nodeLabel(() => "")
      .nodeRelSize(1.6)
      .nodeResolution(12)
      .nodeVal(nodeVal)
      .linkVisibility(linkVisible)
      .nodeOpacity(0.95)
      .nodeColor(nodeColor)
      .linkColor(linkColor)
      .linkOpacity(0.4)
      .warmupTicks(80)
      .cooldownTicks(120)
      .graphData({ nodes, links })
      .onNodeHover((n) => {
        box.style.cursor = n ? "pointer" : "grab"
        window.clearTimeout(dwell3)
        if (pointerKind !== "mouse") return
        if (n) {
          hovered = n.node
          if (cardNode !== n.node) showCard(n.node, ...pointer)
          else window.clearTimeout(hideTimer)
          // Resting on a node for a moment holds it, as on the 2D map.
          dwell3 = window.setTimeout(() => {
            if (hovered === n.node && pinned !== n.node) hold3(n, false)
          }, 350)
        } else {
          hovered = pinned
          if (pinned) {
            const p = byId.get(pinned.id)!
            const s = g.graph2ScreenCoords(p.x ?? 0, p.y ?? 0, p.z ?? 0)
            if (cardNode !== pinned) showCard(pinned, s.x, s.y)
          } else hideCard(250)
        }
        recolor()
      })
      .onNodeClick((n) => {
        window.clearTimeout(dwell3)
        // Clicking the held note again lets it go.
        if (pinned === n.node) {
          hideCard()
          hovered = undefined
          recolor()
          return
        }
        hold3(n, true)
      })
      .onBackgroundClick(() => {
        hovered = undefined
        hideCard()
        recolor()
      })
    let fitted = false
    g.onEngineStop(() => {
      if (fitted) return
      fitted = true
      g.zoomToFit(400, 30)
    })

    // Titles float beside their dots. Hundreds would bury each other, so each frame
    // places them by priority into free spots only: the hovered or clicked note, the
    // focused topic, hubs, then notes nearest the camera. Zooming in on an area
    // therefore brings out the titles there.
    const tags = new Map<string, HTMLSpanElement>()
    for (const n of nodes) {
      const t = document.createElement("span")
      const max = n.node.cat === "hub" ? 30 : 18
      t.textContent = n.node.title.length > max ? n.node.title.slice(0, max - 1) + "…" : n.node.title
      if (n.node.cat === "hub") t.classList.add("is-hub")
      t.hidden = true
      labels.append(t)
      tags.set(n.id, t)
    }
    // Width estimate without measuring the DOM every frame (Korean ≈ 1em per glyph).
    const estWidth = (t: HTMLSpanElement) => {
      const len = t.textContent!.length
      return t.classList.contains("is-hub") ? len * 12 + 12 : len * 11 + 10
    }
    const widths = new Map([...tags].map(([id, t]) => [id, estWidth(t)]))
    type Box = [number, number, number, number]
    const hit = (a: Box, b: Box) =>
      a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
    let raf = 0
    let frameNo = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      // Every other frame is plenty for labels and halves the work.
      if (frameNo++ % 2) return
      const fw = frame.clientWidth
      const fh = frame.clientHeight
      const cam = g.cameraPosition()
      const focus = focusSet()
      const cands: { n: T3; x: number; y: number; prio: number }[] = []
      for (const n of nodes) {
        const p = g.graph2ScreenCoords(n.x ?? 0, n.y ?? 0, n.z ?? 0)
        if (p.x < 0 || p.y < 0 || p.x > fw || p.y > fh) continue
        const dist = Math.hypot((n.x ?? 0) - cam.x, (n.y ?? 0) - cam.y, (n.z ?? 0) - cam.z)
        let prio = 1000 / (1 + dist) // nearer first
        if (focus && !focus.has(n.id)) continue
        if (n.node === hovered || n.node === pinned) prio += 3000
        else if (n.node === topicFocus) prio += 2000
        else if (n.node.cat === "hub") prio += 1000
        cands.push({ n, x: p.x, y: p.y, prio })
      }
      cands.sort((a, b) => b.prio - a.prio)
      const placed: Box[] = []
      const shown = new Set<string>()
      const cap = fw < 600 ? 28 : 60
      for (const c of cands) {
        if (shown.size >= cap && c.prio < 2000) break
        const w = widths.get(c.n.id)!
        const box: Box = [c.x - w / 2, c.y + 6, w, 18]
        if (c.prio < 3000 && placed.some((b) => hit(b, box))) continue
        placed.push(box)
        shown.add(c.n.id)
        const t = tags.get(c.n.id)!
        t.style.transform = `translate(${Math.round(box[0])}px, ${Math.round(box[1])}px)`
      }
      for (const [id, t] of tags) t.hidden = !shown.has(id)
    }
    raf = requestAnimationFrame(tick)
    const ro = new ResizeObserver(() => g.width(frame.clientWidth).height(frame.clientHeight))
    ro.observe(frame)

    screenOf = (n: GNode) => {
      const t = byId.get(n.id)!
      const p = g.graph2ScreenCoords(t.x ?? 0, t.y ?? 0, t.z ?? 0)
      return [p.x, p.y]
    }
    threeView = {
      refresh() {
        g.backgroundColor(colors.surface)
        recolor()
        const hub = topicFocus && byId.get(topicFocus.id)
        if (hub) flyTo(hub, 170)
      },
      destroy() {
        window.clearTimeout(dwell3)
        window.clearTimeout(cardTimer)
        cancelAnimationFrame(raf)
        ro.disconnect()
        box.removeEventListener("pointermove", onPointer)
        box.removeEventListener("pointerdown", onPointer)
        g._destructor()
        box.remove()
        labels.remove()
      },
    }
    threeBtn!.disabled = false
    threeBtn!.textContent = "2D로 보기"
    resetBtn.hidden = true
  }

  function leaveThree() {
    screenOf = undefined
    threeView?.destroy()
    threeView = undefined
    canvas.hidden = false
    root.classList.remove("garden-map--3d")
    hideCard()
    hovered = undefined
    threeBtn!.textContent = "3D로 보기"
    resetBtn.hidden = false
    resize()
  }

  threeBtn?.addEventListener("click", () => {
    if (threeView) leaveThree()
    else void enterThree()
  })

  const onTheme = () => {
    colors = readColors(root)
    draw()
    threeView?.refresh()
  }
  document.addEventListener("themechange", onTheme)

  const observer = new ResizeObserver(() => resize())
  observer.observe(frame)
  resize()

  const wanted = mode === "global" ? new URLSearchParams(location.search).get("map") : null
  const target = wanted ? layout.nodes.find((n) => n.id === wanted) : undefined
  if (target) {
    arrival = layout.nodes.filter((n) => n === target || neighbors.get(target.id)!.has(n.id))
    sel.call(zoomBehavior.transform, fit(arrival))
    focusNode(target)
  }

  window.addCleanup(() => {
    threeView?.destroy()
    threeView = undefined
    window.clearTimeout(hideTimer)
    window.clearTimeout(focusTimer)
    cancelAnimationFrame(anim)
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

// ---------------------------------------------------------------------------
// Beside a note: its direct connections with every title visible, a preview slot
// that never covers them, and notes worth reading next.

type Related = Record<string, [string, number][]>
let relatedPromise: Promise<Related | undefined> | undefined
let relatedAt = 0

// Notes closest in meaning to each note (scripts/embed-garden.mjs, Gemini
// embeddings), refreshed like the index during a long visit.
function loadRelated(): Promise<Related | undefined> {
  if (relatedPromise && Date.now() - relatedAt < 2 * 60 * 1000) return relatedPromise
  relatedAt = Date.now()
  const base = (window as unknown as { quartzStaticUrl?: string }).quartzStaticUrl ?? location.href
  relatedPromise = fetch(new URL("../related.json", base), { cache: "no-cache" })
    .then((r) => (r.ok ? (r.json() as Promise<Related>) : undefined))
    .catch(() => undefined)
  return relatedPromise
}

function mountLocal(root: HTMLElement, graph: Graph, center: string, semantic?: Related): boolean {
  const me = graph.nodes.get(center)
  const nbIds = [...(graph.adj.get(center) ?? [])]
  if (!me || !nbIds.length) return false
  const out = graph.out.get(center) ?? new Set<string>()
  const relation = (n: GNode) => {
    if (n.cat === "hub") return "주제"
    if (!graph.adj.get(center)!.has(n.id)) return "함께 읽을 노트"
    const to = out.has(n.id)
    const from = graph.out.get(n.id)?.has(center) ?? false
    return to && from ? "서로 링크" : to ? "이 노트가 링크" : "이 노트를 링크"
  }
  // Short marks keep the row for the title; the full words are in the tooltip,
  // the legend under the list and the preview.
  const MARK: Record<string, string> = {
    주제: "주제",
    "서로 링크": "↔",
    "이 노트가 링크": "→",
    "이 노트를 링크": "←",
  }
  const isHub = (n: GNode) => (n.cat === "hub" ? 0 : 1)
  const nbs = nbIds
    .map((id) => graph.nodes.get(id)!)
    .sort((a, b) => isHub(a) - isHub(b) || b.degree - a.degree || a.title.localeCompare(b.title, "ko"))
  const MAX = 10
  const shown = nbs.slice(0, MAX)

  // Notes to read next: not linked yet, but sharing connections with this note.
  // A shared note counts double a shared topic, since topics are broad.
  const near = new Set([center, ...nbIds])
  const score = new Map<string, number>()
  for (const nb of nbIds) {
    const weight = graph.nodes.get(nb)!.cat === "hub" ? 1 : 2
    for (const id of graph.adj.get(nb) ?? []) {
      if (near.has(id) || graph.nodes.get(id)!.cat === "hub") continue
      score.set(id, (score.get(id) ?? 0) + weight)
    }
  }
  // Preferred: notes closest in meaning (embeddings). Links only as a fallback
  // for notes without an embedding (topic hubs, a note published minutes ago).
  const myPath = [...graph.byPath].find(([, slug]) => slug === center)?.[0]
  const byMeaning = myPath && semantic?.[myPath]
  const related = byMeaning
    ? byMeaning
        .map(([p]) => graph.byPath.get(p))
        .filter((id): id is string => !!id && !near.has(id) && graph.nodes.has(id))
        .slice(0, 5)
        .map((id) => graph.nodes.get(id)!)
    : [...score]
        .map(([id, s]) => ({ n: graph.nodes.get(id)!, s }))
        .sort((a, b) => b.s - a.s || b.n.degree - a.n.degree)
        .slice(0, 5)
        .map((r) => r.n)

  for (const sel of [".garden-ego", ".garden-map__preview", ".garden-map__related", ".garden-map__more"]) {
    root.querySelector(sel)?.remove()
  }
  const colorOf = (n: GNode) => `var(${CATS.find((c) => c.key === n.cat)!.cssVar})`
  const href = (n: GNode) => rootPrefix() + n.id

  // ---- Connection map: this note on the left, a curve to each connection.
  const ego = document.createElement("div")
  ego.className = "garden-ego"
  const svgNS = "http://www.w3.org/2000/svg"
  const svg = document.createElementNS(svgNS, "svg")
  svg.classList.add("garden-ego__lines")
  svg.setAttribute("aria-hidden", "true")
  const list = document.createElement("ul")
  list.className = "garden-ego__list"
  // Rows with a curve (direct connections) and every row (for the active mark).
  const lineRows = new Map<GNode, HTMLLIElement>()
  const allRows = new Map<GNode, HTMLLIElement>()

  const makeRow = (n: GNode, note?: string) => {
    const li = document.createElement("li")
    const dot = document.createElement("span")
    dot.className = "garden-ego__dot"
    dot.style.background = colorOf(n)
    if (n.cat === "hub") dot.classList.add("is-hub")
    const a = document.createElement("a")
    a.className = "internal garden-ego__link"
    a.href = href(n)
    a.dataset.noPopover = "true"
    a.title = n.title
    a.textContent = n.title
    li.append(dot, a)
    if (note) {
      const tag = document.createElement("span")
      tag.className = "garden-ego__rel"
      tag.textContent = MARK[note] ?? note
      tag.title = note
      li.append(tag)
    }
    return { li, a }
  }

  // ---- Preview slot under the map: fills on hover (first tap on phones).
  const preview = document.createElement("div")
  preview.className = "garden-map__preview"
  const hint = () => {
    preview.replaceChildren()
    const p = document.createElement("p")
    p.className = "garden-map__preview-hint"
    // Touch screens have no hover: tap once to preview, again to open.
    p.textContent = window.matchMedia("(hover: hover)").matches
      ? "제목에 마우스를 올리면 미리보기가 나오고, 누르면 그 노트로 갑니다."
      : "제목을 한 번 누르면 미리보기가 나오고, 한 번 더 누르면 그 노트로 갑니다."
    preview.append(p)
  }
  hint()
  let previewed: GNode | undefined
  const showPreview = (n: GNode) => {
    previewed = n
    const cat = CATS.find((c) => c.key === n.cat)!
    preview.replaceChildren()
    const chip = document.createElement("p")
    chip.className = "garden-map__card-chip"
    const sw = document.createElement("span")
    sw.className = "garden-map__swatch"
    sw.style.background = `var(${cat.cssVar})`
    chip.append(sw, `${cat.label} · ${relation(n)}`)
    const title = document.createElement("p")
    title.className = "garden-map__card-title"
    title.textContent = n.title
    preview.append(chip, title)
    if (n.excerpt && n.cat !== "hub") {
      const ex = document.createElement("p")
      ex.className = "garden-map__card-excerpt"
      ex.textContent = n.excerpt
      preview.append(ex)
    }
    const a = document.createElement("a")
    a.className = "internal garden-map__card-link"
    a.href = href(n)
    a.dataset.noPopover = "true"
    a.textContent = n.cat === "hub" ? "주제 페이지 열기 →" : "노트 읽기 →"
    preview.append(a)
    for (const [m, li] of allRows) li.classList.toggle("is-active", m === n)
    paintLines()
  }

  let lastPointer = "mouse"
  const wire = (n: GNode, a: HTMLAnchorElement) => {
    a.addEventListener("pointerdown", (e) => (lastPointer = e.pointerType))
    // A tap also fires mouseenter and focus just before its click. Treating those
    // as a hover would mark the note previewed, and the click would then open it.
    a.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") showPreview(n)
    })
    a.addEventListener("focus", () => {
      if (lastPointer === "mouse") showPreview(n)
    })
    // Phones: the first tap previews, a second tap on the same title opens it.
    a.addEventListener("click", (e) => {
      if (lastPointer !== "mouse" && previewed !== n) {
        e.preventDefault()
        e.stopPropagation()
        showPreview(n)
      }
    })
  }

  for (const n of shown) {
    const { li, a } = makeRow(n, relation(n))
    lineRows.set(n, li)
    allRows.set(n, li)
    wire(n, a)
    list.append(li)
  }
  if (nbs.length > shown.length) {
    const li = document.createElement("li")
    li.className = "garden-ego__extra"
    li.textContent = `외 ${nbs.length - shown.length}개는 전체 지도에서 볼 수 있습니다`
    list.append(li)
  }
  ego.append(svg, list)
  const marks = new Set<string>(shown.filter((n) => n.cat !== "hub").map((n) => relation(n)))
  if (marks.size) {
    const key = document.createElement("p")
    key.className = "garden-ego__key"
    key.textContent = ["이 노트가 링크", "이 노트를 링크", "서로 링크"]
      .filter((r) => marks.has(r))
      .map((r) => `${MARK[r]} ${r}`)
      .join(" · ")
    ego.append(key)
  }

  // Curves from this note (left middle) to each row's dot.
  function paintLines() {
    const h = list.offsetHeight
    svg.setAttribute("width", "44")
    svg.setAttribute("height", String(h))
    svg.replaceChildren()
    const cy = h / 2
    const me = document.createElementNS(svgNS, "circle")
    me.setAttribute("cx", "8")
    me.setAttribute("cy", String(cy))
    me.setAttribute("r", "5.5")
    me.classList.add("garden-ego__me")
    for (const [n, li] of lineRows) {
      const ry = li.offsetTop + li.offsetHeight / 2
      const path = document.createElementNS(svgNS, "path")
      path.setAttribute("d", `M8 ${cy} C 26 ${cy}, 22 ${ry}, 42 ${ry}`)
      if (n === previewed) path.classList.add("is-active")
      svg.append(path)
    }
    svg.append(me)
  }

  // ---- Notes to read next
  let relatedBox: HTMLElement | undefined
  if (related.length) {
    relatedBox = document.createElement("section")
    relatedBox.className = "garden-map__related"
    const h = document.createElement("h4")
    h.textContent = "함께 읽을 노트"
    const cap = document.createElement("p")
    cap.className = "garden-map__related-cap"
    cap.textContent = byMeaning
      ? "아직 링크되지 않았지만, 내용이 이 노트와 가까운 노트입니다."
      : "아직 링크되지 않았지만, 이 노트와 같은 주제·노트에 함께 연결된 노트입니다."
    const ul = document.createElement("ul")
    ul.className = "garden-ego__list garden-ego__list--plain"
    for (const n of related) {
      const { li, a } = makeRow(n)
      allRows.set(n, li)
      wire(n, a)
      ul.append(li)
    }
    relatedBox.append(h, cap, ul)
  }
  const more = document.createElement("a")
  more.className = "garden-map__more"
  more.href = `${rootPrefix()}?map=${encodeURIComponent(center)}#정원-지도`
  more.textContent = "정원 전체 지도에서 이 노트 보기 →"

  root.append(ego, preview)
  if (relatedBox) root.append(relatedBox)
  root.append(more)
  requestAnimationFrame(paintLines)
  return true
}

async function setupAll() {
  const roots = document.querySelectorAll<HTMLElement>(".garden-map")
  if (!roots.length) return
  const [graph, semantic] = await Promise.all([loadGraph(), loadRelated()])
  const slug = document.body.dataset.slug ?? ""
  for (const root of roots) {
    const mode = root.dataset.mode === "global" ? "global" : "local"
    if (mode === "local") {
      // Nothing linked: hide the panel rather than show an empty box.
      root.hidden = !mountLocal(root, graph, slug, semantic)
      continue
    }
    const layout = buildSubgraph(graph, mode, slug)
    if (!layout || layout.nodes.length < 2) continue
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
