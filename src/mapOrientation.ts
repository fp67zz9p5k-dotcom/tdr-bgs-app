import type { Park } from './types'

// MapLibre's zero bearing keeps geographic north at the top. The official
// park maps are visitor guides with stylised artwork, while facility data is
// geographic, so the interactive map stays north-up rather than applying an
// arbitrary park-specific rotation.
const PARK_MAP_BEARINGS: Readonly<Record<Park, number>> = {
  東京ディズニーランド: 0,
  東京ディズニーシー: 0,
}

export const getParkMapBearing = (park: Park) => PARK_MAP_BEARINGS[park]
