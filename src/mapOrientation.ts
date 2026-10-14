import type { Park } from './types'

const PARK_MAP_BEARINGS: Readonly<Record<Park, number>> = {
  東京ディズニーランド: 157,
  東京ディズニーシー: -101,
  パーク外: 0,
}

export const getParkMapBearing = (park: Park) => PARK_MAP_BEARINGS[park]
// イクスピアリ〜オリエンタルランド本社前の道路軸に合わせたリゾート専用方位。
// シー→ランドの軸も同方向なので、シーが左・ランドが右になる。
export const getResortMapBearing = () => 30
