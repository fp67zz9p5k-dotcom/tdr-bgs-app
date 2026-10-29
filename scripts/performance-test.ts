import { __setDatabaseNameForTests, __closeTestDatabaseConnections, getFacilities, getFacilityById, saveFacilities } from '../src/db'
import type { Facility } from '../src/types'

const dbName = `tdr-archive-perf-${crypto.randomUUID()}`
__setDatabaseNameForTests(dbName)
export const performanceTestDatabaseName = dbName

const makeFacility = (index: number, total: number): Facility => ({
  schemaVersion: 10,
  id: `perf-${index}`,
  name: `性能計測施設${index}`,
  area: index % 2 ? 'メディテレーニアンハーバー' : 'ワールドバザール',
  category: index % 3 ? 'アトラクション' : 'レストラン',
  park: index % 2 ? '東京ディズニーシー' : '東京ディズニーランド',
  latitude: 35.63 + index / 1_000_000,
  longitude: 139.88 + index / 1_000_000,
  favorite: false,
  bgs: [{ id: `bgs-${index}`, text: `施設${index}のBGS本文。` }],
  trivia: [{ id: `trivia-${index}`, text: `施設${index}のトリビア本文。` }],
  props: [{ id: `prop-${index}`, title: `小物${index}`, description: '計測用の小物説明', location: '入口', photos: [] }],
  relatedFacilityIds: [index > 0 ? `perf-${index - 1}` : `perf-${total - 1}`],
  photos: [{ id: `photo-${index}`, name: '計測写真', title: '', description: '', location: '', dataUrl: `data:image/jpeg;base64,${'A'.repeat(1368)}`, createdAt: '2026-01-01T00:00:00.000Z' }],
  notes: '計測用データ',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const now = (): number => performance.now()
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
const measure = async (action: () => unknown): Promise<number[]> => {
  const values: number[] = []
  for (let i = 0; i < 5; i += 1) {
    const start = now()
    await action()
    values.push(now() - start)
  }
  return values
}

const run = async (): Promise<void> => {
  for (const size of [100, 500, 1000]) {
    const facilities = Array.from({ length: size }, (_, index) => makeFacility(index, size))
    const write = await measure(() => saveFacilities(facilities))
    const loaded = await getFacilities()
    const allRead = await measure(() => getFacilities())
    const idRead = await measure(() => getFacilityById(`perf-${Math.floor(size / 2)}`))
    const search = await measure(() => {
      const query = '性能計測施設'
      return loaded.filter((facility) => `${facility.name} ${facility.bgs.map((entry) => entry.text).join(' ')}`.includes(query))
        .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    })
    const related = await measure(() => {
      const byId = new Map(loaded.map((facility) => [facility.id, facility]))
      return loaded[loaded.length - 1].relatedFacilityIds.map((id) => byId.get(id)).filter(Boolean)
    })
    console.log(JSON.stringify({ size, dataBytes: JSON.stringify(facilities).length, writeMs: median(write), allReadMs: median(allRead), idReadMs: median(idRead), searchSortMs: median(search), relatedMs: median(related) }))
  }
}

export const performanceTestPromise = run().finally(() => {
  __closeTestDatabaseConnections()
})
