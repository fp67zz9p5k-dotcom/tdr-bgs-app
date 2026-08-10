import { DEFAULT_CATEGORY, type Category } from './categories'

export type { Category } from './categories'
export type Park = '東京ディズニーランド' | '東京ディズニーシー'

export type MapInformationType = 'facility' | 'prop' | 'trivia' | 'hidden_mickey' | 'photo_spot'

export type MapFilterSettings = {
  visibleCategories: Category[]
  visibleInformationTypes: MapInformationType[]
  clusteringEnabled: boolean
}

export const defaultMapFilterSettings = (): MapFilterSettings => ({
  visibleCategories: [
    'アトラクション',
    'レストラン',
    'ショップ',
    'エリア',
    '橋・建造物',
    '広場',
    'ランドマーク',
    'その他',
  ],
  visibleInformationTypes: ['facility'],
  clusteringEnabled: false,
})

export type RelationshipGraphSettings = {
  selectedId: string | null
}

export const defaultRelationshipGraphSettings = (): RelationshipGraphSettings => ({
  selectedId: null,
})

export type TextEntry = {
  id: string
  text: string
}

export type Photo = {
  id: string
  name: string
  title: string
  description: string
  location: string
  dataUrl: string
  createdAt: string
}

export type Prop = {
  id: string
  title: string
  description: string
  location: string
  photos: Photo[]
}

export type Facility = {
  schemaVersion: 10
  id: string
  name: string
  area: string
  category: Category
  park: Park
  latitude: number | null
  longitude: number | null
  favorite: boolean
  bgs: TextEntry[]
  trivia: TextEntry[]
  props: Prop[]
  relatedFacilityIds: string[]
  photos: Photo[]
  notes: string
  createdAt: string
  updatedAt: string
}

export type LegacyFacility = {
  id: string
  name?: string
  area?: string
  category?: unknown
  bgs?: string
  trivia?: string
  props?: string
  notes?: string
  createdAt?: string
  updatedAt?: string
}

export const createTextEntry = (text = ''): TextEntry => ({
  id: crypto.randomUUID(),
  text,
})

export const createProp = (): Prop => ({
  id: crypto.randomUUID(),
  title: '',
  description: '',
  location: '',
  photos: [],
})

export const emptyFacility = (): Facility => {
  const now = new Date().toISOString()
  return {
    schemaVersion: 10,
    id: crypto.randomUUID(),
    name: '',
    area: '',
    category: DEFAULT_CATEGORY,
    park: '東京ディズニーランド',
    latitude: null,
    longitude: null,
    favorite: false,
    bgs: [],
    trivia: [],
    props: [],
    relatedFacilityIds: [],
    photos: [],
    notes: '',
    createdAt: now,
    updatedAt: now,
  }
}
