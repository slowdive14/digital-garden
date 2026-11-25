// Site search. The search plugin indexes Korean one syllable at a time and returns
// at most 8 notes, so this replaces what its button and Ctrl+K open: a search over
// the content index that matches words exactly as typed and lists every hit.
// The plugin's button stays where it is (toolbar layout); the script takes it over.

import type { QuartzComponent, QuartzComponentConstructor } from "../quartz/components/types"
import script from "./gardenSearch.inline"
import style from "./gardenSearch.scss"

const GardenSearch: QuartzComponent = () => null

GardenSearch.afterDOMLoaded = script
GardenSearch.css = style

export default (() => GardenSearch) satisfies QuartzComponentConstructor
