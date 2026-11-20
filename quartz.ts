import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import GardenMap from "./custom/GardenMap"

const config = await loadQuartzConfig()
export default config

// Layout from quartz.config.yaml, plus the garden map at the top of the right
// sidebar (it replaces the stock graph plugin, which is disabled in the YAML).
const base = await loadQuartzLayout()
export const layout = await loadQuartzLayout({
  defaults: {
    right: [GardenMap(), ...(base.defaults.right ?? [])],
  },
})
