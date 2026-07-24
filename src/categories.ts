export const CATEGORY_DEFINITIONS = [
  { id: 'attraction', value: 'アトラクション', label: 'アトラクション', englishLabel: 'ATTRACTION', icon: '🎢' },
  { id: 'restaurant', value: 'レストラン', label: 'レストラン', englishLabel: 'RESTAURANT', icon: '🍽' },
  { id: 'shop', value: 'ショップ', label: 'ショップ', englishLabel: 'SHOP', icon: '🛍' },
  { id: 'area', value: 'エリア', label: 'エリア', englishLabel: 'AREA', icon: '🧭' },
  { id: 'bridge_structure', value: '橋・建造物', label: '橋・建造物', englishLabel: 'STRUCTURE', icon: '🏛' },
  { id: 'plaza', value: '広場', label: '広場', englishLabel: 'PLAZA', icon: '⛲' },
  { id: 'landmark', value: 'ランドマーク', label: 'ランドマーク', englishLabel: 'LANDMARK', icon: '⭐' },
  { id: 'other', value: 'その他', label: 'その他', englishLabel: 'ARCHIVE ITEM', icon: '📁' },
] as const

export type CategoryDefinition = typeof CATEGORY_DEFINITIONS[number]
export type CategoryId = CategoryDefinition['id']
export type Category = CategoryDefinition['value']

export const DEFAULT_CATEGORY: Category = 'アトラクション'
export const FALLBACK_CATEGORY: Category = 'その他'

const categoryByValue = new Map<string, CategoryDefinition>(
  CATEGORY_DEFINITIONS.flatMap((definition) => [
    [definition.value, definition] as const,
    [definition.id, definition] as const,
  ]),
)

export const normalizeCategory = (value: unknown): Category =>
  typeof value === 'string'
    ? categoryByValue.get(value)?.value ?? FALLBACK_CATEGORY
    : FALLBACK_CATEGORY

export const getCategoryDefinition = (value: unknown): CategoryDefinition =>
  categoryByValue.get(normalizeCategory(value)) ?? CATEGORY_DEFINITIONS[CATEGORY_DEFINITIONS.length - 1]
