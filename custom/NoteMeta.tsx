// Under the title: what kind of note this is and which topics it belongs to.
// Replaces the folder breadcrumbs, so visitors navigate by topic, not by folder.

import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "../quartz/components/types"
import { resolveRelative, simplifySlug, type FullSlug } from "../quartz/util/path"
import { groupOf, hubName, topicsOf } from "./topics"
import style from "./noteMeta.scss"

const NoteMeta: QuartzComponent = ({ fileData, allFiles }: QuartzComponentProps) => {
  const slug = fileData.slug as FullSlug
  if (!slug || slug === "index" || slug.endsWith("/index") || slug.startsWith("tags/")) return null

  const type = fileData.frontmatter?.noteType as string | undefined
  const self = allFiles.find((f) => f.slug === slug)
  const group = type === "주제" && self ? groupOf(allFiles, self) : undefined
  const topics = topicsOf(allFiles, simplifySlug(slug)).filter((h) => h.slug !== slug)
  if (!type && !topics.length) return null

  return (
    <div class="note-meta">
      {type && (
        <span class={`note-meta__type ${type === "주제" ? "is-topic" : ""}`}>
          {group ? `주제 · ${group}` : type}
        </span>
      )}
      {topics.length > 0 && (
        <span class="note-meta__topics">
          <span class="note-meta__label">속한 주제</span>
          {topics.map((h) => (
            <a href={resolveRelative(slug, h.slug as FullSlug)} class="internal note-meta__topic">
              {hubName(h)}
            </a>
          ))}
        </span>
      )}
    </div>
  )
}

NoteMeta.css = style

export default (() => NoteMeta) satisfies QuartzComponentConstructor
