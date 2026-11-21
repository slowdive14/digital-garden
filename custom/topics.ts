// Shared helpers for topic groups (garden.topics.json) used by the site components.

import topicsConfig from "../garden.topics.json"
import type { QuartzPluginData } from "../quartz/plugins/vfile"

type Group = { name: string; hubs: QuartzPluginData[] }

// Root-level notes are topic hubs, except retired ones the sync marks unlisted.
const isHub = (f: QuartzPluginData) =>
  !!f.slug &&
  !f.slug.includes("/") &&
  f.slug !== "index" &&
  f.slug !== "404" &&
  f.frontmatter?.unlisted !== true

const hubName = (f: QuartzPluginData) =>
  String(f.frontmatter?.title ?? f.slug ?? "").trim()

/** Topic hubs (root-level notes) grouped as in garden.topics.json. */
export function topicGroups(allFiles: QuartzPluginData[]): Group[] {
  const hubs = allFiles.filter(isHub)
  const byName = new Map(hubs.map((f) => [hubName(f), f]))
  const groups: Group[] = topicsConfig.groups.map((g) => ({
    name: g.name,
    hubs: g.hubs.map((h) => byName.get(h)).filter((f): f is QuartzPluginData => !!f),
  }))
  const placed = new Set(groups.flatMap((g) => g.hubs))
  const rest = hubs
    .filter((f) => !placed.has(f))
    .sort((a, b) => hubName(a).localeCompare(hubName(b), "ko"))
  if (rest.length) groups.push({ name: "그 밖의 주제", hubs: rest })
  return groups.filter((g) => g.hubs.length)
}

/** Hubs that link to the given (simplified) slug, i.e. the topics a note belongs to. */
export function topicsOf(allFiles: QuartzPluginData[], simpleSlug: string): QuartzPluginData[] {
  return allFiles.filter((f) => isHub(f) && (f.links as string[] | undefined)?.includes(simpleSlug))
}

export function groupOf(allFiles: QuartzPluginData[], hub: QuartzPluginData): string | undefined {
  return topicGroups(allFiles).find((g) => g.hubs.includes(hub))?.name
}

export { hubName }
