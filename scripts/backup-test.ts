import {
  __setDatabaseNameForTests,
  applyImportedBackup,
  deleteFacility,
  getFacilities,
  getMapFilterSettings,
  getRecentFacilityIds,
  getRelationshipGraphSettings,
  normalizeImportedFacilities,
  normalizeImportedMapFilterSettings,
  saveFacility,
  updateFacilityPhotoData,
} from '../src/db'
import { IDBObjectStore } from 'fake-indexeddb'
import type { Facility } from '../src/types'

const result = document.querySelector<HTMLPreElement>('#result')!
const dbName = `tdr-archive-test-${crypto.randomUUID()}`
__setDatabaseNameForTests(dbName)
export const backupTestDatabaseName = dbName

const facility = (id: string, name: string): Facility => ({
  schemaVersion: 10,
  id,
  name,
  area: '',
  category: 'その他',
  park: 'パーク外',
  latitude: null,
  longitude: null,
  favorite: false,
  bgs: [],
  trivia: [],
  props: [],
  relatedFacilityIds: [],
  photos: [],
  notes: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message)
}

const rejects = async (action: () => unknown, label: string): Promise<void> => {
  try {
    await action()
  } catch {
    return
  }
  throw new Error(`${label}を拒否しませんでした。`)
}

const ids = async (): Promise<string[]> => (await getFacilities()).map((item) => item.id).sort()

const putRawFacility = async (value: unknown): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(dbName, 4)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('facilities', 'readwrite')
      transaction.objectStore('facilities').put(value)
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onerror = () => { database.close(); reject(transaction.error) }
    }
  })
}

const getRawFacility = async (id: string): Promise<unknown> => await new Promise((resolve, reject) => {
  const request = indexedDB.open(dbName, 4)
  request.onerror = () => reject(request.error)
  request.onsuccess = () => {
    const database = request.result
    const read = database.transaction('facilities', 'readonly').objectStore('facilities').get(id)
    read.onsuccess = () => { database.close(); resolve(read.result) }
    read.onerror = () => { database.close(); reject(read.error) }
  }
})

const run = async (): Promise<string[]> => {
  const richFacility: Facility = {
    ...facility('test-a', 'テストA'),
    bgs: [{ id: 'bgs-1', text: '登録済みBGS' }],
    trivia: [{ id: 'trivia-1', text: '登録済みトリビア' }],
    photos: [{ id: 'photo-1', name: '写真', title: '写真タイトル', description: '写真説明', location: '現地', dataUrl: 'data:image/jpeg;base64,AA==', createdAt: '2026-01-01T00:00:00.000Z' }],
    props: [{ id: 'prop-1', title: '小物', description: '小物説明', location: '入口', photos: [] }],
    relatedFacilityIds: ['test-keep'],
  }
  const initial = [richFacility, facility('test-keep', '保持施設')]
  await applyImportedBackup(initial, 'replace', {
    relationshipSettings: { selectedId: 'test-a' },
    recentFacilityIds: ['test-a'],
    mapFilterSettings: { visibleCategories: [], visibleInformationTypes: ['facility', 'photo_spot'], clusteringEnabled: true },
  })
  assert((await ids()).join(',') === 'test-a,test-keep', '初期データの投入に失敗しました。')
  const loadedInitial = (await getFacilities()).find((item) => item.id === 'test-a')
  assert(loadedInitial?.bgs[0]?.text === '登録済みBGS', 'BGSが保持されません。')
  assert(loadedInitial?.trivia[0]?.text === '登録済みトリビア', 'トリビアが保持されません。')
  assert(loadedInitial?.photos[0]?.dataUrl === 'data:image/jpeg;base64,AA==', '写真が保持されません。')
  assert(loadedInitial?.props[0]?.description === '小物説明', 'プロップが保持されません。')
  assert(loadedInitial?.relatedFacilityIds[0] === 'test-keep', '関連施設IDが保持されません。')
  assert((await getMapFilterSettings()).clusteringEnabled === true, 'マップ設定が保持されません。')
  const photoUpdated = await updateFacilityPhotoData('test-a', 'photo-1', null, 'data:image/jpeg;base64,AA==', 'data:image/jpeg;base64,BB==')
  assert(photoUpdated?.bgs[0]?.text === '登録済みBGS' && photoUpdated.photos[0]?.dataUrl.endsWith('BB=='), '写真だけの更新で施設情報が保持されません。')
  await saveFacility({ ...photoUpdated!, bgs: [{ id: 'bgs-1', text: '別操作で更新されたBGS' }] })
  const stalePhotoUpdate = await updateFacilityPhotoData('test-a', 'photo-1', null, 'data:image/jpeg;base64,AA==', 'data:image/jpeg;base64,CC==')
  assert(stalePhotoUpdate === null, '古い写真データで更新が適用されました。')
  assert((await getFacilities()).find((item) => item.id === 'test-a')?.bgs[0]?.text === '別操作で更新されたBGS', '競合時に施設情報が失われました。')
  const currentWithSecondPhoto = (await getFacilities()).find((item) => item.id === 'test-a')!
  await saveFacility({ ...currentWithSecondPhoto, photos: [...currentWithSecondPhoto.photos, { ...currentWithSecondPhoto.photos[0], id: 'photo-2', dataUrl: 'data:image/jpeg;base64,DD==' }] })
  const originalPhotoPut = IDBObjectStore.prototype.put as unknown as (this: IDBObjectStore, value: unknown, key?: IDBValidKey) => IDBRequest
  let failPhotoPut = true
  IDBObjectStore.prototype.put = function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (failPhotoPut && value && typeof value === 'object' && (value as { id?: unknown }).id === 'test-a') {
      failPhotoPut = false
      throw new Error('テスト用の写真保存失敗')
    }
    return originalPhotoPut.call(this, value, key)
  }
  await rejects(() => updateFacilityPhotoData('test-a', 'photo-1', null, 'data:image/jpeg;base64,BB==', 'data:image/jpeg;base64,EE=='), '写真保存失敗')
  IDBObjectStore.prototype.put = originalPhotoPut
  const continuedPhotoUpdate = await updateFacilityPhotoData('test-a', 'photo-2', null, 'data:image/jpeg;base64,DD==', 'data:image/jpeg;base64,FF==')
  assert(continuedPhotoUpdate?.photos.find((photo) => photo.id === 'photo-1')?.dataUrl.endsWith('BB=='), '保存失敗した写真の元画像が失われました。')
  assert(continuedPhotoUpdate?.photos.find((photo) => photo.id === 'photo-2')?.dataUrl.endsWith('FF=='), '保存失敗後に次の写真を処理できませんでした。')

  const valid = normalizeImportedFacilities([facility('test-new', 'テスト新規')])
  assert(valid.length === 1 && valid[0].id === 'test-new', '正常なバックアップを検証できません。')
  const validMapFilters = normalizeImportedMapFilterSettings({ visibleCategories: ['restaurant', 'ショップ'], visibleInformationTypes: ['facility'], clusteringEnabled: false })
  assert(validMapFilters.visibleCategories.join(',') === 'レストラン,ショップ', '有効なマップカテゴリを保持できません。')
  await rejects(() => normalizeImportedMapFilterSettings({ visibleCategories: ['未知のカテゴリ'] }), '未知のマップカテゴリ')
  await rejects(() => normalizeImportedMapFilterSettings({ visibleCategories: 'レストラン' }), '不正なマップカテゴリ形式')
  await rejects(() => normalizeImportedMapFilterSettings({ visibleCategories: [{}] }), '不正なマップカテゴリ型')
  assert((await getMapFilterSettings()).clusteringEnabled === true, '不正なマップ設定で保存済み設定が変更されました。')

  const invalidCases: [string, unknown][] = [
    ['施設', [{ name: 'IDなし' }]],
    ['本文', [{ ...facility('bad-text', '不正本文'), bgs: [{ text: 123 }] }]],
    ['写真', [{ ...facility('bad-photo', '不正写真'), photos: [{ dataUrl: 123 }] }]],
    ['プロップ', [{ ...facility('bad-prop', '不正プロップ'), props: [{ photos: '不正' }] }]],
    ['関連施設ID', [{ ...facility('bad-related', '不正関連'), relatedFacilityIds: ['ok', 123] }]],
    ['カテゴリ', [{ ...facility('bad-category', '不正カテゴリ'), category: '未知のカテゴリ' }]],
  ]
  for (const [label, value] of invalidCases) await rejects(() => normalizeImportedFacilities(value), label)
  assert((await ids()).join(',') === 'test-a,test-keep', '検証失敗時に既存データが変更されました。')

  await applyImportedBackup([facility('test-a', '更新A'), facility('test-new', '新規')], 'merge')
  assert((await ids()).join(',') === 'test-a,test-keep,test-new', 'mergeで既存施設が維持されません。')
  assert((await getFacilities()).find((item) => item.id === 'test-a')?.name === '更新A', 'mergeの上書きに失敗しました。')

  await applyImportedBackup([facility('test-only', '置換後')], 'replace')
  assert((await ids()).join(',') === 'test-only', 'replaceで施設が置換されません。')
  assert((await getRelationshipGraphSettings()).selectedId === 'test-a', 'バックアップに含まれない関係設定が消えました。')
  assert((await getRecentFacilityIds()).join(',') === 'test-a', 'バックアップに含まれない履歴が消えました。')
  assert((await getMapFilterSettings()).clusteringEnabled === true, 'バックアップに含まれないマップ設定が消えました。')
  await deleteFacility('test-only')
  assert(await updateFacilityPhotoData('test-only', 'photo-1', null, 'old', 'new') === null, '削除済み施設の写真更新が適用されました。')

  const legacyRaw = { id: 'legacy-raw', name: '旧形式保存データ', category: 'その他', bgs: '旧BGS', trivia: '旧トリビア', props: '旧プロップ', relatedFacilityIds: ['test-only'] }
  await putRawFacility(legacyRaw)
  const legacyBeforeRead = JSON.stringify(await getRawFacility('legacy-raw'))
  const legacyLoaded = (await getFacilities()).find((item) => item.id === 'legacy-raw')
  assert(legacyLoaded?.bgs[0]?.text === '旧BGS' && legacyLoaded.trivia[0]?.text === '旧トリビア' && legacyLoaded.props[0]?.description === '旧プロップ', '旧形式保存データを表示できません。')
  assert(JSON.stringify(await getRawFacility('legacy-raw')) === legacyBeforeRead, 'getFacilities()が旧形式データを書き換えました。')

  const legacy = normalizeImportedFacilities([{
    id: 'legacy', name: '旧形式', bgs: '旧BGS', trivia: '旧トリビア', props: '旧プロップ',
  }])
  assert(legacy[0].bgs[0]?.text === '旧BGS' && legacy[0].trivia[0]?.text === '旧トリビア' && legacy[0].props[0]?.description === '旧プロップ', '旧形式を読み込めません。')

  const beforeFailure = await ids()
  const badClone = { ...facility('clone-failure', '複製失敗') } as Facility & { invalid: unknown }
  badClone.invalid = () => undefined
  await rejects(() => applyImportedBackup([badClone], 'replace'), 'トランザクション失敗')
  assert((await ids()).join(',') === beforeFailure.join(','), 'トランザクション失敗後に部分適用されました。')
  assert((await getMapFilterSettings()).visibleInformationTypes.includes('facility'), '設定読み込みに失敗しました。')

  await applyImportedBackup([
    { ...facility('delete-a', '削除参照元'), relatedFacilityIds: ['delete-target'] },
    { ...facility('delete-b', '複数参照元'), relatedFacilityIds: ['delete-target', 'keep-id'] },
    facility('delete-target', '削除対象'),
    facility('delete-unrelated', '無関係'),
  ], 'replace')
  const originalPut = IDBObjectStore.prototype.put as unknown as (this: IDBObjectStore, value: unknown, key?: IDBValidKey) => IDBRequest
  IDBObjectStore.prototype.put = function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (value && typeof value === 'object' && Array.isArray((value as { relatedFacilityIds?: unknown }).relatedFacilityIds)) {
      throw new Error('テスト用の保存失敗')
    }
    return originalPut.call(this, value, key)
  }
  await rejects(() => deleteFacility('delete-target'), '削除失敗')
  IDBObjectStore.prototype.put = originalPut
  const afterFailure = await getFacilities()
  assert(afterFailure.some((item) => item.id === 'delete-target'), '削除失敗後に対象施設が消えました。')
  assert(afterFailure.find((item) => item.id === 'delete-a')?.relatedFacilityIds.includes('delete-target'), '削除失敗後に関連IDが消えました。')
  await deleteFacility('delete-target')
  const afterDelete = await getFacilities()
  assert(!afterDelete.some((item) => item.id === 'delete-target'), '削除対象が残っています。')
  assert(afterDelete.find((item) => item.id === 'delete-a')?.relatedFacilityIds.length === 0, '関連元AのIDが残っています。')
  assert(afterDelete.find((item) => item.id === 'delete-b')?.relatedFacilityIds.join(',') === 'keep-id', '複数参照元の整理に失敗しました。')
  assert(afterDelete.find((item) => item.id === 'delete-unrelated')?.name === '無関係', '無関係な施設に影響しました。')
  return ['正常検証', '不正データ拒否', '検証失敗時の不変性', 'merge', 'replace', '設定維持', '旧形式互換', 'トランザクション失敗時の不変性', '削除時の関連ID整理']
}

export const backupTestPromise = run().then((passed) => {
  result.textContent = `PASS\n${passed.map((item) => `- ${item}`).join('\n')}\nDB: ${dbName}`
}).catch((error) => {
  result.textContent = `FAIL\n${error instanceof Error ? error.message : String(error)}`
  throw error
})
