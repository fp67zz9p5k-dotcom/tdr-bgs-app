import {
  createTextEntry,
  defaultMapFilterSettings,
  defaultRelationshipGraphSettings,
  type Facility,
  type LegacyFacility,
  type MapFilterSettings,
  type Photo,
  type Prop,
  type RelationshipGraphSettings,
  type TextEntry,
} from './types'
import { normalizeAreaName } from './areas'
import { normalizeCategory } from './categories'

const DB_NAME = 'tdr-archive'
const STORE_NAME = 'facilities'
const SETTINGS_STORE_NAME = 'settings'
const DB_VERSION = 4

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
        db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const normalizeTextEntries = (value: unknown): TextEntry[] => {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is Partial<TextEntry> => Boolean(entry && typeof entry === 'object'))
      .map((entry) => ({
        id: typeof entry.id === 'string' ? entry.id : crypto.randomUUID(),
        text: typeof entry.text === 'string' ? entry.text : '',
      }))
  }
  return typeof value === 'string' && value.trim() ? [createTextEntry(value)] : []
}

const normalizePhotos = (value: unknown): Photo[] => {
  if (!Array.isArray(value)) return []
  return value
    .filter((photo): photo is Partial<Photo> => Boolean(photo && typeof photo === 'object' && typeof (photo as Photo).dataUrl === 'string'))
    .map((photo) => ({
      id: typeof photo.id === 'string' ? photo.id : crypto.randomUUID(),
      name: typeof photo.name === 'string' ? photo.name : '写真',
      title: typeof photo.title === 'string' ? photo.title : '',
      description: typeof photo.description === 'string' ? photo.description : '',
      location: typeof photo.location === 'string' ? photo.location : '',
      dataUrl: photo.dataUrl ?? '',
      createdAt: typeof photo.createdAt === 'string' ? photo.createdAt : new Date().toISOString(),
    }))
}

const normalizeProps = (value: unknown): Prop[] => {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is Partial<Prop> => Boolean(entry && typeof entry === 'object'))
      .map((entry) => ({
        id: typeof entry.id === 'string' ? entry.id : crypto.randomUUID(),
        title: typeof entry.title === 'string' ? entry.title : '',
        description: typeof entry.description === 'string' ? entry.description : '',
        location: typeof entry.location === 'string' ? entry.location : '',
        photos: normalizePhotos(entry.photos),
      }))
  }
  return typeof value === 'string' && value.trim()
    ? [{
        id: crypto.randomUUID(),
        title: '旧データから移行',
        description: value,
        location: '',
        photos: [],
      }]
    : []
}

const migrateFacility = (raw: Facility | LegacyFacility): Facility => {
  const value = raw as Facility & LegacyFacility
  const now = new Date().toISOString()
  return {
    schemaVersion: 10,
    id: value.id,
    name: typeof value.name === 'string' ? value.name : '',
    area: typeof value.area === 'string'
      ? normalizeAreaName(value.area, value.park === '東京ディズニーシー' ? '東京ディズニーシー' : '東京ディズニーランド')
      : '',
    category: normalizeCategory(value.category),
    park: value.park === '東京ディズニーシー' ? '東京ディズニーシー' : '東京ディズニーランド',
    latitude: typeof value.latitude === 'number' && value.latitude >= -90 && value.latitude <= 90 ? value.latitude : null,
    longitude: typeof value.longitude === 'number' && value.longitude >= -180 && value.longitude <= 180 ? value.longitude : null,
    favorite: typeof value.favorite === 'boolean' ? value.favorite : false,
    bgs: normalizeTextEntries(value.bgs),
    trivia: normalizeTextEntries(value.trivia),
    props: normalizeProps(value.props),
    relatedFacilityIds: Array.isArray(value.relatedFacilityIds)
      ? value.relatedFacilityIds.filter((id): id is string => typeof id === 'string')
      : [],
    photos: normalizePhotos(value.photos),
    notes: typeof value.notes === 'string' ? value.notes : '',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  }
}

export const getFacilities = async (): Promise<Facility[]> => {
  const db = await openDatabase()
  const rawFacilities = await new Promise<(Facility | LegacyFacility)[]>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
    request.onsuccess = () => resolve(request.result as (Facility | LegacyFacility)[])
    request.onerror = () => reject(request.error)
  })

  const facilities = rawFacilities.map(migrateFacility)
  const needsMigration = rawFacilities.some((facility, index) =>
    (facility as Facility).schemaVersion !== 10
    || (facility as LegacyFacility).category !== facilities[index].category)
  if (needsMigration) {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    facilities.forEach((facility) => store.put(facility))
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }
  return facilities
}

export const saveFacility = async (facility: Facility): Promise<void> => {
  const db = await openDatabase()
  const persistedFacility = { ...facility } as Facility & { tags?: unknown }
  delete persistedFacility.tags
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(persistedFacility)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

export const importFacilities = async (rawFacilities: unknown): Promise<number> => {
  if (!Array.isArray(rawFacilities)) {
    throw new Error('施設データの形式が正しくありません。')
  }
  const validFacilities = rawFacilities.filter(
    (value): value is Facility | LegacyFacility =>
      Boolean(value && typeof value === 'object' && typeof (value as LegacyFacility).id === 'string'),
  )
  if (validFacilities.length !== rawFacilities.length) {
    throw new Error('施設IDがないデータが含まれています。')
  }

  const facilities = validFacilities.map(migrateFacility)
  const db = await openDatabase()
  const transaction = db.transaction(STORE_NAME, 'readwrite')
  const store = transaction.objectStore(STORE_NAME)
  facilities.forEach((facility) => store.put(facility))
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  return facilities.length
}

export const deleteFacility = async (id: string): Promise<void> => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

export const getRelationshipGraphSettings = async (): Promise<RelationshipGraphSettings> => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(SETTINGS_STORE_NAME, 'readonly').objectStore(SETTINGS_STORE_NAME).get('relationshipGraph')
    request.onsuccess = () => {
      const value = request.result?.value as Partial<RelationshipGraphSettings> | undefined
      const defaults = defaultRelationshipGraphSettings()
      resolve({
        mode: value?.mode === 'overview' ? 'overview' : defaults.mode,
        park: value?.park ?? defaults.park,
        category: value?.category ?? defaults.category,
        area: typeof value?.area === 'string' ? value.area : defaults.area,
        selectedId: typeof value?.selectedId === 'string' ? value.selectedId : null,
        positions: value?.positions && typeof value.positions === 'object' ? value.positions : defaults.positions,
        viewport: value?.viewport && typeof value.viewport === 'object' ? value.viewport : defaults.viewport,
      })
    }
    request.onerror = () => reject(request.error)
  })
}

export const saveRelationshipGraphSettings = async (value: RelationshipGraphSettings): Promise<void> => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SETTINGS_STORE_NAME, 'readwrite')
    transaction.objectStore(SETTINGS_STORE_NAME).put({ id: 'relationshipGraph', value })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

export const getMapFilterSettings = async (): Promise<MapFilterSettings> => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(SETTINGS_STORE_NAME, 'readonly').objectStore(SETTINGS_STORE_NAME).get('mapFilters')
    request.onsuccess = () => {
      const value = request.result?.value as Partial<MapFilterSettings> | undefined
      const defaults = defaultMapFilterSettings()
      resolve({
        ...defaults,
        ...value,
        visibleCategories: Array.isArray(value?.visibleCategories)
          ? Array.from(new Set(value.visibleCategories.map(normalizeCategory)))
          : defaults.visibleCategories,
        visibleInformationTypes: Array.isArray(value?.visibleInformationTypes)
          ? value.visibleInformationTypes.filter((type): type is MapFilterSettings['visibleInformationTypes'][number] =>
            ['facility', 'prop', 'trivia', 'hidden_mickey', 'photo_spot'].includes(type))
          : defaults.visibleInformationTypes,
        clusteringEnabled: value?.clusteringEnabled === true,
      })
    }
    request.onerror = () => reject(request.error)
  })
}

export const saveMapFilterSettings = async (value: MapFilterSettings): Promise<void> => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SETTINGS_STORE_NAME, 'readwrite')
    transaction.objectStore(SETTINGS_STORE_NAME).put({ id: 'mapFilters', value })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

export const getRecentFacilityIds = async (): Promise<string[]> => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(SETTINGS_STORE_NAME, 'readonly').objectStore(SETTINGS_STORE_NAME).get('recentFacilities')
    request.onsuccess = () => {
      const value = request.result?.value
      resolve(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 10) : [])
    }
    request.onerror = () => reject(request.error)
  })
}

export const saveRecentFacilityIds = async (facilityIds: string[]): Promise<void> => {
  const db = await openDatabase()
  const value = Array.from(new Set(facilityIds.filter((id) => typeof id === 'string'))).slice(0, 10)
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SETTINGS_STORE_NAME, 'readwrite')
    transaction.objectStore(SETTINGS_STORE_NAME).put({ id: 'recentFacilities', value })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}
