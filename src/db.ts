import {
  createTextEntry,
  defaultMapFilterSettings,
  type Facility,
  type LegacyFacility,
  type MapFilterSettings,
  type Photo,
  type Prop,
  type RelationshipGraphSettings,
  type TextEntry,
} from './types'
import { normalizeAreaName } from './areas'
import { CATEGORY_DEFINITIONS, normalizeCategory } from './categories'

const DB_NAME = 'tdr-archive'
let activeDatabaseName = DB_NAME
const testDatabaseConnections = new Set<IDBDatabase>()
const STORE_NAME = 'facilities'
const SETTINGS_STORE_NAME = 'settings'
const DB_VERSION = 4

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(activeDatabaseName, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
        db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      if (activeDatabaseName !== DB_NAME) testDatabaseConnections.add(request.result)
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
  })

// テスト専用ページからのみ使用する。通常のアプリ実行では呼び出さない。
export const __setDatabaseNameForTests = (name: string): void => {
  if (!name || name === DB_NAME) throw new Error('テスト用DB名を指定してください。')
  activeDatabaseName = name
}

export const __closeTestDatabaseConnections = (): void => {
  testDatabaseConnections.forEach((database) => database.close())
  testDatabaseConnections.clear()
}

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
    area: value.park === 'パーク外' ? '' : typeof value.area === 'string'
      ? normalizeAreaName(value.area, value.park === '東京ディズニーシー' ? '東京ディズニーシー' : '東京ディズニーランド')
      : '',
    category: normalizeCategory(value.category),
    park: value.park === '東京ディズニーシー' ? '東京ディズニーシー' : value.park === 'パーク外' ? 'パーク外' : '東京ディズニーランド',
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

  // 読み込みは読み取り専用に限定する。旧形式の表示用正規化はメモリ上で行い、
  // 診断・明示的な編集保存以外ではIndexedDBへ自動書き戻ししない。
  return rawFacilities.map(migrateFacility)
}

export const getFacilityById = async (id: string): Promise<Facility | null> => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
    request.onsuccess = () => resolve(request.result ? migrateFacility(request.result as Facility | LegacyFacility) : null)
    request.onerror = () => reject(request.error)
  })
}

export const updateFacilityPhotoData = async (
  facilityId: string,
  photoId: string,
  propId: string | null,
  expectedDataUrl: string,
  nextDataUrl: string,
): Promise<Facility | null> => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    let updatedFacility: Facility | null = null
    const request = store.get(facilityId)
    request.onsuccess = () => {
      const value = request.result as Record<string, unknown> | undefined
      if (!value) return
      const photos = propId
        ? Array.isArray(value.props)
          ? (value.props.find((prop) => prop && typeof prop === 'object' && (prop as Record<string, unknown>).id === propId) as Record<string, unknown> | undefined)?.photos
          : undefined
        : value.photos
      if (!Array.isArray(photos)) return
      const photo = photos.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).id === photoId) as Record<string, unknown> | undefined
      if (!photo || photo.dataUrl !== expectedDataUrl) return
      photo.dataUrl = nextDataUrl
      store.put(value)
      updatedFacility = migrateFacility(value as Facility | LegacyFacility)
    }
    transaction.oncomplete = () => resolve(updatedFacility)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('施設写真の更新を中断しました。'))
  })
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

export const saveFacilities = async (facilities: Facility[]): Promise<void> => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    facilities.forEach((facility) => {
      const persistedFacility = { ...facility } as Facility & { tags?: unknown }
      delete persistedFacility.tags
      store.put(persistedFacility)
    })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

export const importFacilities = async (rawFacilities: unknown): Promise<number> => {
  const facilities = normalizeImportedFacilities(rawFacilities)
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

export const normalizeImportedFacilities = (rawFacilities: unknown): Facility[] => {
  if (!Array.isArray(rawFacilities)) throw new Error('施設データの形式が正しくありません。')
  const validatePhotos = (value: unknown, path: string) => {
    if (value === undefined) return
    if (!Array.isArray(value)) throw new Error(`バックアップの${path}は配列である必要があります。`)
    value.forEach((photo, index) => {
      if (!photo || typeof photo !== 'object') throw new Error(`バックアップの${path}[${index}]が不正です。`)
      const item = photo as Record<string, unknown>
      if (typeof item.dataUrl !== 'string') throw new Error(`バックアップの${path}[${index}].dataUrlが不正です。`)
      for (const key of ['id', 'name', 'title', 'description', 'location', 'createdAt']) {
        if (item[key] !== undefined && typeof item[key] !== 'string') {
          throw new Error(`バックアップの${path}[${index}].${key}が不正です。`)
        }
      }
    })
  }
  const validateTextEntries = (value: unknown, path: string) => {
    if (value === undefined || typeof value === 'string') return
    if (!Array.isArray(value)) throw new Error(`バックアップの${path}が不正です。`)
    value.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') throw new Error(`バックアップの${path}[${index}]が不正です。`)
      const item = entry as Record<string, unknown>
      if (item.id !== undefined && typeof item.id !== 'string') throw new Error(`バックアップの${path}[${index}].idが不正です。`)
      if (item.text !== undefined && typeof item.text !== 'string') throw new Error(`バックアップの${path}[${index}].textが不正です。`)
    })
  }
  const validateProps = (value: unknown, path: string) => {
    if (value === undefined || typeof value === 'string') return
    if (!Array.isArray(value)) throw new Error(`バックアップの${path}が不正です。`)
    value.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') throw new Error(`バックアップの${path}[${index}]が不正です。`)
      const item = entry as Record<string, unknown>
      for (const key of ['id', 'title', 'description', 'location']) {
        if (item[key] !== undefined && typeof item[key] !== 'string') {
          throw new Error(`バックアップの${path}[${index}].${key}が不正です。`)
        }
      }
      validatePhotos(item.photos, `${path}[${index}].photos`)
    })
  }
  rawFacilities.forEach((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`バックアップのfacilities[${index}]が不正です。`)
    const item = value as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id) throw new Error(`バックアップのfacilities[${index}].idが不正です。`)
    for (const key of ['name', 'area', 'notes', 'createdAt', 'updatedAt']) {
      if (item[key] !== undefined && typeof item[key] !== 'string') throw new Error(`バックアップのfacilities[${index}].${key}が不正です。`)
    }
    if (item.category !== undefined) {
      if (typeof item.category !== 'string' || !CATEGORY_DEFINITIONS.some((definition) => definition.value === item.category || definition.id === item.category)) {
        throw new Error(`バックアップのfacilities[${index}].categoryが不正です。`)
      }
    }
    if (item.park !== undefined && !['東京ディズニーランド', '東京ディズニーシー', 'パーク外'].includes(item.park as string)) {
      throw new Error(`バックアップのfacilities[${index}].parkが不正です。`)
    }
    for (const key of ['latitude', 'longitude']) {
      if (item[key] !== undefined && item[key] !== null && (typeof item[key] !== 'number' || !Number.isFinite(item[key] as number))) {
        throw new Error(`バックアップのfacilities[${index}].${key}が不正です。`)
      }
    }
    if (item.favorite !== undefined && typeof item.favorite !== 'boolean') throw new Error(`バックアップのfacilities[${index}].favoriteが不正です。`)
    if (item.relatedFacilityIds !== undefined) {
      if (!Array.isArray(item.relatedFacilityIds)) throw new Error(`バックアップのfacilities[${index}].relatedFacilityIdsが不正です。`)
      item.relatedFacilityIds.forEach((id, relatedIndex) => {
        if (typeof id !== 'string') throw new Error(`バックアップのfacilities[${index}].relatedFacilityIds[${relatedIndex}]が不正です。`)
      })
    }
    validateTextEntries(item.bgs, `facilities[${index}].bgs`)
    validateTextEntries(item.trivia, `facilities[${index}].trivia`)
    validateProps(item.props, `facilities[${index}].props`)
    validatePhotos(item.photos, `facilities[${index}].photos`)
  })
  const facilities = rawFacilities.map((value) => migrateFacility(value as Facility | LegacyFacility))
  const ids = new Set<string>()
  if (facilities.some((facility) => ids.has(facility.id) || !ids.add(facility.id))) {
    throw new Error('バックアップ内に重複した施設IDがあります。')
  }
  return facilities
}

export type ImportedBackupSettings = {
  relationshipSettings?: RelationshipGraphSettings
  mapFilterSettings?: MapFilterSettings
  recentFacilityIds?: string[]
}

export const applyImportedBackup = async (
  facilities: Facility[],
  mode: 'merge' | 'replace',
  settings: ImportedBackupSettings = {},
): Promise<void> => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, SETTINGS_STORE_NAME], 'readwrite')
    try {
      const store = transaction.objectStore(STORE_NAME)
      const settingsStore = transaction.objectStore(SETTINGS_STORE_NAME)
      if (mode === 'replace') store.clear()
      facilities.forEach((facility) => {
        const persistedFacility = { ...facility } as Facility & { tags?: unknown }
        delete persistedFacility.tags
        store.put(persistedFacility)
      })
      if (settings.relationshipSettings) settingsStore.put({ id: 'relationshipGraph', value: settings.relationshipSettings })
      if (settings.mapFilterSettings) settingsStore.put({ id: 'mapFilters', value: settings.mapFilterSettings })
      if (settings.recentFacilityIds) settingsStore.put({ id: 'recentFacilities', value: settings.recentFacilityIds })
    } catch (error) {
      try { transaction.abort() } catch { /* transaction already inactive */ }
      reject(error)
      return
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('施設データの適用が中断されました。'))
  })
}

export const applyImportedFacilities = async (facilities: Facility[], mode: 'merge' | 'replace'): Promise<void> => {
  await applyImportedBackup(facilities, mode)
}

export const deleteFacility = async (id: string): Promise<void> => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.getAll()
    request.onsuccess = () => {
      try {
        store.delete(id)
        for (const value of request.result as Array<Record<string, unknown>>) {
          if (value.id === id || !Array.isArray(value.relatedFacilityIds)) continue
          const relatedFacilityIds = value.relatedFacilityIds.filter((relatedId) => relatedId !== id)
          if (relatedFacilityIds.length !== value.relatedFacilityIds.length) {
            store.put({ ...value, relatedFacilityIds })
          }
        }
      } catch (error) {
        try { transaction.abort() } catch { /* transaction already inactive */ }
        reject(error)
      }
    }
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('施設削除処理が中断されました。'))
  })
}

export const getRelationshipGraphSettings = async (): Promise<RelationshipGraphSettings> => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(SETTINGS_STORE_NAME, 'readonly').objectStore(SETTINGS_STORE_NAME).get('relationshipGraph')
    request.onsuccess = () => {
      const value = request.result?.value as Partial<RelationshipGraphSettings> | undefined
      resolve({
        selectedId: typeof value?.selectedId === 'string' ? value.selectedId : null,
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
      const visibleCategories = Array.isArray(value?.visibleCategories)
        ? Array.from(new Set(value.visibleCategories.map(normalizeCategory)))
        : defaults.visibleCategories
      resolve({
        ...defaults,
        ...value,
        visibleCategories: visibleCategories.length === CATEGORY_DEFINITIONS.length ? [] : visibleCategories,
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

export const getRandomDiscoveryHistory = async (): Promise<string[]> => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(SETTINGS_STORE_NAME, 'readonly').objectStore(SETTINGS_STORE_NAME).get('randomDiscovery')
    request.onsuccess = () => {
      const value = request.result?.value
      resolve(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 10) : [])
    }
    request.onerror = () => reject(request.error)
  })
}

export const saveRandomDiscoveryHistory = async (facilityIds: string[]): Promise<void> => {
  const db = await openDatabase()
  const value = Array.from(new Set(facilityIds.filter((id) => typeof id === 'string'))).slice(0, 10)
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SETTINGS_STORE_NAME, 'readwrite')
    transaction.objectStore(SETTINGS_STORE_NAME).put({ id: 'randomDiscovery', value })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}
