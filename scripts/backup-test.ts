import {
  __setDatabaseNameForTests,
  applyImportedBackup,
  getFacilities,
  getMapFilterSettings,
  getRecentFacilityIds,
  getRelationshipGraphSettings,
  normalizeImportedFacilities,
} from '../src/db'
import type { Facility } from '../src/types'

const result = document.querySelector<HTMLPreElement>('#result')!
const dbName = `tdr-archive-test-${crypto.randomUUID()}`
__setDatabaseNameForTests(dbName)

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

const run = async (): Promise<string[]> => {
  const initial = [facility('test-a', 'テストA'), facility('test-keep', '保持施設')]
  await applyImportedBackup(initial, 'replace', {
    relationshipSettings: { selectedId: 'test-a' },
    recentFacilityIds: ['test-a'],
  })
  assert((await ids()).join(',') === 'test-a,test-keep', '初期データの投入に失敗しました。')

  const valid = normalizeImportedFacilities([facility('test-new', 'テスト新規')])
  assert(valid.length === 1 && valid[0].id === 'test-new', '正常なバックアップを検証できません。')

  const invalidCases: [string, unknown][] = [
    ['施設', [{ name: 'IDなし' }]],
    ['本文', [{ ...facility('bad-text', '不正本文'), bgs: [{ text: 123 }] }]],
    ['写真', [{ ...facility('bad-photo', '不正写真'), photos: [{ dataUrl: 123 }] }]],
    ['プロップ', [{ ...facility('bad-prop', '不正プロップ'), props: [{ photos: '不正' }] }]],
    ['関連施設ID', [{ ...facility('bad-related', '不正関連'), relatedFacilityIds: ['ok', 123] }]],
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
  return ['正常検証', '不正データ拒否', '検証失敗時の不変性', 'merge', 'replace', '設定維持', '旧形式互換', 'トランザクション失敗時の不変性']
}

run().then((passed) => {
  result.textContent = `PASS\n${passed.map((item) => `- ${item}`).join('\n')}\nDB: ${dbName}`
}).catch((error) => {
  result.textContent = `FAIL\n${error instanceof Error ? error.message : String(error)}`
})
