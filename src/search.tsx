import type { ReactNode } from 'react'
import type { Facility } from './types'

export const normalizeSearchCharacter = (value: string) => value
  .normalize('NFKC')
  .toLocaleLowerCase('ja')
  .replace(/[\u30a1-\u30f6]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
  .replace(/[・.．。、,\s_\-‐‑‒–—―−]/gu, '')

export const normalizeSearchText = (value: string) => Array.from(value, normalizeSearchCharacter).join('').replace(/号$/u, '')
export const getSearchKeywords = (value: string) => value.normalize('NFKC').trim().split(/\s+/).map(normalizeSearchText).filter(Boolean)

type NormalizedTextMap = { normalized: string; sourceIndexes: number[] }
const createNormalizedTextMap = (value: string): NormalizedTextMap => {
  let normalized = ''
  const sourceIndexes: number[] = []
  let sourceIndex = 0
  for (const character of value) {
    const normalizedCharacter = normalizeSearchCharacter(character)
    normalized += normalizedCharacter
    sourceIndexes.push(...Array.from(normalizedCharacter, () => sourceIndex))
    sourceIndex += character.length
  }
  if (normalized.endsWith('号')) { normalized = normalized.slice(0, -1); sourceIndexes.pop() }
  return { normalized, sourceIndexes }
}

export const findNormalizedRange = (text: string, keyword: string) => {
  if (!keyword) return null
  const mapped = createNormalizedTextMap(text)
  const normalizedIndex = mapped.normalized.indexOf(keyword)
  if (normalizedIndex < 0) return null
  const start = mapped.sourceIndexes[normalizedIndex] ?? 0
  const lastSourceIndex = mapped.sourceIndexes[normalizedIndex + keyword.length - 1] ?? start
  const lastCharacter = Array.from(text.slice(lastSourceIndex))[0] ?? ''
  return { start, end: lastSourceIndex + lastCharacter.length }
}

export const getFacilitySearchTexts = (facility: Facility) => [
  facility.name, facility.area, facility.category, facility.park, facility.notes,
  ...facility.bgs.map((entry) => entry.text), ...facility.trivia.map((entry) => entry.text),
  ...facility.props.flatMap((prop) => [prop.title, prop.description, prop.location]),
  ...facility.photos.flatMap((photo) => [photo.title, photo.description, photo.location]),
  ...facility.props.flatMap((prop) => prop.photos.flatMap((photo) => [photo.title, photo.description, photo.location])),
  ...(() => {
    const legacy = facility as Facility & { alias?: unknown; aliases?: unknown }
    return [
      ...(typeof legacy.alias === 'string' ? [legacy.alias] : []),
      ...(Array.isArray(legacy.aliases) ? legacy.aliases.filter((value): value is string => typeof value === 'string') : []),
    ]
  })(),
]

export const getSearchSnippet = (facility: Facility, keywords: string[]) => {
  const bodyTexts = [
    facility.notes,
    ...facility.bgs.map((entry) => entry.text),
    ...facility.trivia.map((entry) => entry.text),
    ...facility.props.flatMap((prop) => [prop.title, prop.description, prop.location]),
    ...facility.photos.flatMap((photo) => [photo.title, photo.description, photo.location]),
    ...facility.props.flatMap((prop) => prop.photos.flatMap((photo) => [photo.title, photo.description, photo.location])),
  ]
  for (const text of bodyTexts) {
    const range = keywords.map((keyword) => findNormalizedRange(text, keyword)).find((item): item is { start: number; end: number } => Boolean(item))
    if (!range) continue
    const start = Math.max(0, range.start - 28)
    const end = Math.min(text.length, range.end + 42)
    return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
  }
  return ''
}

export const searchFacility = (facility: Facility, query: string) => {
  const keywords = getSearchKeywords(query)
  if (!keywords.length) return null
  const values = getFacilitySearchTexts(facility).map(normalizeSearchText)
  if (!keywords.every((keyword) => values.some((value) => value.includes(keyword)))) return null
  return { facility, keywords, excerpt: getSearchSnippet(facility, keywords) }
}

export function HighlightedSearchText({ text, query }: { text: string; query: string }) {
  const ranges = getSearchKeywords(query).map((term) => findNormalizedRange(text, term)).filter((range): range is { start: number; end: number } => Boolean(range)).sort((a, b) => a.start - b.start)
  if (!ranges.length) return <>{text}</>
  const merged = ranges.reduce<{ start: number; end: number }[]>((result, range) => {
    const previous = result.at(-1)
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
    else result.push({ ...range })
    return result
  }, [])
  const parts: ReactNode[] = []
  let cursor = 0
  merged.forEach((range, index) => {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start))
    parts.push(<mark className="search-match" key={`${range.start}-${range.end}-${index}`}>{text.slice(range.start, range.end)}</mark>)
    cursor = range.end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}
