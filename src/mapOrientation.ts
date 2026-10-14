import type { Park } from './types'

const PARK_MAP_BEARINGS: Readonly<Record<Park, number>> = {
  東京ディズニーランド: 157,
  東京ディズニーシー: -101,
  パーク外: 0,
}

export const getParkMapBearing = (park: Park) => PARK_MAP_BEARINGS[park]
// MapLibreの画面投影では負方向に回転すると、シーが左・ランドが右になる。
export const getResortMapBearing = () => -68
