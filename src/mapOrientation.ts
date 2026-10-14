import type { Park } from './types'

const PARK_MAP_BEARINGS: Readonly<Record<Park, number>> = {
  東京ディズニーランド: 157,
  東京ディズニーシー: -101,
  パーク外: 0,
}

export const getParkMapBearing = (park: Park) => PARK_MAP_BEARINGS[park]
// 既存のリゾート中心・ランド・シー代表座標をMapLibreの投影式へ入れ、
// シー→ランドの画面X差が正になるリゾート専用方位。
export const getResortMapBearing = () => -90
