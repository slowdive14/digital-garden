// Under the title: what kind of note this is and which topics it belongs to.
// Replaces the folder breadcrumbs, so visitors navigate by topic, not by folder.

import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "../quartz/components/types"
import { resolveRelative, simplifySlug, type FullSlug } from "../quartz/util/path"
import { groupOf, hubName, topicsOf } from "./topics"
import script from "./noteMeta.inline"
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
      {/* Share on X: the script fills in the link (title, hashtag, this page's URL). */}
      <a class="note-meta__share" href="https://x.com/intent/post" target="_blank" rel="noopener" data-share-x="true">
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <path fill="currentColor" d="M18.9 2H22l-6.8 7.8L23 22h-6.1l-4.8-6.3L6.6 22H3.5l7.3-8.4L1 2h6.3l4.3 5.7L18.9 2Zm-1.1 18.2h1.7L6.3 3.7H4.5l13.3 16.5Z" />
        </svg>
        <span>공유</span>
      </a>
    </div>
  )
}

NoteMeta.css = style
NoteMeta.afterDOMLoaded = script

export default (() => NoteMeta) satisfies QuartzComponentConstructor
