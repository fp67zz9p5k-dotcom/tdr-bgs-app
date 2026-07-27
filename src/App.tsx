import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  deleteFacility,
  getFacilities,
  getMapFilterSettings,
  getRecentFacilityIds,
  getRelationshipGraphSettings,
  importFacilities,
  saveRecentFacilityIds,
  saveFacility,
  saveMapFilterSettings,
  saveRelationshipGraphSettings,
} from './db'
import { RelationshipGraph } from './RelationshipGraph'
import { AnimatedCollapse } from './AnimatedCollapse'
import { getBidirectionalRelatedFacilities, getBidirectionalRelatedFacilityIds } from './relationships'
import { CATEGORY_DEFINITIONS, getCategoryDefinition } from './categories'
import {
  createProp,
  createTextEntry,
  defaultMapFilterSettings,
  defaultRelationshipGraphSettings,
  emptyFacility,
  type Category,
  type Facility,
  type MapFilterSettings,
  type Park,
  type Photo,
  type Prop,
  type RelationshipGraphSettings,
  type TextEntry,
} from './types'

type ReturnPage = 'home' | 'map' | 'relationships'
type Screen =
  | { page: 'home' }
  | { page: 'map' }
  | { page: 'relationships' }
  | { page: 'view'; facility: Facility; returnTo: ReturnPage; mapReturnState?: MapReturnState }
  | { page: 'edit'; facility: Facility; isNew: boolean; returnTo: ReturnPage }

type MapViewState = {
  park: Park
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
}

type MapReturnState = MapViewState & {
  selectedFacilityId: string | null
  scrollY: number
}

const MAP_RETURN_STATE_KEY = 'tdr-map-return-state'

const parks: Park[] = ['東京ディズニーランド', '東京ディズニーシー']
const roundMapCoordinate = (value: number) => Number(value.toFixed(6))

const normalizeMapReturnState = (candidate: unknown): MapReturnState | null => {
  if (typeof candidate !== 'object' || candidate === null) return null
  const value = candidate as Partial<MapReturnState>
  if (
    !parks.includes(value.park as Park)
    || !Array.isArray(value.center)
    || value.center.length !== 2
    || !value.center.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
    || !Number.isFinite(value.zoom)
    || !Number.isFinite(value.bearing)
    || !Number.isFinite(value.pitch)
  ) return null
  return {
    park: value.park as Park,
    center: [value.center[0], value.center[1]],
    zoom: value.zoom as number,
    bearing: value.bearing as number,
    pitch: value.pitch as number,
    selectedFacilityId: typeof value.selectedFacilityId === 'string' ? value.selectedFacilityId : null,
    scrollY: Number.isFinite(value.scrollY) ? value.scrollY as number : 0,
  }
}

const readMapReturnState = (): MapReturnState | null => {
  try {
    return normalizeMapReturnState(JSON.parse(sessionStorage.getItem(MAP_RETURN_STATE_KEY) ?? 'null'))
  } catch {
    return null
  }
}
const officialAreaOrder: Record<Park, string[]> = {
  東京ディズニーランド: [
    'ワールドバザール',
    'アドベンチャーランド',
    'ウエスタンランド',
    'クリッターカントリー',
    'ファンタジーランド',
    'トゥーンタウン',
    'トゥモローランド',
    'パーク外',
  ],
  東京ディズニーシー: [
    'メディテレーニアンハーバー',
    'アメリカンウォーターフロント',
    'ポートディスカバリー',
    'ロストリバーデルタ',
    'ファンタジースプリングス',
    'アラビアンコースト',
    'マーメイドラグーン',
    'ミステリアスアイランド',
    'パークエントランス',
    'パーク外',
  ],
}

const searchableText = (facility: Facility) =>
  [
    facility.name,
    facility.area,
    facility.category,
    facility.park,
    ...facility.bgs.map((entry) => entry.text),
    ...facility.trivia.map((entry) => entry.text),
    ...facility.props.flatMap((prop) => [prop.title, prop.description, prop.location]),
    ...facility.photos.flatMap((photo) => [photo.title, photo.description, photo.location]),
    ...facility.props.flatMap((prop) => prop.photos.flatMap((photo) => [photo.title, photo.description, photo.location])),
    ...facility.tags,
    facility.notes,
  ].join(' ')

const normalizeSearchText = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('ja')
    .replace(/[\u30a1-\u30f6]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0x60),
    )

const getSearchKeywords = (value: string) =>
  normalizeSearchText(value).trim().split(/\s+/).filter(Boolean)

type FacilitySearchMatch = {
  facility: Facility
  score: number
  matchType: 'title' | 'alias' | 'tag' | 'category' | 'area' | 'body' | 'park'
  matchedField: string | null
  matchedText: string | null
  matchedTags: string[]
  snippet: string | null
}

const getFacilityAliases = (facility: Facility) => {
  const legacy = facility as Facility & { alias?: unknown; aliases?: unknown }
  return [
    ...(typeof legacy.alias === 'string' ? [legacy.alias] : []),
    ...(Array.isArray(legacy.aliases) ? legacy.aliases.filter((value): value is string => typeof value === 'string') : []),
  ].filter(Boolean)
}

type SearchableBodyText = { field: string; text: string }

const getFacilityBodyTexts = (facility: Facility): SearchableBodyText[] => [
  { field: 'overview', text: facility.notes },
  ...facility.bgs.map((entry) => ({ field: 'bgs', text: entry.text })),
  ...facility.trivia.map((entry) => ({ field: 'trivia', text: entry.text })),
  ...facility.props.flatMap((prop) => [
    { field: 'propTitle', text: prop.title },
    { field: 'propDescription', text: prop.description },
    { field: 'propLocation', text: prop.location },
  ]),
  ...facility.photos.flatMap((photo) => [
    { field: 'photoTitle', text: photo.title },
    { field: 'photoDescription', text: photo.description },
    { field: 'photoLocation', text: photo.location },
  ]),
  ...facility.props.flatMap((prop) => prop.photos.flatMap((photo) => [
    { field: 'propPhotoTitle', text: photo.title },
    { field: 'propPhotoDescription', text: photo.description },
    { field: 'propPhotoLocation', text: photo.location },
  ])),
].filter(({ text }) => text.trim().length > 0)

const includesKeyword = (values: string[], keyword: string) =>
  values.some((value) => normalizeSearchText(value).includes(keyword))

const createBodySnippet = (facility: Facility, keywords: string[]) => {
  for (const { field, text } of getFacilityBodyTexts(facility)) {
    const normalized = normalizeSearchText(text)
    const positions = keywords
      .map((keyword) => normalized.indexOf(keyword))
      .filter((position) => position >= 0)
    if (!positions.length) continue
    const hitAt = Math.min(...positions)
    const sentenceStart = Math.max(
      text.lastIndexOf('。', Math.max(0, hitAt - 1)),
      text.lastIndexOf('！', Math.max(0, hitAt - 1)),
      text.lastIndexOf('？', Math.max(0, hitAt - 1)),
      text.lastIndexOf('\n', Math.max(0, hitAt - 1)),
    ) + 1
    const sentenceEndCandidates = ['。', '！', '？', '\n']
      .map((separator) => text.indexOf(separator, hitAt))
      .filter((position) => position >= 0)
    const sentenceEnd = sentenceEndCandidates.length
      ? Math.min(...sentenceEndCandidates) + 1
      : text.length
    const start = Math.max(sentenceStart, hitAt - 32)
    const end = Math.min(sentenceEnd, hitAt + 48)
    return {
      field,
      text,
      snippet: `${start > sentenceStart ? '…' : ''}${text.slice(start, end).trim()}${end < sentenceEnd ? '…' : ''}`,
    }
  }
  return null
}

const createFacilitySearchMatch = (facility: Facility, keywords: string[]): FacilitySearchMatch | null => {
  if (!keywords.length) {
    return {
      facility,
      score: 0,
      matchType: 'title',
      matchedField: null,
      matchedText: null,
      matchedTags: [],
      snippet: null,
    }
  }

  const aliases = getFacilityAliases(facility)
  const bodyTexts = getFacilityBodyTexts(facility)
  const fields = [
    { type: 'title' as const, priority: 6, values: [facility.name] },
    { type: 'alias' as const, priority: 5, values: aliases },
    { type: 'tag' as const, priority: 4, values: facility.tags },
    { type: 'category' as const, priority: 3, values: [facility.category] },
    { type: 'area' as const, priority: 2, values: [facility.area] },
    { type: 'body' as const, priority: 1, values: bodyTexts.map(({ text }) => text) },
    { type: 'park' as const, priority: 1, values: [facility.park] },
  ]

  let highestPriority = 0
  let detailScore = 0
  let matchType: FacilitySearchMatch['matchType'] = 'body'
  for (const keyword of keywords) {
    const matchedField = fields.find((field) => includesKeyword(field.values, keyword))
    if (!matchedField) return null
    if (matchedField.priority > highestPriority) {
      highestPriority = matchedField.priority
      matchType = matchedField.type
    }
    detailScore += matchedField.priority * 100
    if (matchedField.priority === 6) {
      const normalizedName = normalizeSearchText(facility.name)
      detailScore += normalizedName === keyword ? 80 : normalizedName.startsWith(keyword) ? 40 : 10
    }
  }

  const matchedTags = facility.tags.filter((tag) =>
    keywords.some((keyword) => normalizeSearchText(tag).includes(keyword)),
  )
  const bodyMatch = createBodySnippet(facility, keywords)

  return {
    facility,
    score: highestPriority * 100_000 + detailScore,
    matchType,
    matchedField: bodyMatch?.field ?? null,
    matchedText: bodyMatch?.text ?? matchedTags[0] ?? null,
    matchedTags,
    snippet: bodyMatch?.snippet ?? null,
  }
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function HighlightedText({ text, query }: { text: string; query: string }) {
  const terms = Array.from(new Set(query.normalize('NFKC').trim().split(/\s+/).filter(Boolean)))
    .flatMap((term) => {
      const hiragana = term.replace(/[\u30a1-\u30f6]/g, (character) =>
        String.fromCharCode(character.charCodeAt(0) - 0x60),
      )
      const katakana = hiragana.replace(/[\u3041-\u3096]/g, (character) =>
        String.fromCharCode(character.charCodeAt(0) + 0x60),
      )
      return [term, hiragana, katakana]
    })
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

  if (!terms.length) return <>{text}</>
  const matcher = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'giu')
  const parts = text.split(matcher)
  return (
    <>
      {parts.map((part, index) =>
        terms.some((term) => normalizeSearchText(term) === normalizeSearchText(part))
          ? <mark className="search-match" key={`${part}-${index}`}>{part}</mark>
          : part,
      )}
    </>
  )
}

type ThemePreference = 'light' | 'dark' | 'system'

const THEME_STORAGE_KEY = 'tdr-bgs-theme'

const readThemePreference = (): ThemePreference => {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  } catch {
    return 'system'
  }
}

const applyThemePreference = (preference: ThemePreference) => {
  const resolvedTheme = preference === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference
  document.documentElement.dataset.theme = resolvedTheme
  document.documentElement.style.colorScheme = resolvedTheme
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', resolvedTheme === 'dark' ? '#0b2536' : '#153e5c')
}

export default function App() {
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [screen, setScreen] = useState<Screen>({ page: 'home' })
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [selectedPark, setSelectedPark] = useState<Park | ''>('')
  const [selectedCategory, setSelectedCategory] = useState<Category | ''>('')
  const [selectedTag, setSelectedTag] = useState('')
  const [categoriesExpanded, setCategoriesExpanded] = useState(false)
  const [tagsExpanded, setTagsExpanded] = useState(false)
  const [recentFacilityIds, setRecentFacilityIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [backupMessage, setBackupMessage] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference)
  const [relationshipSettings, setRelationshipSettings] = useState<RelationshipGraphSettings>(defaultRelationshipGraphSettings)
  const [mapFilterSettings, setMapFilterSettings] = useState<MapFilterSettings>(defaultMapFilterSettings)
  const mapReturnStateRef = useRef<MapReturnState | null>(readMapReturnState())
  const searchAreaRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const hasVisitedNonHomeScreenRef = useRef(false)

  const reload = async () => {
    setFacilities((await getFacilities()).sort((a, b) => a.name.localeCompare(b.name, 'ja')))
  }

  useEffect(() => {
    Promise.all([
      reload(),
      getRelationshipGraphSettings().then(setRelationshipSettings),
      getMapFilterSettings().then(setMapFilterSettings),
      getRecentFacilityIds().then(setRecentFacilityIds),
    ]).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (screen.page !== 'home') hasVisitedNonHomeScreenRef.current = true
  }, [screen.page])

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themePreference)
    } catch {
      // Storage can be unavailable in private browsing; the theme still applies for this session.
    }
    applyThemePreference(themePreference)
    if (themePreference !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => applyThemePreference('system')
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [themePreference])

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      setScreen((current) => {
        if (current.page !== 'view' || current.returnTo !== 'map') return current
        const historyState = typeof event.state === 'object' && event.state !== null
          ? normalizeMapReturnState((event.state as { tdrMapReturnState?: unknown }).tdrMapReturnState)
          : null
        mapReturnStateRef.current = current.mapReturnState ?? historyState ?? readMapReturnState()
        return { page: 'map' }
      })
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    const closeSuggestions = (event: PointerEvent) => {
      if (!searchAreaRef.current?.contains(event.target as Node)) {
        setSearchFocused(false)
        setActiveSuggestionIndex(-1)
      }
    }
    document.addEventListener('pointerdown', closeSuggestions)
    return () => document.removeEventListener('pointerdown', closeSuggestions)
  }, [])

  const rankedSearchMatches = useMemo(() => {
    const keywords = getSearchKeywords(query)
    return facilities
      .map((facility) => createFacilitySearchMatch(facility, keywords))
      .filter((match): match is FacilitySearchMatch => match !== null)
      .sort((a, b) => keywords.length
        ? b.score - a.score || a.facility.name.localeCompare(b.facility.name, 'ja')
        : 0)
  }, [facilities, query])
  const searchMatchByFacilityId = useMemo(
    () => new Map(rankedSearchMatches.map((match) => [match.facility.id, match])),
    [rankedSearchMatches],
  )
  const filteredFacilities = useMemo(() => {
    const searched = rankedSearchMatches.map((match) => match.facility)
    const parkFiltered = selectedPark
      ? searched.filter((facility) => facility.park === selectedPark)
      : searched
    const categoryFiltered = selectedCategory
      ? parkFiltered.filter((facility) => facility.category === selectedCategory)
      : parkFiltered
    const tagFiltered = selectedTag ? categoryFiltered.filter((facility) => facility.tags.includes(selectedTag)) : categoryFiltered
    return favoriteOnly ? tagFiltered.filter((facility) => facility.favorite) : tagFiltered
  }, [rankedSearchMatches, favoriteOnly, selectedTag, selectedCategory, selectedPark])
  const hasNoSearchResults = !loading && query.trim().length > 0 && filteredFacilities.length === 0

  const searchSuggestions = useMemo(() => {
    if (!query.trim()) return []
    return rankedSearchMatches
      .slice(0, 5)
  }, [query, rankedSearchMatches])

  useEffect(() => {
    setActiveSuggestionIndex(searchSuggestions.length > 0 ? 0 : -1)
  }, [query, searchSuggestions.length])

  const recommendedFacilities = useMemo(() => {
    if (!facilities.length) return []
    const keywords = getSearchKeywords(query)
    const validFacilities = Array.from(
      new Map(
        facilities
          .filter((facility) => facility.id.trim() && facility.name.trim())
          .map((facility) => [facility.id, facility]),
      ).values(),
    )
    return validFacilities
      .map((facility) => {
        const text = normalizeSearchText(searchableText(facility))
        const relevance = keywords.reduce((score, keyword) => {
          const partial = keyword.length > 1 ? keyword.slice(0, Math.max(1, keyword.length - 1)) : keyword
          return score + (text.includes(partial) ? 2 : 0)
        }, 0)
        return {
          facility,
          score: relevance
            + (selectedPark && facility.park === selectedPark ? 2 : 0)
            + (selectedCategory && facility.category === selectedCategory ? 2 : 0)
            + (selectedTag && facility.tags.includes(selectedTag) ? 2 : 0)
            + (facility.favorite ? 1 : 0),
        }
      })
      .sort((a, b) => b.score - a.score || b.facility.updatedAt.localeCompare(a.facility.updatedAt))
      .slice(0, 3)
      .map(({ facility }) => facility)
  }, [facilities, query, selectedCategory, selectedPark, selectedTag])

  const allTags = useMemo(
    () => Array.from(new Set(facilities.flatMap((facility) => facility.tags))).sort((a, b) => a.localeCompare(b, 'ja')),
    [facilities],
  )
  const popularTags = useMemo(() => {
    const counts = new Map<string, number>()
    facilities.forEach((facility) => facility.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)))
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).slice(0, 5).map(([tag]) => tag)
  }, [facilities])
  const visibleTags = useMemo(() => {
    if (tagsExpanded) return allTags
    return Array.from(new Set([...popularTags, ...(selectedTag ? [selectedTag] : [])]))
  }, [allTags, popularTags, selectedTag, tagsExpanded])
  const recentFacilities = useMemo(() => recentFacilityIds
    .map((id) => facilities.find((facility) => facility.id === id))
    .filter((facility): facility is Facility => Boolean(facility)), [recentFacilityIds, facilities])
  const compactCategories = CATEGORY_DEFINITIONS.filter((category) => category.value === selectedCategory)

  const groupedFacilities = useMemo(() => parks.map((park) => {
    const parkFacilities = filteredFacilities.filter((facility) => facility.park === park)
    const areas = Array.from(new Set(parkFacilities.map((facility) => facility.area || 'エリア未設定')))
    const orderedAreas = areas.sort((a, b) => {
      const aIndex = officialAreaOrder[park].indexOf(a)
      const bIndex = officialAreaOrder[park].indexOf(b)
      if (a === 'エリア未設定') return 1
      if (b === 'エリア未設定') return -1
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b, 'ja')
      if (aIndex === -1) return 1
      if (bIndex === -1) return -1
      return aIndex - bIndex
    })
    return {
      park,
      areas: orderedAreas.map((area) => ({
        area,
        facilities: parkFacilities.filter((facility) => (facility.area || 'エリア未設定') === area),
      })),
    }
  }).filter((group) => group.areas.length > 0), [filteredFacilities])

  const handleSave = async (facility: Facility) => {
    await saveFacility({ ...facility, updatedAt: new Date().toISOString() })
    await reload()
    setScreen({ page: 'home' })
  }

  const handleDelete = async (facility: Facility) => {
    if (!window.confirm(`「${facility.name}」を削除しますか？`)) return
    await deleteFacility(facility.id)
    setRecentFacilityIds((current) => {
      const next = current.filter((id) => id !== facility.id)
      void saveRecentFacilityIds(next)
      return next
    })
    await reload()
    setScreen({ page: 'home' })
  }

  const openFacility = (facility: Facility, returnTo: ReturnPage, returnState?: MapReturnState) => {
    setRecentFacilityIds((current) => {
      const next = [facility.id, ...current.filter((id) => id !== facility.id)].slice(0, 10)
      void saveRecentFacilityIds(next)
      return next
    })
    setScreen({ page: 'view', facility, returnTo, mapReturnState: returnState })
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  }

  const selectSearchSuggestion = (facility: Facility) => {
    setSearchFocused(false)
    setActiveSuggestionIndex(-1)
    openFacility(facility, 'home')
  }

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setSearchFocused(false)
      setActiveSuggestionIndex(-1)
      event.currentTarget.blur()
      return
    }
    if (!searchFocused || searchSuggestions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveSuggestionIndex((current) => (current + 1) % searchSuggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveSuggestionIndex((current) => (current <= 0 ? searchSuggestions.length - 1 : current - 1))
    } else if (event.key === 'Enter' && activeSuggestionIndex >= 0) {
      event.preventDefault()
      selectSearchSuggestion(searchSuggestions[activeSuggestionIndex].facility)
    }
  }

  const clearRecentFacilities = async () => {
    await saveRecentFacilityIds([])
    setRecentFacilityIds([])
    setBackupMessage('閲覧履歴を削除しました。')
  }

  const clearFilters = () => {
    setQuery('')
    setSelectedPark('')
    setSelectedCategory('')
    setSelectedTag('')
    setFavoriteOnly(false)
  }

  const clearSearch = () => {
    setQuery('')
    setSearchFocused(false)
    setActiveSuggestionIndex(-1)
    searchInputRef.current?.blur()
  }

  const resetMapExploration = () => {
    const defaults = defaultMapFilterSettings()
    setMapFilterSettings(defaults)
    void saveMapFilterSettings(defaults)
    mapReturnStateRef.current = null
    sessionStorage.removeItem(MAP_RETURN_STATE_KEY)
    if (typeof window.history.state === 'object' && window.history.state !== null) {
      const { tdrMapReturnState: _discardedMapState, ...historyState } = window.history.state as Record<string, unknown>
      window.history.replaceState(historyState, '')
    }
  }

  const toggleFavorite = async (facility: Facility) => {
    const updated = { ...facility, favorite: !facility.favorite, updatedAt: new Date().toISOString() }
    await saveFacility(updated)
    setFacilities((current) => current.map((item) => item.id === updated.id ? updated : item))
    setScreen((current) => current.page === 'view' && current.facility.id === updated.id
      ? { ...current, facility: updated }
      : current)
  }

  const exportBackup = () => {
    const backup = {
      format: 'tdr-archive-backup',
      version: 4,
      exportedAt: new Date().toISOString(),
      facilities,
      relationshipGraphSettings: relationshipSettings,
      mapFilterSettings,
      recentFacilityIds,
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `tdr-archive-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setBackupMessage(`${facilities.length}件をバックアップしました。`)
  }

  const importBackup = async (file: File | undefined) => {
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      const backupFacilities = Array.isArray(parsed)
        ? parsed
        : typeof parsed === 'object' && parsed !== null && 'facilities' in parsed
          ? (parsed as { facilities: unknown }).facilities
          : null
      const importedRelationshipSettings = !Array.isArray(parsed)
        && typeof parsed === 'object'
        && parsed !== null
        && 'relationshipGraphSettings' in parsed
        ? (parsed as { relationshipGraphSettings?: RelationshipGraphSettings }).relationshipGraphSettings
        : undefined
      const importedRecentFacilityIds = !Array.isArray(parsed)
        && typeof parsed === 'object'
        && parsed !== null
        && 'recentFacilityIds' in parsed
        && Array.isArray((parsed as { recentFacilityIds?: unknown }).recentFacilityIds)
        ? (parsed as { recentFacilityIds: unknown[] }).recentFacilityIds.filter((id): id is string => typeof id === 'string').slice(0, 10)
        : undefined
      const importedMapFilterSettings = !Array.isArray(parsed)
        && typeof parsed === 'object'
        && parsed !== null
        && 'mapFilterSettings' in parsed
        ? (parsed as { mapFilterSettings?: MapFilterSettings }).mapFilterSettings
        : undefined
      if (!window.confirm('バックアップを読み込みます。同じ施設はバックアップの内容で上書きされます。よろしいですか？')) return
      const count = await importFacilities(backupFacilities)
      if (importedRelationshipSettings) {
        const normalizedSettings = { ...defaultRelationshipGraphSettings(), ...importedRelationshipSettings }
        await saveRelationshipGraphSettings(normalizedSettings)
        setRelationshipSettings(normalizedSettings)
      }
      if (importedRecentFacilityIds) {
        const normalizedRecentIds = Array.from(new Set(importedRecentFacilityIds)).slice(0, 10)
        await saveRecentFacilityIds(normalizedRecentIds)
        setRecentFacilityIds(normalizedRecentIds)
      }
      if (importedMapFilterSettings) {
        const defaults = defaultMapFilterSettings()
        const normalizedMapSettings: MapFilterSettings = {
          ...defaults,
          ...importedMapFilterSettings,
          visibleCategories: Array.isArray(importedMapFilterSettings.visibleCategories)
            ? Array.from(new Set(importedMapFilterSettings.visibleCategories.map((category) => getCategoryDefinition(category).value)))
            : defaults.visibleCategories,
          visibleInformationTypes: Array.isArray(importedMapFilterSettings.visibleInformationTypes)
            ? importedMapFilterSettings.visibleInformationTypes.filter((type) =>
              ['facility', 'prop', 'trivia', 'hidden_mickey', 'photo_spot'].includes(type))
            : defaults.visibleInformationTypes,
          clusteringEnabled: importedMapFilterSettings.clusteringEnabled === true,
        }
        await saveMapFilterSettings(normalizedMapSettings)
        setMapFilterSettings(normalizedMapSettings)
      }
      await reload()
      setBackupMessage(`${count}件を復元しました。施設画像も含まれています。`)
    } catch (error) {
      setBackupMessage(error instanceof Error ? `読み込み失敗：${error.message}` : '読み込みに失敗しました。')
    }
  }

  if (screen.page === 'view') {
    return (
      <>
        <FacilityView
          key={screen.facility.id}
          facility={screen.facility}
          allFacilities={facilities}
          onBack={() => {
            if (screen.returnTo === 'map') {
              mapReturnStateRef.current = screen.mapReturnState ?? mapReturnStateRef.current ?? readMapReturnState()
              window.history.back()
            } else {
              setScreen({ page: screen.returnTo })
            }
          }}
          onEdit={() => setScreen({ page: 'edit', facility: screen.facility, isNew: false, returnTo: screen.returnTo })}
          onToggleFavorite={() => void toggleFavorite(screen.facility)}
          onOpenFacility={(facility) => openFacility(facility, screen.returnTo, screen.mapReturnState)}
          onSelectTag={(tag) => {
            resetMapExploration()
            setQuery('')
            setSelectedPark('')
            setSelectedCategory('')
            setFavoriteOnly(false)
            setSelectedTag(tag)
            setScreen({ page: 'home' })
          }}
        />
        <PrimaryBottomNavigation
          active="home"
          onNavigate={(page) => {
            resetMapExploration()
            if (page === 'relationships') {
              const nextSettings = {
                ...relationshipSettings,
                mode: 'center' as const,
                selectedId: screen.facility.id,
                positions: {},
                viewport: { x: 0, y: 0, zoom: 1 },
              }
              setRelationshipSettings(nextSettings)
              void saveRelationshipGraphSettings(nextSettings)
            }
            setScreen({ page })
          }}
        />
      </>
    )
  }

  if (screen.page === 'map') {
    return (
      <>
        <ParkMap
          facilities={facilities}
          filterSettings={mapFilterSettings}
          initialState={mapReturnStateRef.current}
          onFilterSettingsChange={(settings) => {
            setMapFilterSettings(settings)
            void saveMapFilterSettings(settings)
          }}
          onBack={() => {
            resetMapExploration()
            setScreen({ page: 'home' })
          }}
          onOpenFacility={(facility, state) => {
            mapReturnStateRef.current = state
            sessionStorage.setItem(MAP_RETURN_STATE_KEY, JSON.stringify(state))
            window.history.replaceState({ ...window.history.state, tdrMapReturnState: state }, '')
            window.history.pushState({ tdrMapDetail: true }, '')
            openFacility(facility, 'map', state)
          }}
        />
        <PrimaryBottomNavigation
          active="map"
          onNavigate={(page) => {
            if (page !== 'map') resetMapExploration()
            setScreen({ page })
          }}
        />
      </>
    )
  }

  if (screen.page === 'relationships') {
    return (
      <>
        <RelationshipGraph
          facilities={facilities}
          settings={relationshipSettings}
          onSettingsChange={(settings) => {
            setRelationshipSettings(settings)
            void saveRelationshipGraphSettings(settings)
          }}
          onBack={() => setScreen({ page: 'home' })}
          onOpenFacility={(facility) => openFacility(facility, 'relationships')}
        />
        <PrimaryBottomNavigation
          active="relationships"
          onNavigate={(page) => {
            if (page === 'map') resetMapExploration()
            setScreen({ page })
          }}
        />
      </>
    )
  }

  if (screen.page === 'edit') {
    return (
      <FacilityDetail
        initialFacility={screen.facility}
        allFacilities={facilities}
        isNew={screen.isNew}
        onBack={() => setScreen(screen.isNew
          ? { page: screen.returnTo }
          : { page: 'view', facility: screen.facility, returnTo: screen.returnTo })}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    )
  }

  return (
    <main className="app-shell">
      <header className={`hero${hasVisitedNonHomeScreenRef.current ? ' screen-enter' : ''}`}>
        <button type="button" className="settings-menu-button" onClick={() => setSettingsOpen(true)} aria-label="設定メニューを開く" aria-expanded={settingsOpen}>
          <span></span><span></span><span></span>
        </button>
        <p className="eyebrow">MY PRIVATE ARCHIVE</p>
        <h1>TDR BGS図鑑</h1>
        <p>物語の手がかりを、ひとつずつ記録する。</p>
      </header>
      {settingsOpen && (
        <div className="settings-overlay" role="presentation" onClick={() => setSettingsOpen(false)}>
          <aside className="settings-drawer" role="dialog" aria-modal="true" aria-label="設定" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><p className="eyebrow">SETTINGS</p><h2>設定</h2></div>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="設定を閉じる">×</button>
            </header>
            <section className="settings-section">
              <div className="settings-section-heading">
                <span aria-hidden="true">↕</span>
                <div><strong>バックアップ</strong><small>施設、写真、関係図設定、閲覧履歴を保存・復元</small></div>
              </div>
              <div className="backup-actions">
                <button type="button" onClick={exportBackup} disabled={facilities.length === 0}>JSONを書き出す</button>
                <label>JSONを読み込む
                  <input type="file" accept="application/json,.json" onChange={(event) => { void importBackup(event.target.files?.[0]); event.target.value = '' }} />
                </label>
              </div>
              {backupMessage && <p className="settings-message" role="status">{backupMessage}</p>}
            </section>
            <section className="settings-section">
              <div className="settings-section-heading">
                <span aria-hidden="true">◐</span>
                <div><strong>外観</strong><small>アプリの表示テーマを切り替えます</small></div>
              </div>
              <div className="theme-options" role="group" aria-label="表示テーマ">
                {([
                  ['light', 'ライト'],
                  ['dark', 'ダーク'],
                  ['system', '端末設定'],
                ] as const).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={themePreference === value ? 'active' : ''}
                    aria-pressed={themePreference === value}
                    onClick={() => setThemePreference(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
            <section className="settings-section">
              <div className="settings-section-heading">
                <span aria-hidden="true">◷</span>
                <div><strong>最近見た施設</strong><small>ホームに表示する閲覧履歴を管理</small></div>
              </div>
              <button type="button" className="settings-clear-button" onClick={() => void clearRecentFacilities()} disabled={recentFacilityIds.length === 0}>
                閲覧履歴をすべて削除
              </button>
            </section>
            <p className="settings-future-note">今後の設定項目はここに追加されます。</p>
          </aside>
        </div>
      )}
      <section className={`content${hasVisitedNonHomeScreenRef.current ? ' screen-enter' : ''}`}>
        <div className="search-area" ref={searchAreaRef}>
          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder="タイトル・タグ・BGSを検索"
              aria-label="項目を検索"
              aria-autocomplete="list"
              aria-expanded={searchFocused && searchSuggestions.length > 0}
              aria-controls="search-suggestions"
            />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="検索をクリア">×</button>}
          </label>
          {searchFocused && searchSuggestions.length > 0 && (
            <div className="search-suggestions" id="search-suggestions" role="listbox" aria-label="検索候補">
              {searchSuggestions.map((match, index) => {
                const { facility } = match
                return (
                <button
                  type="button"
                  className={`search-suggestion${activeSuggestionIndex === index ? ' active' : ''}`}
                  role="option"
                  aria-selected={activeSuggestionIndex === index}
                  key={facility.id}
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveSuggestionIndex(index)}
                  onClick={() => selectSearchSuggestion(facility)}
                >
                  <span className="search-suggestion-icon" aria-hidden="true">⌕</span>
                  <span className="search-suggestion-copy">
                    <strong><HighlightedText text={facility.name} query={query} /></strong>
                    <small><b>{facility.category}</b><span>{facility.area || 'エリア未設定'}</span></small>
                    {match.snippet && (
                      <span className="search-suggestion-match">
                        <b>本文一致</b>
                        <span><HighlightedText text={match.snippet} query={query} /></span>
                      </span>
                    )}
                    {match.matchedTags.length > 0 && (
                      <span className="search-suggestion-tags">
                        <b>タグ一致</b>
                        {match.matchedTags.slice(0, 3).map((tag) => (
                          <span key={tag}>#<HighlightedText text={tag} query={query} /></span>
                        ))}
                      </span>
                    )}
                  </span>
                </button>
                )
              })}
            </div>
          )}
        </div>
        {hasNoSearchResults ? (
          <div className="empty search-empty search-empty-exclusive">
            <span className="empty-icon" aria-hidden="true">⌕</span>
            <h3>検索結果が見つかりませんでした</h3>
            <div className="search-empty-copy">
              <p className="search-empty-query">入力した検索語：<strong>{query.trim()}</strong></p>
              <p>検索キーワードを変更して、もう一度お試しください</p>
            </div>
            <div className="empty-actions">
              <button type="button" className="search-clear-button" onClick={clearSearch}>検索をクリア</button>
            </div>
            {recommendedFacilities.length > 0 && (
              <section className="search-recommendations" aria-label="おすすめ施設">
                <h4>おすすめ施設</h4>
                <div className="search-recommendation-grid">
                  {recommendedFacilities.map((facility) => {
                    const category = getCategoryDefinition(facility.category)
                    return (
                      <button type="button" key={facility.id} onClick={() => openFacility(facility, 'home')}>
                        {facility.photos[0] ? (
                          <img src={facility.photos[0].dataUrl} alt="" />
                        ) : (
                          <span className="category-placeholder" aria-hidden="true">{category.icon}</span>
                        )}
                        <span className="search-recommendation-copy">
                          <strong>{facility.name}</strong>
                          <small><span aria-hidden="true">{category.icon}</span>{category.label}・{facility.area || 'エリア未設定'}</small>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        ) : (
          <>
        {recentFacilities.length > 0 && (
          <section className="recent-section" aria-label="最近見た施設">
            <div className="compact-heading"><h2>最近見た施設</h2><span>{recentFacilities.length}件</span></div>
            <div className="recent-list">
              {recentFacilities.map((facility) => {
                const category = getCategoryDefinition(facility.category)
                return (
                  <button type="button" className="recent-card" key={facility.id} onClick={() => openFacility(facility, 'home')}>
                    {facility.photos[0] ? (
                      <img src={facility.photos[0].dataUrl} alt="" />
                    ) : (
                      <span className="category-placeholder" aria-hidden="true">{category.icon}</span>
                    )}
                    <span className="recent-card-body">
                      <strong>{facility.name}</strong>
                      <small><span aria-hidden="true">{category.icon}</span>{category.label}</small>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )}
        <section className="filter-panel" aria-label="絞り込み">
          <div className="filter-summary">
            <strong>絞り込み</strong>
            <span>{selectedPark ? (selectedPark === '東京ディズニーランド' ? 'ランド' : 'シー') : 'すべて'}{selectedCategory ? `＋${selectedCategory}` : ''}・{filteredFacilities.length}件</span>
          </div>
          <div className="filter-chip-row category-filter" aria-label="カテゴリで絞り込み">
            <button type="button" className={`primary-park-filter${selectedPark === '' ? ' active' : ''}`} onClick={() => setSelectedPark('')}>すべて</button>
            <button type="button" className={`primary-park-filter${selectedPark === '東京ディズニーランド' ? ' active' : ''}`} onClick={() => setSelectedPark('東京ディズニーランド')}>ランド</button>
            <button type="button" className={`primary-park-filter${selectedPark === '東京ディズニーシー' ? ' active' : ''}`} onClick={() => setSelectedPark('東京ディズニーシー')}>シー</button>
            <button
              type="button"
              className="expand-chip"
              onClick={() => setCategoriesExpanded((current) => !current)}
              aria-expanded={categoriesExpanded}
              aria-controls="home-category-options"
            >
              {categoriesExpanded ? 'カテゴリ －' : 'カテゴリ ＋'}
            </button>
            {compactCategories.map((category) => (
              <button type="button" className={selectedCategory === category.value ? 'active' : ''} key={category.id} onClick={() => setSelectedCategory('')}>
                <span aria-hidden="true">{category.icon}</span>{category.label}
              </button>
            ))}
            <button
              type="button"
              className={`favorite-filter${favoriteOnly ? ' active' : ''}`}
              onClick={() => setFavoriteOnly((current) => !current)}
              aria-pressed={favoriteOnly}
            >
              <span aria-hidden="true">{favoriteOnly ? '★' : '☆'}</span>お気に入り
            </button>
          </div>
          <AnimatedCollapse id="home-category-options" open={categoriesExpanded}>
            <div className="expanded-category-grid">
              <button type="button" className={selectedCategory === '' ? 'active' : ''} onClick={() => { setSelectedCategory(''); setCategoriesExpanded(false) }}>
                カテゴリすべて
              </button>
              {CATEGORY_DEFINITIONS.map((category) => (
                <button type="button" className={selectedCategory === category.value ? 'active' : ''} key={category.id} onClick={() => { setSelectedCategory(category.value); setCategoriesExpanded(false) }}>
                  <span aria-hidden="true">{category.icon}</span>{category.label}
                </button>
              ))}
            </div>
          </AnimatedCollapse>
          {allTags.length > 0 && (
            <div className="tag-filter-block">
              <div
                id="home-tag-options"
                className={`filter-chip-row tag-filter${tagsExpanded ? ' is-expanded' : ''}`}
                aria-label="タグで絞り込み"
              >
                <button type="button" className={selectedTag === '' ? 'active' : ''} onClick={() => setSelectedTag('')}>タグすべて</button>
                {visibleTags.map((tag) => (
                  <button type="button" className={selectedTag === tag ? 'active' : ''} key={tag} onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}>#{tag}</button>
                ))}
                {allTags.length > 5 && (
                  <button
                    type="button"
                    className="expand-chip"
                    onClick={() => setTagsExpanded((current) => !current)}
                    aria-expanded={tagsExpanded}
                    aria-controls="home-tag-options"
                  >
                    {tagsExpanded ? 'タグを閉じる' : 'すべてのタグ'}
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
        <div className="section-heading">
          <div><p className="eyebrow">ARCHIVE</p><h2>項目一覧</h2></div>
          <span className="count">{filteredFacilities.length}件</span>
        </div>
        {loading ? (
          <p className="empty">読み込み中です…</p>
        ) : filteredFacilities.length === 0 ? (
          <div className="empty search-empty">
            <span className="empty-icon" aria-hidden="true">⌕</span>
            <h3>{query ? '検索結果が見つかりませんでした' : (selectedPark || selectedCategory || selectedTag || favoriteOnly ? '条件に一致する項目がありません' : '最初の項目を登録しましょう')}</h3>
            {query ? (
              <div className="search-empty-copy">
                <p>検索キーワードを変更して、もう一度お試しください</p>
                <p className="search-empty-query">入力した検索語：<strong>{query}</strong></p>
              </div>
            ) : (
              <p>{selectedPark || selectedCategory || selectedTag || favoriteOnly ? '絞り込み条件を変更してください。' : 'BGSやトリビアを、自分だけの図鑑に残せます。'}</p>
            )}
            <div className="empty-actions">
              {query
                ? <button type="button" className="search-clear-button" onClick={clearSearch}>検索をクリア</button>
                : (selectedPark || selectedCategory || selectedTag || favoriteOnly) && <button type="button" onClick={clearFilters}>絞り込みを解除</button>}
              <button type="button" onClick={() => setScreen({ page: 'edit', facility: emptyFacility(), isNew: true, returnTo: 'home' })}>施設を追加</button>
            </div>
            {query && recommendedFacilities.length > 0 && (
              <section className="search-recommendations" aria-label="おすすめ施設">
                <h4>おすすめ施設</h4>
                <div className="search-recommendation-grid">
                  {recommendedFacilities.map((facility) => {
                    const category = getCategoryDefinition(facility.category)
                    return (
                      <button type="button" key={facility.id} onClick={() => openFacility(facility, 'home')}>
                        {facility.photos[0] ? (
                          <img src={facility.photos[0].dataUrl} alt="" />
                        ) : (
                          <span className="category-placeholder" aria-hidden="true">{category.icon}</span>
                        )}
                        <span className="search-recommendation-copy">
                          <strong>{facility.name}</strong>
                          <small><span aria-hidden="true">{category.icon}</span>{category.label}・{facility.area || 'エリア未設定'}</small>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="park-facility-groups">
            {groupedFacilities.map((parkGroup) => (
              <section className="park-facility-group" key={parkGroup.park}>
                <h3>{parkGroup.park}</h3>
                {parkGroup.areas.map((areaGroup) => (
                  <section className="area-facility-group" key={areaGroup.area}>
                    <div className="area-heading">
                      <h4>{areaGroup.area}</h4>
                      <span>{areaGroup.facilities.length}件</span>
                    </div>
                    <div className="facility-list">
                      {areaGroup.facilities.map((facility) => {
                        const searchMatch = query.trim() ? searchMatchByFacilityId.get(facility.id) : undefined
                        return (
                        <article className="facility-card" key={facility.id}>
                          <button className="facility-card-link" onClick={() => openFacility(facility, 'home')}>
                            {facility.photos[0] ? (
                              <img
                                className="facility-card-photo"
                                src={facility.photos[0].dataUrl}
                                alt={facility.photos[0].title || `${facility.name}の写真`}
                              />
                            ) : (
                              <span className="facility-card-photo category-placeholder" aria-hidden="true">{getCategoryDefinition(facility.category).icon}</span>
                            )}
                            <span className="facility-card-body">
                              <strong><HighlightedText text={facility.name} query={query} /></strong>
                              <span className="facility-meta"><HighlightedText text={`${facility.park}・${areaGroup.area}`} query={query} /></span>
                              {searchMatch?.snippet && (
                                <span className="facility-search-match">
                                  <b>本文一致</b>
                                  <span className="facility-search-snippet">
                                    <HighlightedText text={searchMatch.snippet} query={query} />
                                  </span>
                                </span>
                              )}
                              <span className="facility-card-bottom">
                                <span className="category"><span aria-hidden="true">{getCategoryDefinition(facility.category).icon}</span><HighlightedText text={facility.category} query={query} /></span>
                                {searchMatch && searchMatch.matchedTags.length > 0 && (
                                  <span className="search-hit-tags" aria-label="タグ一致">
                                    <b>タグ一致</b>
                                    {searchMatch.matchedTags.slice(0, 3).map((tag) => (
                                      <span className="search-hit-tag" key={tag}>#<HighlightedText text={tag} query={query} /></span>
                                    ))}
                                    {searchMatch.matchedTags.length > 3 && (
                                      <small>ほか{searchMatch.matchedTags.length - 3}件</small>
                                    )}
                                  </span>
                                )}
                                {facility.tags.filter((tag) => !searchMatch?.matchedTags.includes(tag)).slice(0, 2).map((tag) => <span className="card-tag" key={tag}>#<HighlightedText text={tag} query={query} /></span>)}
                              </span>
                            </span>
                            <i aria-hidden="true">›</i>
                          </button>
                          <button
                            type="button"
                            className={`favorite-star${facility.favorite ? ' active' : ''}`}
                            onClick={() => void toggleFavorite(facility)}
                            aria-label={facility.favorite ? `${facility.name}をお気に入りから解除` : `${facility.name}をお気に入りに登録`}
                          >
                            {facility.favorite ? '★' : '☆'}
                          </button>
                        </article>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </section>
            ))}
          </div>
        )}
          </>
        )}
      </section>
      <PrimaryBottomNavigation
        active="home"
        onNavigate={(page) => {
          if (page === 'map') resetMapExploration()
          setScreen({ page })
        }}
      />
      {!hasNoSearchResults && (
        <button className="add-button" onClick={() => setScreen({ page: 'edit', facility: emptyFacility(), isNew: true, returnTo: 'home' })}>
          <span>＋</span> 施設を追加
        </button>
      )}
    </main>
  )
}

type PrimaryNavigationPage = 'home' | 'map' | 'relationships'

function PrimaryBottomNavigation({
  active,
  onNavigate,
}: {
  active: PrimaryNavigationPage
  onNavigate: (page: PrimaryNavigationPage) => void
}) {
  const items: Array<{ page: PrimaryNavigationPage; label: string }> = [
    { page: 'home', label: '一覧' },
    { page: 'map', label: 'マップ' },
    { page: 'relationships', label: '関係図' },
  ]

  return (
    <nav className="primary-bottom-nav" aria-label="主要画面">
      {items.map((item) => (
        <button
          type="button"
          key={item.page}
          className={active === item.page ? 'active' : ''}
          aria-current={active === item.page ? 'page' : undefined}
          onClick={() => onNavigate(item.page)}
        >
          <PrimaryNavigationIcon page={item.page} />
          <strong>{item.label}</strong>
        </button>
      ))}
    </nav>
  )
}

function PrimaryNavigationIcon({ page }: { page: PrimaryNavigationPage }) {
  if (page === 'relationships') {
    return (
      <svg
        className="primary-nav-icon primary-nav-icon-relationships"
        viewBox="0 0 24 24"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <path d="M12 5 5 18M12 5l7 13M5 18h14" />
        <circle cx="12" cy="5" r="2.5" />
        <circle cx="5" cy="18" r="2.5" />
        <circle cx="19" cy="18" r="2.5" />
      </svg>
    )
  }

  return (
    <span className={`primary-nav-icon primary-nav-icon-${page}`} aria-hidden="true">
      {page === 'home' ? '⌂' : '⌖'}
    </span>
  )
}

function ParkMap({
  facilities,
  filterSettings,
  initialState,
  onFilterSettingsChange,
  onBack,
  onOpenFacility,
}: {
  facilities: Facility[]
  filterSettings: MapFilterSettings
  initialState: MapReturnState | null
  onFilterSettingsChange: (settings: MapFilterSettings) => void
  onBack: () => void
  onOpenFacility: (facility: Facility, state: MapReturnState) => void
}) {
  const [park, setPark] = useState<Park>(initialState?.park ?? '東京ディズニーランド')
  const [selectedId, setSelectedId] = useState<string | null>(initialState?.selectedFacilityId ?? null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const mapViewRef = useRef<MapViewState | null>(initialState
    ? {
        park: initialState.park,
        center: initialState.center,
        zoom: initialState.zoom,
        bearing: initialState.bearing,
        pitch: initialState.pitch,
      }
    : null)

  useEffect(() => {
    if (!initialState?.scrollY) return
    const frame = requestAnimationFrame(() => window.scrollTo({ top: initialState.scrollY, behavior: 'instant' }))
    return () => cancelAnimationFrame(frame)
  }, [initialState])
  useEffect(() => {
    if (!filtersOpen) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFiltersOpen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [filtersOpen])
  const registeredFacilities = useMemo(
    () => facilities.filter(
      (facility) => facility.park === park && facility.latitude !== null && facility.longitude !== null,
    ),
    [facilities, park],
  )
  const mappedFacilities = useMemo(
    () => registeredFacilities.filter((facility) => filterSettings.visibleCategories.includes(facility.category)),
    [registeredFacilities, filterSettings.visibleCategories],
  )
  const categoryCounts = useMemo(() => new Map(CATEGORY_DEFINITIONS.map((category) => [
    category.value,
    registeredFacilities.filter((facility) => facility.category === category.value).length,
  ])), [registeredFacilities])
  const activeFilterCount = CATEGORY_DEFINITIONS.length - filterSettings.visibleCategories.length
  const updateVisibleCategories = (visibleCategories: Category[]) => {
    onFilterSettingsChange({ ...filterSettings, visibleCategories })
    const selectedFacility = registeredFacilities.find((facility) => facility.id === selectedId)
    if (selectedId && (!selectedFacility || !visibleCategories.includes(selectedFacility.category))) {
      setSelectedId(null)
    }
  }
  const toggleCategory = (category: Category) => {
    updateVisibleCategories(filterSettings.visibleCategories.includes(category)
      ? filterSettings.visibleCategories.filter((value) => value !== category)
      : [...filterSettings.visibleCategories, category])
  }
  const changePark = (nextPark: Park) => {
    mapViewRef.current = null
    setPark(nextPark)
    setSelectedId(null)
  }
  const openFacilityFromMap = useCallback((facility: Facility) => {
    const center = parkCenters[park]
    const currentView = mapViewRef.current ?? {
      park,
      center: [center[1], center[0]] as [number, number],
      zoom: 16.5,
      bearing: parkBearings[park],
      pitch: 0,
    }
    onOpenFacility(facility, {
      ...currentView,
      park,
      selectedFacilityId: facility.id,
      scrollY: window.scrollY,
    })
  }, [onOpenFacility, park])

  return (
    <main className="app-shell map-page screen-enter">
      <header className="detail-header">
        <button className="back-button" onClick={onBack} aria-label="ホームに戻る">‹</button>
        <div><p className="eyebrow">PARK MAP</p><h1>園内マップ</h1></div>
      </header>
      <div className="map-content">
        <div className="map-toolbar">
          <div className="park-switch" role="group" aria-label="パークを切り替え">
            {parks.map((item) => (
              <button type="button" className={park === item ? 'active' : ''} key={item} onClick={() => changePark(item)}>
                {item === '東京ディズニーランド' ? 'ランド' : 'シー'}
              </button>
            ))}
          </div>
          <button type="button" className={`map-filter-button${activeFilterCount ? ' active' : ''}`} onClick={() => setFiltersOpen(true)}>
            <span aria-hidden="true">≡</span> 絞り込み
            {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
          </button>
        </div>

        <div className="map-count-status" aria-live="polite">
          <span>表示中 <strong>{mappedFacilities.length}件</strong>／登録{registeredFacilities.length}件</span>
          {activeFilterCount > 0 && <button type="button" onClick={() => updateVisibleCategories(CATEGORY_DEFINITIONS.map((category) => category.value))}>絞り込みを解除</button>}
        </div>

        <LeafletCanvas
          park={park}
          facilities={mappedFacilities}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpenFacility={openFacilityFromMap}
          mapViewRef={mapViewRef}
        />

        {registeredFacilities.length === 0 && (
          <p className="map-empty">このパークには位置を設定した施設がまだありません。施設の編集画面で実際の地図をタップして設定できます。</p>
        )}
        {registeredFacilities.length > 0 && mappedFacilities.length === 0 && (
          <p className="map-empty">現在の絞り込み条件では表示できる施設がありません。「絞り込み」からカテゴリを選択してください。</p>
        )}
      </div>

      {filtersOpen && (
        <div className="map-filter-backdrop" role="presentation" onClick={() => setFiltersOpen(false)}>
          <section className="map-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="map-filter-title" onClick={(event) => event.stopPropagation()}>
            <div className="map-filter-sheet-handle" aria-hidden="true" />
            <header>
              <div><p className="eyebrow">MAP FILTER</p><h2 id="map-filter-title">表示するカテゴリ</h2></div>
              <button type="button" onClick={() => setFiltersOpen(false)} aria-label="絞り込みを閉じる">×</button>
            </header>
            <div className="map-filter-actions">
              <button type="button" onClick={() => updateVisibleCategories(CATEGORY_DEFINITIONS.map((category) => category.value))}>すべて表示</button>
              <button type="button" onClick={() => updateVisibleCategories([])}>すべて解除</button>
            </div>
            <div className="map-category-filter-grid">
              {CATEGORY_DEFINITIONS.map((category) => {
                const count = categoryCounts.get(category.value) ?? 0
                const selected = filterSettings.visibleCategories.includes(category.value)
                return (
                  <button
                    type="button"
                    key={category.id}
                    className={selected ? 'selected' : ''}
                    disabled={count === 0}
                    onClick={() => toggleCategory(category.value)}
                    aria-pressed={selected}
                  >
                    <span aria-hidden="true">{category.icon}</span>
                    <strong>{category.label}</strong>
                    <small>{count}件</small>
                    <b aria-hidden="true">{selected ? '✓' : ''}</b>
                  </button>
                )
              })}
            </div>
            <p className="map-filter-future-note">将来、プロップス・トリビア・隠れミッキー・撮影ポイントもここへ追加できます。</p>
            <button type="button" className="map-filter-done" onClick={() => setFiltersOpen(false)}>この条件で表示</button>
          </section>
        </div>
      )}
    </main>
  )
}

const parkCenters: Record<Park, [number, number]> = {
  東京ディズニーランド: [35.6329, 139.8804],
  東京ディズニーシー: [35.6267, 139.8851],
}

const parkBearings: Record<Park, number> = {
  東京ディズニーランド: 157,
  東京ディズニーシー: -101,
}

const parkEntrances: Record<Park, [number, number]> = {
  東京ディズニーランド: [35.63506, 139.87923],
  東京ディズニーシー: [35.62745, 139.88957],
}

const createSharedMapMarker = ({
  interactive,
  favorite = false,
  active = false,
  label,
  category,
}: {
  interactive: boolean
  favorite?: boolean
  active?: boolean
  label?: string
  category?: Category
}) => {
  const markerElement = document.createElement('div')
  markerElement.className = 'map-coordinate-marker'
  const pinElement = document.createElement(interactive ? 'button' : 'span')
  if (pinElement instanceof HTMLButtonElement) pinElement.type = 'button'
  pinElement.className = `map-coordinate-pin${favorite ? ' favorite' : ''}${active ? ' active' : ''}`
  if (label) pinElement.setAttribute('aria-label', label)
  if (category) {
    const definition = getCategoryDefinition(category)
    pinElement.dataset.categoryId = definition.id
    const iconElement = document.createElement('span')
    iconElement.className = 'map-pin-category-icon'
    iconElement.textContent = definition.icon
    iconElement.setAttribute('aria-hidden', 'true')
    pinElement.appendChild(iconElement)
  }
  if (favorite) {
    const favoriteElement = document.createElement('span')
    favoriteElement.className = 'map-pin-favorite-star'
    favoriteElement.textContent = '★'
    favoriteElement.setAttribute('aria-hidden', 'true')
    pinElement.appendChild(favoriteElement)
  }
  markerElement.appendChild(pinElement)
  return { markerElement, pinElement }
}

type MapDiagnosticMarker = {
  facilityId: string
  facilityName: string
  latitude: number
  longitude: number
  element: HTMLElement
}

type MapDiagnosticEntry = {
  instanceId: string
  mode: 'park' | 'editor'
  map: maplibregl.Map
  container: HTMLDivElement
  markers: Map<string, MapDiagnosticMarker>
}

const mapDiagnosticRegistry = new Map<string, MapDiagnosticEntry>()
let mapDiagnosticSequence = 0

const diagnosticWindow = window as typeof window & {
  __TDR_MAP_DEBUG__?: { maps: Map<string, MapDiagnosticEntry> }
}
diagnosticWindow.__TDR_MAP_DEBUG__ = { maps: mapDiagnosticRegistry }

function LeafletCanvas({
  park,
  facilities = [],
  selectedId,
  onSelect,
  onOpenFacility,
  position,
  onPositionChange,
  mapViewRef: sharedMapViewRef,
  compact = false,
}: {
  park: Park
  facilities?: Facility[]
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  onOpenFacility?: (facility: Facility) => void
  position?: { latitude: number; longitude: number } | null
  onPositionChange?: (latitude: number, longitude: number) => void
  mapViewRef?: { current: MapViewState | null }
  compact?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const internalMapViewRef = useRef<MapViewState | null>(null)
  const mapViewRef = sharedMapViewRef ?? internalMapViewRef

  useEffect(() => {
    if (!containerRef.current) return
    const instanceId = `tdr-map-${++mapDiagnosticSequence}`
    const mode = position ? 'editor' : 'park'
    const center = parkCenters[park]
    const preservedView = !position && mapViewRef.current?.park === park ? mapViewRef.current : null
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: position
        ? [position.longitude, position.latitude]
        : preservedView?.center ?? [center[1], center[0]],
      zoom: position ? 18 : preservedView?.zoom ?? 16.5,
      bearing: preservedView?.bearing ?? parkBearings[park],
      pitch: preservedView?.pitch ?? 0,
      dragPan: true,
      dragRotate: false,
      touchZoomRotate: true,
      doubleClickZoom: true,
      scrollZoom: true,
      attributionControl: false,
    })
    map.touchZoomRotate.enable()
    map.touchZoomRotate.disableRotation()
    const diagnosticEntry: MapDiagnosticEntry = {
      instanceId,
      mode,
      map,
      container: containerRef.current,
      markers: new Map(),
    }
    mapDiagnosticRegistry.set(instanceId, diagnosticEntry)
    containerRef.current.dataset.mapInstanceId = instanceId
    containerRef.current.dataset.mapMode = mode
    const isTouchDevice = navigator.maxTouchPoints > 0
      || window.matchMedia('(hover: none) and (pointer: coarse)').matches
    if (!isTouchDevice) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    }
    map.addControl(new maplibregl.AttributionControl({
      compact: true,
      customAttribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a> · OpenFreeMap',
    }))
    if (!position) {
      const entrance = parkEntrances[park]
      const entranceElement = document.createElement('span')
      entranceElement.className = 'map-entrance-marker'
      entranceElement.textContent = 'ENTRANCE'
      new maplibregl.Marker({ element: entranceElement, rotationAlignment: 'viewport' })
        .setLngLat([entrance[1], entrance[0]])
        .addTo(map)
      map.once('load', () => {
        if (!preservedView) {
          map.easeTo({
            center: [entrance[1], entrance[0]],
            bearing: parkBearings[park],
            offset: [0, containerRef.current ? containerRef.current.clientHeight * 0.36 : 180],
            duration: 0,
          })
        }
        map.resize()
      })
    }

    let activePopup: maplibregl.Popup | null = null
    let activePin: HTMLElement | null = null
    let popupFitFrame = 0
    const getPopupAnchor = (longitude: number, latitude: number) => {
      const point = map.project([longitude, latitude])
      const width = containerRef.current?.clientWidth ?? 0
      const height = containerRef.current?.clientHeight ?? 0
      const horizontal = point.x < width * 0.3 ? 'left' : point.x > width * 0.7 ? 'right' : ''
      const vertical = point.y < height * 0.34 ? 'top' : point.y > height * 0.66 ? 'bottom' : ''

      if (vertical && horizontal) return `${vertical}-${horizontal}` as const
      if (vertical) return vertical
      if (horizontal) return horizontal
      return 'bottom' as const
    }
    const fitPopupWithinMap = (popupElement: HTMLElement) => {
      cancelAnimationFrame(popupFitFrame)
      popupFitFrame = requestAnimationFrame(() => {
        popupFitFrame = requestAnimationFrame(() => {
          const container = containerRef.current
          const popupContainer = popupElement.closest<HTMLElement>('.maplibregl-popup')
          if (!container || !popupContainer || !activePopup) return

          const mapRect = container.getBoundingClientRect()
          const popupRect = popupContainer.getBoundingClientRect()
          const sidePadding = 16
          const topPadding = 16
          const bottomPadding = 28
          const leftLimit = mapRect.left + sidePadding
          const rightLimit = mapRect.right - sidePadding
          const topLimit = mapRect.top + topPadding
          const bottomLimit = mapRect.bottom - bottomPadding
          let panX = 0
          let panY = 0

          if (popupRect.left < leftLimit) panX = popupRect.left - leftLimit
          else if (popupRect.right > rightLimit) panX = popupRect.right - rightLimit
          if (popupRect.top < topLimit) panY = popupRect.top - topLimit
          else if (popupRect.bottom > bottomLimit) panY = popupRect.bottom - bottomLimit

          if (panX !== 0 || panY !== 0) {
            map.panBy([panX, panY], { duration: 180 })
          }
        })
      })
    }
    const closePopupIfMarkerIsOutside = () => {
      const container = containerRef.current
      if (!container || !activePin || !activePopup) return

      const mapRect = container.getBoundingClientRect()
      const markerRect = activePin.getBoundingClientRect()
      const markerIsOutside = markerRect.right <= mapRect.left
        || markerRect.left >= mapRect.right
        || markerRect.bottom <= mapRect.top
        || markerRect.top >= mapRect.bottom

      if (markerIsOutside) activePopup.remove()
    }
    facilities.forEach((facility) => {
      if (facility.latitude === null || facility.longitude === null) return
      const latitude = facility.latitude
      const longitude = facility.longitude
      const { markerElement, pinElement } = createSharedMapMarker({
        interactive: true,
        favorite: facility.favorite,
        active: selectedId === facility.id,
        label: `${facility.name}のピン`,
        category: facility.category,
      })
      markerElement.dataset.facilityId = facility.id
      markerElement.dataset.markerKind = 'facility'
      markerElement.dataset.categoryId = getCategoryDefinition(facility.category).id

      const popupElement = document.createElement('article')
      popupElement.className = 'map-facility-popup'
      if (facility.photos[0]) {
        const imageElement = document.createElement('img')
        imageElement.src = facility.photos[0].dataUrl
        imageElement.alt = facility.photos[0].title || `${facility.name}の写真`
        popupElement.appendChild(imageElement)
      } else {
        const emptyElement = document.createElement('span')
        emptyElement.className = 'map-facility-popup-empty'
        emptyElement.textContent = getCategoryDefinition(facility.category).icon
        emptyElement.setAttribute('aria-label', '写真なし')
        popupElement.appendChild(emptyElement)
      }
      const textElement = document.createElement('span')
      textElement.className = 'map-facility-popup-text'
      const nameElement = document.createElement('strong')
      nameElement.textContent = facility.name
      const areaElement = document.createElement('small')
      areaElement.textContent = facility.area || 'エリア未設定'
      const categoryElement = document.createElement('small')
      const category = getCategoryDefinition(facility.category)
      categoryElement.textContent = `${category.icon} ${category.label}${facility.favorite ? '　★ お気に入り' : ''}`
      const detailButton = document.createElement('button')
      detailButton.type = 'button'
      detailButton.textContent = '詳細を開く'
      detailButton.setAttribute('aria-label', `${facility.name}の詳細を開く`)
      detailButton.onclick = (event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpenFacility?.(facility)
      }
      textElement.append(nameElement, areaElement, categoryElement, detailButton)
      popupElement.appendChild(textElement)

      new maplibregl.Marker({
        element: markerElement,
        anchor: 'bottom',
        rotationAlignment: 'viewport',
      })
        .setLngLat([longitude, latitude])
        .addTo(map)
      diagnosticEntry.markers.set(facility.id, {
        facilityId: facility.id,
        facilityName: facility.name,
        latitude,
        longitude,
        element: markerElement,
      })
      pinElement.onclick = (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (activePin === pinElement && activePopup) {
          activePopup.remove()
          return
        }
        activePopup?.remove()
        containerRef.current?.querySelectorAll('.map-coordinate-pin.active').forEach((element) => element.classList.remove('active'))
        pinElement.classList.add('active')
        activePin = pinElement
        const popupMaxWidth = Math.max(210, Math.min(270, (containerRef.current?.clientWidth ?? 302) - 32))
        activePopup = new maplibregl.Popup({
          offset: 38,
          anchor: getPopupAnchor(longitude, latitude),
          closeButton: false,
          closeOnClick: true,
          focusAfterOpen: false,
          maxWidth: `${popupMaxWidth}px`,
        })
          .setLngLat([longitude, latitude])
          .setDOMContent(popupElement)
          .addTo(map)
        fitPopupWithinMap(popupElement)
        activePopup.on('close', () => {
          cancelAnimationFrame(popupFitFrame)
          pinElement.classList.remove('active')
          if (activePin === pinElement) {
            activePin = null
            activePopup = null
            onSelect?.(null)
          }
        })
        onSelect?.(facility.id)
      }
    })

    if (!position && selectedId) {
      map.once('load', () => {
        const selectedMarker = [...(containerRef.current?.querySelectorAll<HTMLElement>(
          '.maplibregl-marker[data-facility-id]',
        ) ?? [])].find((element) => element.dataset.facilityId === selectedId)
        selectedMarker?.querySelector<HTMLElement>('.map-coordinate-pin')?.click()
      })
    }

    if (position) {
      const { markerElement } = createSharedMapMarker({ interactive: false })
      markerElement.dataset.facilityId = '__editor__'
      markerElement.dataset.markerKind = 'editor'
      new maplibregl.Marker({ element: markerElement, anchor: 'bottom', rotationAlignment: 'viewport' })
        .setLngLat([position.longitude, position.latitude])
        .addTo(map)
      diagnosticEntry.markers.set('__editor__', {
        facilityId: '__editor__',
        facilityName: 'editor-position',
        latitude: position.latitude,
        longitude: position.longitude,
        element: markerElement,
      })
    }
    if (onPositionChange) {
      map.on('click', (event) => {
        onPositionChange(
          roundMapCoordinate(event.lngLat.lat),
          roundMapCoordinate(event.lngLat.lng),
        )
      })
    }
    const recordDiagnostics = () => {
      const mapRect = diagnosticEntry.container.getBoundingClientRect()
      const markerMeasurements = [...diagnosticEntry.markers.values()].map((marker) => {
        const expected = map.project([marker.longitude, marker.latitude])
        const markerRect = marker.element.getBoundingClientRect()
        const actual = {
          x: markerRect.left - mapRect.left + markerRect.width / 2,
          y: markerRect.bottom - mapRect.top,
        }
        return {
          facilityId: marker.facilityId,
          facilityName: marker.facilityName,
          latitude: marker.latitude,
          longitude: marker.longitude,
          markerLngLat: [marker.longitude, marker.latitude],
          expected: { x: expected.x, y: expected.y },
          actual,
          delta: { x: actual.x - expected.x, y: actual.y - expected.y },
          markerRect: {
            left: markerRect.left,
            top: markerRect.top,
            width: markerRect.width,
            height: markerRect.height,
          },
          markerStyle: {
            position: getComputedStyle(marker.element).position,
            transform: getComputedStyle(marker.element).transform,
            left: getComputedStyle(marker.element).left,
            top: getComputedStyle(marker.element).top,
          },
        }
      })
      const centerNow = map.getCenter()
      const measurement = {
        instanceId,
        mode,
        center: { lng: centerNow.lng, lat: centerNow.lat },
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        mapRect: { left: mapRect.left, top: mapRect.top, width: mapRect.width, height: mapRect.height },
        markers: markerMeasurements,
      }
      diagnosticEntry.container.dataset.mapDiagnostic = JSON.stringify(measurement)
      console.info('[TDR map diagnostic]', measurement)
    }
    map.on('idle', recordDiagnostics)
    map.on('moveend', () => {
      const currentCenter = map.getCenter()
      if (!position) {
        mapViewRef.current = {
          park,
          center: [currentCenter.lng, currentCenter.lat],
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        }
      }
      recordDiagnostics()
      closePopupIfMarkerIsOutside()
    })
    let resizeFrame = 0
    const resizeMap = () => {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => map.resize())
    }
    const resizeObserver = new ResizeObserver(resizeMap)
    resizeObserver.observe(containerRef.current)
    window.addEventListener('orientationchange', resizeMap)
    window.visualViewport?.addEventListener('resize', resizeMap)
    map.once('load', resizeMap)
    return () => {
      activePopup?.remove()
      mapDiagnosticRegistry.delete(instanceId)
      cancelAnimationFrame(popupFitFrame)
      cancelAnimationFrame(resizeFrame)
      resizeObserver.disconnect()
      window.removeEventListener('orientationchange', resizeMap)
      window.visualViewport?.removeEventListener('resize', resizeMap)
      map.remove()
    }
  }, [park, facilities, onSelect, onOpenFacility, position, onPositionChange])

  return <div ref={containerRef} className={`leaflet-map${compact ? ' compact' : ''}`} />
}

function FacilityView({
  facility,
  allFacilities,
  onBack,
  onEdit,
  onToggleFavorite,
  onOpenFacility,
  onSelectTag,
}: {
  facility: Facility
  allFacilities: Facility[]
  onBack: () => void
  onEdit: () => void
  onToggleFavorite: () => void
  onOpenFacility: (facility: Facility) => void
  onSelectTag: (tag: string) => void
}) {
  const [tagsExpanded, setTagsExpanded] = useState(false)
  const category = getCategoryDefinition(facility.category)
  const relatedFacilities = getBidirectionalRelatedFacilities(allFacilities, facility.id)
  const primaryTags = facility.tags.slice(0, 5)
  const additionalTags = facility.tags.slice(5)
  const tableOfContents = [
    { id: 'overview', label: '概要', visible: true },
    { id: 'bgs', label: 'BGS', visible: facility.bgs.length > 0 },
    { id: 'trivia', label: 'トリビア', visible: facility.trivia.length > 0 },
    { id: 'props', label: 'プロップス', visible: facility.props.length > 0 },
    { id: 'related', label: '関連項目', visible: relatedFacilities.length > 0 },
    { id: 'photos', label: '写真', visible: facility.photos.length > 0 },
  ].filter((item) => item.visible)

  return (
    <main className="app-shell view-page screen-enter">
      <header className="detail-header view-header">
        <button className="back-button" onClick={onBack} aria-label="施設一覧に戻る">‹</button>
        <div className="view-header-copy">
          <p className="eyebrow">{category.englishLabel}</p>
          <h1>{facility.name}</h1>
          <p className="view-subtitle">{facility.park} · {facility.area || 'エリア未設定'}</p>
          <span className="view-category"><span aria-hidden="true">{category.icon}</span>{category.label}</span>
        </div>
        <button
          type="button"
          className={`detail-favorite${facility.favorite ? ' active' : ''}`}
          onClick={onToggleFavorite}
          aria-label={facility.favorite ? 'お気に入りから解除' : 'お気に入りに登録'}
        >
          {facility.favorite ? '★' : '☆'}
        </button>
      </header>

      <div className="view-content">
        <section id="photos" className="detail-gallery-section" aria-label="施設写真">
          <DetailPhotoGallery photos={facility.photos} facilityName={facility.name} categoryIcon={category.icon} />
        </section>

        {facility.tags.length > 0 && (
          <div className="detail-tags" aria-label="タグ">
            <div className="tag-list">
              {primaryTags.map((tag) => <button type="button" key={tag} onClick={() => onSelectTag(tag)}>#{tag}</button>)}
            </div>
            <AnimatedCollapse id={`facility-extra-tags-${facility.id}`} open={tagsExpanded} className="detail-extra-tags">
              <div className="tag-list">
                {additionalTags.map((tag) => <button type="button" key={tag} onClick={() => onSelectTag(tag)}>#{tag}</button>)}
              </div>
            </AnimatedCollapse>
            {facility.tags.length > 5 && (
              <button
                type="button"
                className="tags-expand-button"
                onClick={() => setTagsExpanded((current) => !current)}
                aria-expanded={tagsExpanded}
                aria-controls={`facility-extra-tags-${facility.id}`}
              >
                {tagsExpanded ? '閉じる' : `すべて表示（${facility.tags.length}）`}
              </button>
            )}
          </div>
        )}

        <nav className="detail-toc" aria-label="ページ内目次">
          {tableOfContents.map((item) => <a href={`#${item.id}`} key={item.id}>{item.label}</a>)}
        </nav>

        <section id="overview" className="view-section">
          <div className="view-section-heading"><span aria-hidden="true">01</span><h2>概要・基本情報</h2></div>
          <dl className="basic-info-card">
            <div><dt>パーク</dt><dd>{facility.park}</dd></div>
            <div><dt>エリア</dt><dd>{facility.area || '未設定'}</dd></div>
            <div><dt>カテゴリ</dt><dd><span aria-hidden="true">{category.icon}</span> {category.label}</dd></div>
            <div><dt>登録日</dt><dd>{formatArchiveDate(facility.createdAt)}</dd></div>
            <div><dt>更新日</dt><dd>{formatArchiveDate(facility.updatedAt)}</dd></div>
          </dl>
          {facility.notes && <article className="view-card overview-note"><h3>メモ</h3><p>{facility.notes}</p></article>}
          <CategorySpecificDetails facility={facility} />
        </section>

        <ReadOnlyTextSection id="bgs" title="BGS" entries={facility.bgs} numbered />
        <ReadOnlyTextSection id="trivia" title="トリビア" entries={facility.trivia} />

        {facility.props.length > 0 && (
          <section id="props" className="view-section">
            <div className="view-section-heading"><span aria-hidden="true">04</span><h2>プロップス</h2></div>
            <div className="prop-view-list">
              {facility.props.map((prop) => (
                <article className="prop-view-card" key={prop.id}>
                  {prop.photos[0] ? (
                    <img src={prop.photos[0].dataUrl} alt={prop.photos[0].title || prop.title || 'プロップスの写真'} />
                  ) : (
                    <span className="prop-placeholder" aria-hidden="true">◇</span>
                  )}
                  <div>
                    <h3>{prop.title || 'タイトル未設定'}</h3>
                    {prop.location && <p className="prop-location">場所：{prop.location}</p>}
                    {prop.description && <p>{prop.description}</p>}
                    {prop.photos.length > 1 && <ReadOnlyPhotos photos={prop.photos} compact />}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {relatedFacilities.length > 0 && (
          <section id="related" className="view-section">
            <div className="view-section-heading"><span aria-hidden="true">05</span><h2>関連項目</h2></div>
            <div className="related-view-list">
              {relatedFacilities.map((item) => {
                const itemCategory = getCategoryDefinition(item.category)
                return (
                  <article className="related-view-card" key={item.id}>
                    {item.photos[0] ? (
                      <img src={item.photos[0].dataUrl} alt={item.photos[0].title || `${item.name}の写真`} />
                    ) : (
                      <span className="category-placeholder" aria-hidden="true">{itemCategory.icon}</span>
                    )}
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.area || 'エリア未設定'} · {itemCategory.icon} {itemCategory.label}</span>
                    </div>
                    <div className="related-card-actions">
                      <button type="button" onClick={() => onOpenFacility(item)}>詳細</button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        )}
      </div>

      <button className="edit-fab" onClick={onEdit}><span aria-hidden="true">✎</span>この施設を編集</button>
    </main>
  )
}

const formatArchiveDate = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '不明' : new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' }).format(date)
}

const categoryDetailRenderers: Partial<Record<Category, (facility: Facility) => React.ReactNode>> = {
  // 将来、カテゴリ固有の情報カードをここへ追加する。
}

function CategorySpecificDetails({ facility }: { facility: Facility }) {
  return categoryDetailRenderers[facility.category]?.(facility) ?? null
}

function ReadOnlyTextSection({ id, title, entries, numbered = false }: { id: string; title: string; entries: TextEntry[]; numbered?: boolean }) {
  if (entries.length === 0) return null
  return (
    <section id={id} className={`view-section text-view-section ${title === 'BGS' ? 'bgs-section' : ''}`}>
      <div className="view-section-heading"><span aria-hidden="true">{title === 'BGS' ? '02' : '03'}</span><h2>{title}</h2></div>
      <div className="view-card-list">
        {entries.map((entry, index) => (
          <article className="view-card text-entry-card" key={entry.id}>
            {(numbered || entries.length > 1) && <h3>{title} {index + 1}</h3>}
            <p>{entry.text}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function DetailPhotoGallery({
  photos,
  facilityName,
  categoryIcon,
}: {
  photos: Photo[]
  facilityName: string
  categoryIcon: string
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = photos.find((photo) => photo.id === selectedId)
  if (photos.length === 0) {
    return <div className="detail-photo-placeholder"><span aria-hidden="true">{categoryIcon}</span><strong>写真はまだありません</strong></div>
  }
  const mainPhoto = photos[0]
  return (
    <>
      <button type="button" className="detail-main-photo" onClick={() => setSelectedId(mainPhoto.id)} aria-label={`${facilityName}のメイン写真を拡大`}>
        <img src={mainPhoto.dataUrl} alt={mainPhoto.title || `${facilityName}の写真`} />
        <span>拡大して見る</span>
      </button>
      {(mainPhoto.title || mainPhoto.description || mainPhoto.location) && (
        <div className="main-photo-caption">
          {mainPhoto.title && <strong>{mainPhoto.title}</strong>}
          {mainPhoto.location && <small>撮影場所：{mainPhoto.location}</small>}
          {mainPhoto.description && <p>{mainPhoto.description}</p>}
        </div>
      )}
      {photos.length > 1 && (
        <div className="detail-photo-strip" aria-label="その他の写真">
          {photos.map((photo) => (
            <button type="button" key={photo.id} onClick={() => setSelectedId(photo.id)}>
              <img src={photo.dataUrl} alt={photo.title || photo.name} />
              {photo.title && <span>{photo.title}</span>}
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label="写真の拡大表示" onClick={() => setSelectedId(null)}>
          <button type="button" className="lightbox-close" onClick={() => setSelectedId(null)} aria-label="閉じる">×</button>
          <div className="lightbox-content" onClick={(event) => event.stopPropagation()}>
            <img src={selected.dataUrl} alt={selected.title || selected.name} />
            {(selected.title || selected.description || selected.location) && (
              <div>
                <strong>{selected.title}</strong>
                {selected.location && <small>撮影場所：{selected.location}</small>}
                <p>{selected.description}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function ReadOnlyPhotos({ photos, compact = false }: { photos: Photo[]; compact?: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = photos.find((photo) => photo.id === selectedId)
  return (
    <>
      <div className={`readonly-photo-grid${compact ? ' compact' : ''}`}>
        {photos.map((photo) => (
          <button type="button" key={photo.id} onClick={() => setSelectedId(photo.id)}>
            <img src={photo.dataUrl} alt={photo.title || photo.name} />
            {photo.title && <span>{photo.title}</span>}
          </button>
        ))}
      </div>
      {selected && (
        <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label="写真の拡大表示" onClick={() => setSelectedId(null)}>
          <button type="button" className="lightbox-close" onClick={() => setSelectedId(null)} aria-label="閉じる">×</button>
          <div className="lightbox-content" onClick={(event) => event.stopPropagation()}>
            <img src={selected.dataUrl} alt={selected.title || selected.name} />
            {(selected.title || selected.description || selected.location) && (
              <div>
                <strong>{selected.title}</strong>
                {selected.location && <small>撮影場所：{selected.location}</small>}
                <p>{selected.description}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

type FacilityDetailProps = {
  initialFacility: Facility
  allFacilities: Facility[]
  isNew: boolean
  onBack: () => void
  onSave: (facility: Facility) => Promise<void>
  onDelete: (facility: Facility) => Promise<void>
}

function FacilityDetail({ initialFacility, allFacilities, isNew, onBack, onSave, onDelete }: FacilityDetailProps) {
  const [facility, setFacility] = useState(initialFacility)
  const [saving, setSaving] = useState(false)
  const bidirectionalRelatedIds = new Set([
    ...getBidirectionalRelatedFacilityIds(allFacilities, facility.id),
    ...facility.relatedFacilityIds,
  ])
  const update = <K extends keyof Facility>(key: K, value: Facility[K]) => setFacility((current) => ({ ...current, [key]: value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!facility.name.trim()) return
    const validFacilityIds = new Set(allFacilities.map((item) => item.id))
    const relatedFacilityIds = [...new Set(facility.relatedFacilityIds)]
      .filter((id) => id !== facility.id && validFacilityIds.has(id))
    setSaving(true)
    await onSave({
      ...facility,
      name: facility.name.trim(),
      area: facility.area.trim(),
      relatedFacilityIds,
    })
  }

  const toggleRelated = (id: string) => {
    setFacility((current) => ({
      ...current,
      relatedFacilityIds: current.relatedFacilityIds.includes(id)
        ? current.relatedFacilityIds.filter((value) => value !== id)
        : [...current.relatedFacilityIds, id],
    }))
  }

  return (
    <main className="app-shell detail-page screen-enter">
      <header className="detail-header">
        <button className="back-button" onClick={onBack} aria-label="施設一覧に戻る">‹</button>
        <div><p className="eyebrow">{isNew ? 'NEW FACILITY' : 'FACILITY DETAIL'}</p><h1>{isNew ? '施設を追加' : facility.name}</h1></div>
      </header>
      <form className="detail-form" onSubmit={submit}>
        <section className="form-section">
          <h2>基本情報</h2>
          <div className="field-grid">
            <label><span>タイトル <b>必須</b></span><input value={facility.name} onChange={(e) => update('name', e.target.value)} required /></label>
            <label><span>エリア</span><input value={facility.area} onChange={(e) => update('area', e.target.value)} placeholder="例：アドベンチャーランド" /></label>
          </div>
          <fieldset>
            <legend>カテゴリ</legend>
            <div className="category-options">
              {CATEGORY_DEFINITIONS.map((category) => (
                <label key={category.id}>
                  <input type="radio" name="category" checked={facility.category === category.value} onChange={() => update('category', category.value)} />
                  <span><b aria-hidden="true">{category.icon}</b>{category.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <MapCoordinateEditor
          park={facility.park}
          latitude={facility.latitude}
          longitude={facility.longitude}
          onParkChange={(park) => update('park', park)}
          onChange={(latitude, longitude) => setFacility((current) => ({ ...current, latitude, longitude }))}
        />

        <MultiTextEditor label="BGS" hint="背景にある物語や設定" entries={facility.bgs} onChange={(value) => update('bgs', value)} />
        <MultiTextEditor label="トリビア" hint="小ネタや豆知識" entries={facility.trivia} onChange={(value) => update('trivia', value)} />
        <PropsEditor props={facility.props} onChange={(value) => update('props', value)} />

        <section className="form-section">
          <h2>タグ</h2>
          <label><span>複数のタグは読点またはカンマで区切ります</span>
            <input value={facility.tags.join('、')} onChange={(event) => update('tags', event.target.value.split(/[、,]/).map((tag) => tag.trim()).filter(Boolean))} placeholder="例：隠れミッキー、看板、要再訪" />
          </label>
        </section>

        <section className="form-section">
          <h2>関連項目</h2>
          <div className="related-list">
            {allFacilities.filter((item) => item.id !== facility.id).length === 0 && <p className="field-note">関連付けできる他の施設がまだありません。</p>}
            {allFacilities.filter((item) => item.id !== facility.id).map((item) => (
              <label className="check-row" key={item.id}>
                <input
                  type="checkbox"
                  checked={bidirectionalRelatedIds.has(item.id)}
                  disabled={bidirectionalRelatedIds.has(item.id) && !facility.relatedFacilityIds.includes(item.id)}
                  onChange={() => toggleRelated(item.id)}
                />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.area}{bidirectionalRelatedIds.has(item.id) && !facility.relatedFacilityIds.includes(item.id) ? ' · 相手側から関連済み' : ''}</small>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="form-section">
          <h2>写真</h2>
          <PhotoEditor photos={facility.photos} onChange={(value) => update('photos', value)} />
        </section>

        <section className="form-section">
          <h2>概要</h2>
          <label><span>この項目の概要</span><textarea value={facility.notes} onChange={(event) => update('notes', event.target.value)} rows={4} /></label>
        </section>

        <div className="form-actions">
          {!isNew && <button type="button" className="delete-button" onClick={() => onDelete(facility)}>削除</button>}
          <button type="submit" className="save-button" disabled={saving || !facility.name.trim()}>{saving ? '保存中…' : '保存する'}</button>
        </div>
      </form>
    </main>
  )
}

function MapCoordinateEditor({
  park,
  latitude,
  longitude,
  onParkChange,
  onChange,
}: {
  park: Park
  latitude: number | null
  longitude: number | null
  onParkChange: (park: Park) => void
  onChange: (latitude: number | null, longitude: number | null) => void
}) {
  const updateNumber = (axis: 'latitude' | 'longitude', value: string) => {
    if (value === '') {
      onChange(null, null)
      return
    }
    const number = Number(value)
    const center = parkCenters[park] as [number, number]
    onChange(axis === 'latitude' ? number : (latitude ?? center[0]), axis === 'longitude' ? number : (longitude ?? center[1]))
  }

  return (
    <section className="form-section map-coordinate-section">
      <h2>マップ位置</h2>
      <fieldset>
        <legend>パーク</legend>
        <div className="park-switch">
          {parks.map((item) => (
            <button type="button" className={park === item ? 'active' : ''} key={item} onClick={() => onParkChange(item)}>
              {item === '東京ディズニーランド' ? 'ランド' : 'シー'}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="field-note">実際の地図をタップして施設の位置を設定してください。地図の表示にはインターネット接続が必要です。</p>
      <LeafletCanvas
        park={park}
        compact
        position={latitude !== null && longitude !== null ? { latitude, longitude } : null}
        onPositionChange={(nextLatitude, nextLongitude) => onChange(nextLatitude, nextLongitude)}
      />
      <div className="coordinate-inputs">
        <label><span>緯度</span><input type="number" step="0.000001" min="-90" max="90" value={latitude ?? ''} onChange={(event) => updateNumber('latitude', event.target.value)} /></label>
        <label><span>経度</span><input type="number" step="0.000001" min="-180" max="180" value={longitude ?? ''} onChange={(event) => updateNumber('longitude', event.target.value)} /></label>
      </div>
      {latitude !== null && longitude !== null && <button type="button" className="remove-map-position" onClick={() => onChange(null, null)}>マップ位置を削除</button>}
    </section>
  )
}

function MultiTextEditor({ label, hint, entries, onChange }: { label: string; hint: string; entries: TextEntry[]; onChange: (entries: TextEntry[]) => void }) {
  return (
    <section className="form-section">
      <div className="form-section-title"><h2>{label}</h2><button type="button" className="small-add" onClick={() => onChange([...entries, createTextEntry()])}>＋ 追加</button></div>
      {entries.length === 0 && <p className="field-note">まだ登録されていません。</p>}
      <div className="repeat-list">
        {entries.map((entry, index) => (
          <div className="repeat-item" key={entry.id}>
            <label><span>{label} {index + 1}</span><textarea value={entry.text} onChange={(event) => onChange(entries.map((item) => item.id === entry.id ? { ...item, text: event.target.value } : item))} placeholder={hint} rows={4} /></label>
            <button type="button" className="remove-button" onClick={() => onChange(entries.filter((item) => item.id !== entry.id))}>削除</button>
          </div>
        ))}
      </div>
    </section>
  )
}

function PropsEditor({ props, onChange }: { props: Prop[]; onChange: (props: Prop[]) => void }) {
  const updateProp = (id: string, changes: Partial<Prop>) => onChange(props.map((prop) => prop.id === id ? { ...prop, ...changes } : prop))
  return (
    <section className="form-section">
      <div className="form-section-title"><h2>プロップス</h2><button type="button" className="small-add" onClick={() => onChange([...props, createProp()])}>＋ 追加</button></div>
      {props.length === 0 && <p className="field-note">まだ登録されていません。</p>}
      <div className="repeat-list">
        {props.map((prop, index) => (
          <article className="repeat-item prop-item" key={prop.id}>
            <h3>プロップ {index + 1}</h3>
            <label><span>タイトル</span><input value={prop.title} onChange={(event) => updateProp(prop.id, { title: event.target.value })} /></label>
            <label><span>説明</span><textarea value={prop.description} onChange={(event) => updateProp(prop.id, { description: event.target.value })} rows={4} /></label>
            <label><span>場所</span><input value={prop.location} onChange={(event) => updateProp(prop.id, { location: event.target.value })} /></label>
            <div><span className="field-label">写真</span><PhotoEditor photos={prop.photos} onChange={(photos) => updateProp(prop.id, { photos })} /></div>
            <button type="button" className="remove-button" onClick={() => onChange(props.filter((item) => item.id !== prop.id))}>プロップを削除</button>
          </article>
        ))}
      </div>
    </section>
  )
}

function PhotoEditor({ photos, onChange }: { photos: Photo[]; onChange: (photos: Photo[]) => void }) {
  const [dragging, setDragging] = useState(false)
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null)
  const selectedPhoto = photos.find((photo) => photo.id === selectedPhotoId)

  const addPhotos = async (files: FileList | null) => {
    if (!files) return
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
    const added = await Promise.all(imageFiles.map(fileToPhoto))
    onChange([...photos, ...added])
  }
  const updatePhoto = (id: string, changes: Partial<Photo>) =>
    onChange(photos.map((photo) => photo.id === id ? { ...photo, ...changes } : photo))
  const movePhoto = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= photos.length) return
    const reordered = [...photos]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    onChange(reordered)
  }

  return (
    <div className="photo-editor">
      <div
        className={`photo-drop-zone${dragging ? ' is-dragging' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
        onDragLeave={(event) => {
          event.preventDefault()
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void addPhotos(event.dataTransfer.files)
        }}
      >
        <strong>写真をここにドロップ</strong>
        <span>または</span>
        <label className="photo-add">＋ ファイルを選ぶ<input type="file" accept="image/*" multiple onChange={(event) => { void addPhotos(event.target.files); event.target.value = '' }} /></label>
      </div>
      <div className="photo-grid">
        {photos.map((photo, index) => (
          <article className="photo-card" key={photo.id}>
            <button type="button" className="photo-thumbnail" onClick={() => setSelectedPhotoId(photo.id)} aria-label={`${photo.title || photo.name}を拡大表示`}>
              <img src={photo.dataUrl} alt={photo.title || photo.name} />
              <span>拡大</span>
            </button>
            <label><span>タイトル</span><input value={photo.title} onChange={(event) => updatePhoto(photo.id, { title: event.target.value })} placeholder={photo.name} /></label>
            <label><span>説明</span><textarea value={photo.description} onChange={(event) => updatePhoto(photo.id, { description: event.target.value })} rows={2} placeholder="写真の説明" /></label>
            <label><span>撮影場所</span><input value={photo.location} onChange={(event) => updatePhoto(photo.id, { location: event.target.value })} placeholder="例：入口付近、待ち列" /></label>
            <div className="photo-order-actions">
              <button type="button" disabled={index === 0} onClick={() => movePhoto(index, -1)}>← 前へ</button>
              <span>{index + 1} / {photos.length}</span>
              <button type="button" disabled={index === photos.length - 1} onClick={() => movePhoto(index, 1)}>後ろへ →</button>
            </div>
            <button type="button" className="remove-button" onClick={() => onChange(photos.filter((item) => item.id !== photo.id))}>写真を削除</button>
          </article>
        ))}
      </div>
      {selectedPhoto && (
        <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label="写真の拡大表示" onClick={() => setSelectedPhotoId(null)}>
          <button type="button" className="lightbox-close" onClick={() => setSelectedPhotoId(null)} aria-label="閉じる">×</button>
          <div className="lightbox-content" onClick={(event) => event.stopPropagation()}>
            <img src={selectedPhoto.dataUrl} alt={selectedPhoto.title || selectedPhoto.name} />
            {(selectedPhoto.title || selectedPhoto.description || selectedPhoto.location) && (
              <div>
                <strong>{selectedPhoto.title}</strong>
                {selectedPhoto.location && <small>撮影場所：{selectedPhoto.location}</small>}
                <p>{selectedPhoto.description}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

const fileToPhoto = async (file: File): Promise<Photo> => {
  const dataUrl = await fileToDataUrl(file)
  return {
      id: crypto.randomUUID(),
      name: file.name,
      title: '',
      description: '',
      location: '',
      dataUrl,
      createdAt: new Date().toISOString(),
  }
}
