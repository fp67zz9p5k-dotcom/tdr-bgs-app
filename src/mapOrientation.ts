import type { Park } from './types'

const PARK_MAP_BEARINGS: Readonly<Record<Park, number>> = {
  東京ディズニーランド: 157,
  東京ディズニーシー: -101,
}

export const getParkMapBearing = (park: Park) => PARK_MAP_BEARINGS[park]
