// Share card for X and other link previews (1200×630), drawn by the og-image
// plugin with satori. Same paper, ink and green as the site; site name on top,
// the note's title and opening line in the middle, note type, topics and date
// at the bottom. Replaces the plugin's default card (Quartz icon, "min read").

import fs from "node:fs"
import path from "node:path"
import type { SocialImageOptions } from "@quartz-community/og-image"

const C = {
  paper: "#fbfaf6",
  ink: "#1c1f1b",
  body: "#33362f",
  muted: "#6f726b",
  rule: "#e6e3da",
  green: "#2f6b5a",
  tint: "#e7efe9",
}

// Topic hubs a note belongs to: hub pages at the top of content/ that link to it.
let hubLinks: Map<string, string[]> | undefined
function topicsOf(file: string | undefined): string[] {
  if (!file) return []
  if (!hubLinks) {
    hubLinks = new Map()
    const dir = path.resolve("content")
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (!f.endsWith(".md") || f === "index.md") continue
      const text = fs.readFileSync(path.join(dir, f), "utf8")
      if (/^unlisted:\s*true/m.test(text)) continue
      const hub = f.slice(0, -3)
      for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) {
        const name = path.basename(m[1].trim())
        hubLinks.set(name, [...(hubLinks.get(name) ?? []), hub])
      }
    }
  }
  const name = path.basename(file).replace(/\.md$/, "")
  return [...new Set(hubLinks.get(name) ?? [])].slice(0, 2)
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s)

function fmtDate(d: unknown): string | undefined {
  const date = d instanceof Date ? d : d ? new Date(String(d)) : undefined
  if (!date || Number.isNaN(date.getTime())) return undefined
  const p = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${p(date.getMonth() + 1)}.${p(date.getDate())}`
}

export const gardenCard: SocialImageOptions["imageStructure"] = ({ cfg, title, description, fileData }) => {
  type Font = string | { name?: string }
  const typo = (cfg.theme as { typography: { header: Font; body: Font } }).typography
  const fontName = (f: Font) => (typeof f === "string" ? f : String(f?.name ?? ""))
  const headerFont = fontName(typo.header)
  const bodyFont = fontName(typo.body)
  const fm = (fileData.frontmatter ?? {}) as Record<string, unknown>
  const isHome = fileData.slug === "index"
  const noteType = isHome ? "디지털 가든" : String(fm.noteType ?? "")
  const topics = isHome ? [] : topicsOf(fileData.filePath)
  const date = isHome ? undefined : fmtDate(fileData.dates?.created ?? fm.created)
  const heading = clip(title, 48)
  const big = heading.length <= 22
  // Generated excerpts start with section headings ("생각", "발췌"); drop them.
  const desc = clip(
    String(description ?? "")
      .replace(/\s+/g, " ")
      .replace(/(^|\s)(생각|발췌|요약|References?)(?=\s)/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    big ? 110 : 80,
  )

  const chip = (text: string, strong = false) => (
    <div
      style={{
        display: "flex",
        padding: "8px 20px",
        borderRadius: 999,
        fontSize: 24,
        color: strong ? C.green : C.body,
        backgroundColor: strong ? C.tint : "transparent",
        border: strong ? "none" : `2px solid ${C.rule}`,
      }}
    >
      {text}
    </div>
  )

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        backgroundColor: C.paper,
        fontFamily: bodyFont,
      }}
    >
      <div style={{ display: "flex", width: 14, height: "100%", backgroundColor: C.green }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 44,
          flex: 1,
          // X lays the page title over the bottom of the image; keep that band empty.
          padding: "52px 72px 120px 64px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", width: 14, height: 14, borderRadius: 999, backgroundColor: C.green }} />
            <div style={{ display: "flex", fontFamily: headerFont, fontSize: 30, color: C.green, fontWeight: 700 }}>
              잔향의 마음 로그
            </div>
          </div>
          {date ? <div style={{ display: "flex", fontSize: 24, color: C.muted }}>{date}</div> : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {noteType || topics.length ? (
            <div style={{ display: "flex", gap: 12 }}>
              {noteType ? chip(noteType) : null}
              {topics.map((t) => chip(t, true))}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              fontFamily: headerFont,
              fontWeight: 700,
              fontSize: big ? 60 : 48,
              lineHeight: 1.3,
              color: C.ink,
            }}
          >
            {heading}
          </div>
          {desc ? (
            <div style={{ display: "flex", fontSize: 27, lineHeight: 1.55, color: C.muted }}>{desc}</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
