// "정원 지도": a categorical, labelled link map of the garden.
//
// The component only renders a mount point; custom/gardenMap.inline.ts builds the
// canvas, legend and tooltip on every SPA navigation. The home page places its own
// `<div class="garden-map" data-mode="global">` in site/index.md, which the same
// script picks up, so the script is shipped on every page via this component.

import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "../quartz/components/types"
import script from "./gardenMap.inline"
import style from "./gardenMap.scss"

const GardenMap: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  // The home page shows the whole map in its body instead.
  if (fileData.slug === "index") return null
  return (
    <div class={`garden-map garden-map--local ${displayClass ?? ""}`} data-mode="local">
      <h3 class="garden-map__title">이 노트 주변</h3>
    </div>
  )
}

GardenMap.afterDOMLoaded = script
GardenMap.css = style

export default (() => GardenMap) satisfies QuartzComponentConstructor
