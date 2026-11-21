import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import GardenMap from "./custom/GardenMap"
import NoteMeta from "./custom/NoteMeta"
import TopicNav from "./custom/TopicNav"

const config = await loadQuartzConfig()
export default config

// Layout from quartz.config.yaml plus the site's own components:
// - left: topic menu (replaces the folder explorer, disabled in the YAML)
// - beforeBody: note type + topics under the title (replaces folder breadcrumbs)
// - right: the "연결된 노트" panel (replaces the stock graph plugin), then the
//   table of contents, which sticks to the top of the screen while reading
const base = await loadQuartzLayout()
export const layout = await loadQuartzLayout({
  defaults: {
    left: [...(base.defaults.left ?? []), TopicNav()],
    beforeBody: [...(base.defaults.beforeBody ?? []), NoteMeta()],
    right: [GardenMap(), ...(base.defaults.right ?? [])],
  },
})
