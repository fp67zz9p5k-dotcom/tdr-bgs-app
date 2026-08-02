import type { Park } from './types'

export type ParkId = 'land' | 'sea'

export const PARK_DEFINITIONS: readonly { id: ParkId; label: Park }[] = [
  { id: 'land', label: '東京ディズニーランド' },
  { id: 'sea', label: '東京ディズニーシー' },
]

export const getParkById = (id: ParkId): Park =>
  PARK_DEFINITIONS.find((park) => park.id === id)?.label ?? '東京ディズニーランド'

export const getParkId = (park: Park): ParkId =>
  park === '東京ディズニーシー' ? 'sea' : 'land'

export type AreaId =
  | 'land-entrance'
  | 'world-bazaar'
  | 'adventureland'
  | 'westernland'
  | 'critter-country'
  | 'fantasyland'
  | 'toontown'
  | 'tomorrowland'
  | 'sea-entrance'
  | 'mediterranean-harbor'
  | 'american-waterfront'
  | 'port-discovery'
  | 'lost-river-delta'
  | 'arabian-coast'
  | 'mermaid-lagoon'
  | 'mysterious-island'
  | 'fantasy-springs'

export type AreaDefinition = {
  id: AreaId
  label: string
  park: Park
}

export const AREA_DEFINITIONS: readonly AreaDefinition[] = [
  { id: 'land-entrance', label: 'エントランス', park: '東京ディズニーランド' },
  { id: 'world-bazaar', label: 'ワールドバザール', park: '東京ディズニーランド' },
  { id: 'adventureland', label: 'アドベンチャーランド', park: '東京ディズニーランド' },
  { id: 'westernland', label: 'ウエスタンランド', park: '東京ディズニーランド' },
  { id: 'critter-country', label: 'クリッターカントリー', park: '東京ディズニーランド' },
  { id: 'fantasyland', label: 'ファンタジーランド', park: '東京ディズニーランド' },
  { id: 'toontown', label: 'トゥーンタウン', park: '東京ディズニーランド' },
  { id: 'tomorrowland', label: 'トゥモローランド', park: '東京ディズニーランド' },
  { id: 'sea-entrance', label: 'エントランス', park: '東京ディズニーシー' },
  { id: 'mediterranean-harbor', label: 'メディテレーニアンハーバー', park: '東京ディズニーシー' },
  { id: 'american-waterfront', label: 'アメリカンウォーターフロント', park: '東京ディズニーシー' },
  { id: 'port-discovery', label: 'ポートディスカバリー', park: '東京ディズニーシー' },
  { id: 'lost-river-delta', label: 'ロストリバーデルタ', park: '東京ディズニーシー' },
  { id: 'arabian-coast', label: 'アラビアンコースト', park: '東京ディズニーシー' },
  { id: 'mermaid-lagoon', label: 'マーメイドラグーン', park: '東京ディズニーシー' },
  { id: 'mysterious-island', label: 'ミステリアスアイランド', park: '東京ディズニーシー' },
  { id: 'fantasy-springs', label: 'ファンタジースプリングス', park: '東京ディズニーシー' },
]

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

export const getAreaDefinitions = (park: Park): readonly AreaDefinition[] =>
  AREA_DEFINITIONS.filter((area) => area.park === park)

export const getAreaId = (area: string, park: Park): AreaId | null => {
  const normalizedArea = normalizeAreaName(area, park)
  return AREA_DEFINITIONS.find((definition) => (
    definition.park === park && normalizeAreaKey(definition.label) === normalizeAreaKey(normalizedArea)
  ))?.id ?? null
}

export const getAreaLabel = (id: AreaId): string =>
  AREA_DEFINITIONS.find((definition) => definition.id === id)?.label ?? id
