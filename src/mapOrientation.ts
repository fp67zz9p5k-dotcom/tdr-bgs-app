import type { Park } from './types'

const PARK_MAP_BEARINGS: Readonly<Record<Park, number>> = {
  東京ディズニーランド: 157,
  東京ディズニーシー: -101,
  パーク外: 0,
}

export const getParkMapBearing = (park: Park) => PARK_MAP_BEARINGS[park]
// 公式全体図の「シーを左、ランドを右」に近い見え方に合わせる。
export const getResortMapBearing = () => 68
