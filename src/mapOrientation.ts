import type { Park } from './types'

const PARK_MAP_BEARINGS: Readonly<Record<Park, number>> = {
  東京ディズニーランド: 157,
  東京ディズニーシー: -101,
  パーク外: 0,
}

export const getParkMapBearing = (park: Park) => PARK_MAP_BEARINGS[park]
// イクスピアリ〜オリエンタルランド本社前の南南西軸を水平化し、
// シー→ランドの投影が左→右になるリゾート専用方位。
export const getResortMapBearing = () => 22
