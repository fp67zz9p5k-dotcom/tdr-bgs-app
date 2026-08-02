import type { Park } from './types'

export const PARK_AREAS: Record<Park, readonly string[]> = {
  東京ディズニーランド: [
    'エントランス',
    'ワールドバザール',
    'アドベンチャーランド',
    'ウエスタンランド',
    'クリッターカントリー',
    'ファンタジーランド',
    'トゥーンタウン',
    'トゥモローランド',
  ],
  東京ディズニーシー: [
    'エントランス',
    'メディテレーニアンハーバー',
    'アメリカンウォーターフロント',
    'ポートディスカバリー',
    'ロストリバーデルタ',
    'アラビアンコースト',
    'マーメイドラグーン',
    'ミステリアスアイランド',
    'ファンタジースプリングス',
  ],
}

const normalizeAreaKey = (value: string) => value
  .normalize('NFKC')
  .trim()
  .replace(/[・･\s_-]/g, '')
  .replace(/^パーク(?=エントランス$)/, '')

export const normalizeAreaName = (area: string, park: Park): string => {
  const trimmedArea = area.normalize('NFKC').trim()
  if (!trimmedArea) return ''
  const normalizedKey = normalizeAreaKey(trimmedArea)
  return PARK_AREAS[park].find((candidate) => normalizeAreaKey(candidate) === normalizedKey)
    ?? trimmedArea
}

export const isOfficialArea = (area: string, park: Park): boolean =>
  PARK_AREAS[park].includes(area)
