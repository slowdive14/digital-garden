// Left-sidebar navigation by topic (replaces the folder explorer).
// Desktop: always open. Mobile: a "주제" button that drops the list down.

import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "../quartz/components/types"
import { resolveRelative, simplifySlug, type FullSlug } from "../quartz/util/path"
import { hubName, topicGroups } from "./topics"
import script from "./topicNav.inline"
import style from "./topicNav.scss"

const TopicNav: QuartzComponent = ({ fileData, allFiles, displayClass }: QuartzComponentProps) => {
  const current = fileData.slug as FullSlug
  const currentSimple = simplifySlug(current)
  const groups = topicGroups(allFiles)
  if (!groups.length) return null
  // Count only links to published notes.
  const published = new Set(allFiles.map((f) => simplifySlug(f.slug as FullSlug) as string))

  return (
    <nav class={`topic-nav ${displayClass ?? ""}`} aria-label="주제">
      <details class="topic-nav__toggle" open>
        <summary>주제</summary>
        <div class="topic-nav__body">
          {groups.map((g) => (
            <section class="topic-nav__group">
              <h3>{g.name}</h3>
              <ul>
                {g.hubs.map((hub) => {
                  const isCurrent = hub.slug === current
                  const contains = (hub.links as string[] | undefined)?.includes(currentSimple)
                  const count = new Set(
                    ((hub.links as string[] | undefined) ?? []).filter((l) => published.has(l)),
                  ).size
                  const cls = isCurrent ? "is-current" : contains ? "is-related" : ""
                  return (
                    <li>
                      <a
                        href={resolveRelative(current, hub.slug as FullSlug)}
                        class={`internal ${cls}`}
                        aria-current={isCurrent ? "page" : undefined}
                        data-no-popover="true"
                      >
                        <span>{hubName(hub)}</span>
                        <span class="topic-nav__count">{count}</span>
                      </a>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </details>
    </nav>
  )
}

TopicNav.afterDOMLoaded = script
TopicNav.css = style

export default (() => TopicNav) satisfies QuartzComponentConstructor
