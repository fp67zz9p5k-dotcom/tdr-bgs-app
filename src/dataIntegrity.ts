import { CATEGORY_DEFINITIONS } from './categories'
import type { Facility, Photo, Prop } from './types'

export type IntegrityIssue = {
  facilityId: string
  facilityName: string
  kind: string
  message: string
}

const validCategories = new Set<string>(CATEGORY_DEFINITIONS.map((definition) => definition.value))
const validParks = new Set(['東京ディズニーランド', '東京ディズニーシー', 'パーク外'])

const issueFor = (facility: Partial<Facility>, kind: string, message: string): IntegrityIssue => ({
  facilityId: typeof facility.id === 'string' ? facility.id : '(IDなし)',
  facilityName: typeof facility.name === 'string' && facility.name.trim() ? facility.name : '(施設名なし)',
  kind,
  message,
})

const inspectPhoto = (facility: Partial<Facility>, photo: unknown, location: string): IntegrityIssue[] => {
  if (!photo || typeof photo !== 'object') return [issueFor(facility, '画像', `${location}のデータ形式が不正です。`)]
  const value = photo as Partial<Photo>
  if (typeof value.id !== 'string' || !value.id.trim()) return [issueFor(facility, '画像', `${location}のIDがありません。`)]
  if (typeof value.dataUrl !== 'string' || !value.dataUrl.startsWith('data:')) {
    return [issueFor(facility, '画像', `${location}のData URLが不正です。`)]
  }
  return []
}

export const diagnoseFacilityIntegrity = (facilities: Facility[]): IntegrityIssue[] => {
  const issues: IntegrityIssue[] = []
  const ids = new Set<string>()

  facilities.forEach((facility, index) => {
    if (!facility || typeof facility !== 'object') return
    if (typeof facility.id !== 'string' || !facility.id.trim()) {
      issues.push(issueFor(facility, '施設ID', `施設${index + 1}のIDがありません。`))
    } else if (ids.has(facility.id)) {
      issues.push(issueFor(facility, '施設ID', `ID「${facility.id}」が重複しています。`))
    } else {
      ids.add(facility.id)
    }
    if (typeof facility.name !== 'string' || !facility.name.trim()) issues.push(issueFor(facility, '必須項目', '施設名がありません。'))
    if (!validCategories.has(facility.category)) issues.push(issueFor(facility, 'カテゴリ', `カテゴリ「${String(facility.category)}」は定義されていません。`))
    if (!validParks.has(facility.park)) issues.push(issueFor(facility, '所属先', `所属先「${String(facility.park)}」は定義されていません。`))
    if (facility.park === 'パーク外' && facility.area.trim()) issues.push(issueFor(facility, '所属情報', 'パーク外の施設にエリアが設定されています。'))
    if (!Array.isArray(facility.relatedFacilityIds)) {
      issues.push(issueFor(facility, '関連施設', '関連施設IDが配列ではありません。'))
    } else {
      const relatedIds = new Set<string>()
      facility.relatedFacilityIds.forEach((relatedId) => {
        if (typeof relatedId !== 'string' || !relatedId.trim()) {
          issues.push(issueFor(facility, '関連施設', '不正な関連施設IDがあります。'))
        } else if (relatedIds.has(relatedId)) {
          issues.push(issueFor(facility, '関連施設', `関連施設ID「${relatedId}」が重複しています。`))
        } else {
          relatedIds.add(relatedId)
        }
      })
    }
    if (!Array.isArray(facility.photos)) issues.push(issueFor(facility, '画像', '施設画像が配列ではありません。'))
    else facility.photos.forEach((photo, photoIndex) => issues.push(...inspectPhoto(facility, photo, `施設画像${photoIndex + 1}`)))
    if (!Array.isArray(facility.props)) issues.push(issueFor(facility, 'プロップ', 'プロップが配列ではありません。'))
    else facility.props.forEach((prop: Prop, propIndex) => {
      if (!prop || typeof prop !== 'object' || !Array.isArray(prop.photos)) issues.push(issueFor(facility, '画像', `プロップ${propIndex + 1}の画像データが不正です。`))
      else prop.photos.forEach((photo, photoIndex) => issues.push(...inspectPhoto(facility, photo, `プロップ${propIndex + 1}の画像${photoIndex + 1}`)))
    })
  })

  const knownIds = new Set(facilities.map((facility) => facility.id).filter((id): id is string => typeof id === 'string'))
  facilities.forEach((facility) => {
    if (!Array.isArray(facility.relatedFacilityIds)) return
    facility.relatedFacilityIds.forEach((relatedId) => {
      if (typeof relatedId === 'string' && relatedId.trim() && !knownIds.has(relatedId)) {
        issues.push(issueFor(facility, '関連施設', `存在しない施設ID「${relatedId}」を参照しています。`))
      }
    })
  })
  return issues
}
