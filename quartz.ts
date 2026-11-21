import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import GardenMap from "./custom/GardenMap"
import NoteMeta from "./custom/NoteMeta"
import TopicNav from "./custom/TopicNav"

const config = await loadQuartzConfig()
export default config

// Layout from quartz.config.yaml plus the site's own components:
// - left: topic menu (replaces the folder explorer, disabled in the YAML)
// - beforeBody: note type + topics under the title (replaces folder breadcrumbs)
// - right: garden map (replaces the stock graph plugin)
const base = await loadQuartzLayout()
export const layout = await loadQuartzLayout({
  defaults: {
    left: [...(base.defaults.left ?? []), TopicNav()],
    beforeBody: [...(base.defaults.beforeBody ?? []), NoteMeta()],
    right: [GardenMap(), ...(base.defaults.right ?? [])],
  },
})
