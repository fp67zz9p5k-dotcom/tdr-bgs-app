import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { Category, Facility, RelationshipGraphSettings } from './types'
import { CATEGORY_DEFINITIONS, getCategoryDefinition, type CategoryId } from './categories'
import {
  getBidirectionalRelatedFacilities,
  getBidirectionalRelatedFacilityIds,
} from './relationships'

const degreeOf = (facility: Facility, facilities: Facility[]) =>
  getBidirectionalRelatedFacilityIds(facilities, facility.id).length

const isCategoryId = (value: string): value is CategoryId =>
  CATEGORY_DEFINITIONS.some((category) => category.id === value)

type RelationshipGraphProps = {
  facilities: Facility[]
  settings: RelationshipGraphSettings
  onSettingsChange: (settings: RelationshipGraphSettings) => void
  onBack: () => void
  onOpenFacility: (facility: Facility) => void
}

function FacilityImage({ facility, className = '' }: { facility: Facility; className?: string }) {
  const photo = facility.photos[0]
  const category = getCategoryDefinition(facility.category)
  return photo
    ? <img className={className} src={photo.dataUrl} alt={photo.title || `${facility.name}の写真`} />
    : <span className={`relationship-placeholder ${className}`} data-category={category.id} aria-label="写真なし"><b aria-hidden="true">{category.icon}</b></span>
}

function CenterRelationshipView({
  facilities,
  center,
  history,
  onSelectCenter,
  onOpenFacility,
  onHistoryBack,
  onClearHistory,
  dockHost,
  useDock,
}: {
  facilities: Facility[]
  center: Facility
  history: string[]
  onSelectCenter: (facility: Facility) => void
  onOpenFacility: (facility: Facility) => void
  onHistoryBack: () => void
  onClearHistory: () => void
  dockHost: HTMLDivElement | null
  useDock: boolean
}) {
  const related = useMemo(
    () => getBidirectionalRelatedFacilities(facilities, center.id),
    [facilities, center.id],
  )
  const groups = useMemo(() => CATEGORY_DEFINITIONS
    .map((category) => ({
      category,
      facilities: related.filter((facility) => facility.category === category.value),
    }))
    .filter((group) => group.facilities.length > 0), [related])
  const [collapsed, setCollapsed] = useState<Set<Category>>(new Set())
  const [activeCategoryId, setActiveCategoryId] = useState<CategoryId | ''>(groups[0]?.category.id ?? '')
  const categoryGroupsRef = useRef<HTMLDivElement>(null)
  const categoryOverviewRef = useRef<HTMLElement>(null)
  const categoryOverviewInteractingRef = useRef(false)
  const categoryOverviewReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setCollapsed(new Set())
    setActiveCategoryId(groups[0]?.category.id ?? '')
  }, [center.id, groups])

  useEffect(() => {
    const container = categoryGroupsRef.current
    if (!container || typeof IntersectionObserver === 'undefined') return
    const sections = [...container.querySelectorAll<HTMLElement>('.relationship-category-group')]
    const scrollRoot = container.closest<HTMLElement>('.relationship-scroll-region')
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top))[0]
      if (visible?.target.id) {
        const categoryId = visible.target.id.replace('relationship-category-', '')
        if (isCategoryId(categoryId)) setActiveCategoryId(categoryId)
      }
    }, { root: scrollRoot, rootMargin: '-32% 0px -58% 0px', threshold: 0 })
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [center.id, groups])

  useEffect(() => {
    const overview = categoryOverviewRef.current
    if (!overview || !activeCategoryId || categoryOverviewInteractingRef.current) return

    const animationFrame = requestAnimationFrame(() => {
      if (categoryOverviewInteractingRef.current) return
      const activeTab = overview.querySelector<HTMLElement>(`[data-category-id="${activeCategoryId}"]`)
      if (!activeTab) return

      const overviewRect = overview.getBoundingClientRect()
      const tabRect = activeTab.getBoundingClientRect()
      const edgeInset = 8
      const isClipped = tabRect.left < overviewRect.left + edgeInset
        || tabRect.right > overviewRect.right - edgeInset
      if (!isClipped) return

      const targetLeft = activeTab.offsetLeft - ((overview.clientWidth - activeTab.offsetWidth) / 2)
      overview.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' })
    })

    return () => cancelAnimationFrame(animationFrame)
  }, [activeCategoryId])

  useEffect(() => () => {
    if (categoryOverviewReleaseTimerRef.current) clearTimeout(categoryOverviewReleaseTimerRef.current)
  }, [])

  const beginCategoryOverviewInteraction = () => {
    if (categoryOverviewReleaseTimerRef.current) clearTimeout(categoryOverviewReleaseTimerRef.current)
    categoryOverviewInteractingRef.current = true
  }
  const endCategoryOverviewInteraction = () => {
    if (categoryOverviewReleaseTimerRef.current) clearTimeout(categoryOverviewReleaseTimerRef.current)
    categoryOverviewReleaseTimerRef.current = setTimeout(() => {
      categoryOverviewInteractingRef.current = false
      categoryOverviewReleaseTimerRef.current = null
    }, 240)
  }

  const openCategoryFromOverview = (category: Category, categoryId: CategoryId) => {
    setCollapsed((current) => {
      if (!current.has(category)) return current
      const next = new Set(current)
      next.delete(category)
      return next
    })
    setActiveCategoryId(categoryId)
    requestAnimationFrame(() => document
      .getElementById(`relationship-category-${categoryId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const density = related.length >= 13 ? 'many' : related.length >= 7 ? 'medium' : 'few'
  const historyFacilities = history
    .map((id) => facilities.find((facility) => facility.id === id))
    .filter((facility): facility is Facility => Boolean(facility))

  const centerSummary = (
    <section className="center-summary" aria-label="直接の関連件数">
      <span>直接の関連 {related.length}件</span>
    </section>
  )
  const centerStage = (
    <div className="center-node-stage">
      <button type="button" className="center-facility-card" key={center.id} onClick={() => onOpenFacility(center)}>
        <FacilityImage facility={center} />
        <span className="center-card-copy">
          <small>{getCategoryDefinition(center.category).englishLabel}</small>
          <strong>{center.name}</strong>
          <span className="center-card-area">{center.area || 'エリア未設定'}</span>
          <span className="center-card-category">{getCategoryDefinition(center.category).icon} {center.category}{center.favorite ? '　★ お気に入り' : ''}</span>
          <span className="center-card-related-count">直接の関連 {related.length}件</span>
        </span>
      </button>
      {groups.length > 0 && (
        <nav
          ref={categoryOverviewRef}
          className="relationship-category-overview"
          aria-label="関連カテゴリ概要"
          onPointerDown={beginCategoryOverviewInteraction}
          onPointerUp={endCategoryOverviewInteraction}
          onPointerCancel={endCategoryOverviewInteraction}
        >
          {groups.map(({ category, facilities: groupFacilities }) => (
            <button
              type="button"
              key={category.id}
              data-category-id={category.id}
              className={`${activeCategoryId === category.id ? 'active ' : ''}${collapsed.has(category.value) ? 'collapsed' : ''}`.trim()}
              aria-current={activeCategoryId === category.id ? 'location' : undefined}
              aria-expanded={!collapsed.has(category.value)}
              onClick={() => openCategoryFromOverview(category.value, category.id)}
            >
              <span aria-hidden="true">{category.icon}</span>
              {category.label} <b>{groupFacilities.length}</b>
            </button>
          ))}
        </nav>
      )}
      {groups.length > 0 && <div className="center-tree-trunk" aria-hidden="true" />}
    </div>
  )

  return (
    <div className={`relationship-center-view density-${density}`}>
      {useDock
        ? dockHost && createPortal(<div className="relationship-center-dock-content">{centerSummary}{centerStage}</div>, dockHost)
        : centerSummary}

      <div className="relationship-center-layout">
        {!useDock && centerStage}

        {groups.length > 0 ? (
          <div className="relationship-branch-scroll" aria-label="カテゴリ別の関連施設">
            <div ref={categoryGroupsRef} className={`relationship-category-groups${groups.length === 1 ? ' single-category' : ''}`}>
              {groups.map(({ category, facilities: groupFacilities }) => {
                const isCollapsed = collapsed.has(category.value)
                return (
                  <section
                    className={`relationship-category-group ${isCollapsed ? 'is-collapsed' : 'is-open'}`}
                    id={`relationship-category-${category.id}`}
                    key={category.id}
                  >
                    <div className={`relationship-group-heading-shell ${isCollapsed ? 'is-collapsed' : 'is-open'}`}>
                      <div className="relationship-group-heading-surface">
                        <button
                          type="button"
                          className="relationship-group-heading"
                          onClick={() => setCollapsed((current) => {
                            setActiveCategoryId(category.id)
                            const next = new Set(current)
                            if (next.has(category.value)) next.delete(category.value)
                            else next.add(category.value)
                            return next
                          })}
                          aria-expanded={!isCollapsed}
                          aria-controls={`relationship-category-content-${category.id}`}
                        >
                          <span className="relationship-category-title">
                            <span className="relationship-category-icon" aria-hidden="true">{category.icon}</span>
                            <strong>{category.label}</strong>
                          </span>
                          <small className="relationship-category-count">（{groupFacilities.length}）</small>
                          <span className="relationship-collapse-icon" aria-hidden="true">
                            {isCollapsed ? '＋' : '−'}
                          </span>
                        </button>
                      </div>
                    </div>
                    <div
                      id={`relationship-category-content-${category.id}`}
                      className={`relationship-card-list-shell${isCollapsed ? ' collapsed' : ''}`}
                      aria-hidden={isCollapsed}
                    >
                      <div className="relationship-card-list">
                        {groupFacilities.map((facility) => (
                          <article className="related-facility-card" key={facility.id}>
                            <button type="button" className="related-card-main" onClick={() => onSelectCenter(facility)}>
                              <FacilityImage facility={facility} />
                              <span>
                                <strong>{facility.name}</strong>
                                <small>{facility.area || 'エリア未設定'}</small>
                                <small>{category.icon} {category.label}</small>
                              </span>
                            </button>
                            <button type="button" className="related-detail-button" onClick={() => onOpenFacility(facility)}>詳細</button>
                          </article>
                        ))}
                      </div>
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="relationship-empty">
            <span aria-hidden="true">◇</span>
            <strong>関連施設はまだありません</strong>
            <p>施設編集画面から関連項目を登録できます。</p>
          </div>
        )}
      </div>

      <section className="relationship-history" aria-label="中心施設の履歴">
        <div className="relationship-history-actions">
          <button type="button" onClick={onHistoryBack} disabled={history.length < 2}>‹ 関係図内で戻る</button>
          <button type="button" onClick={onClearHistory} disabled={history.length < 2}>履歴をクリア</button>
        </div>
        <div className="relationship-breadcrumbs">
          {historyFacilities.map((facility, index) => (
            <span key={`${facility.id}-${index}`}>
              {index > 0 && <b aria-hidden="true">›</b>}
              <button type="button" className={facility.id === center.id ? 'current' : ''} onClick={() => onSelectCenter(facility)}>
                {facility.name}
              </button>
            </span>
          ))}
        </div>
        <p>カードをタップすると中心が切り替わります。詳細ボタンで施設情報を開けます。</p>
      </section>
    </div>
  )
}

function RelationshipGraphInner({
  facilities,
  settings,
  onSettingsChange,
  onBack,
  onOpenFacility,
}: RelationshipGraphProps) {
  const fallbackCenter = useMemo(
    () => facilities.find((facility) => facility.id === settings.selectedId)
      ?? [...facilities].sort((a, b) => degreeOf(b, facilities) - degreeOf(a, facilities))[0],
    [facilities, settings.selectedId],
  )
  const [history, setHistory] = useState<string[]>(() => fallbackCenter ? [fallbackCenter.id] : [])
  const relationshipScrollRef = useRef<HTMLDivElement>(null)
  const [compactProgress, setCompactProgress] = useState(0)
  const [centerDockHost, setCenterDockHost] = useState<HTMLDivElement | null>(null)
  const [isMobileLayout, setIsMobileLayout] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  ))

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const updateLayout = () => setIsMobileLayout(media.matches)
    updateLayout()
    media.addEventListener('change', updateLayout)
    return () => media.removeEventListener('change', updateLayout)
  }, [])

  useEffect(() => {
    const root = relationshipScrollRef.current
    if (!root) return

    let animationFrame = 0
    const updateCompactProgress = () => {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(() => {
        const progress = Math.min(1, Math.max(0, root.scrollTop / 104))
        setCompactProgress((current) => Math.abs(current - progress) < .005 ? current : progress)
      })
    }

    updateCompactProgress()
    root.addEventListener('scroll', updateCompactProgress, { passive: true })
    return () => {
      cancelAnimationFrame(animationFrame)
      root.removeEventListener('scroll', updateCompactProgress)
    }
  }, [])

  useEffect(() => {
    if (!fallbackCenter) return
    setHistory((current) => current.at(-1) === fallbackCenter.id ? current : [...current, fallbackCenter.id])
  }, [fallbackCenter])

  const selectCenter = (facility: Facility) => {
    setHistory((current) => current.at(-1) === facility.id ? current : [...current, facility.id])
    onSettingsChange({ selectedId: facility.id })
  }
  const historyBack = () => {
    setHistory((current) => {
      if (current.length < 2) return current
      const next = current.slice(0, -1)
      onSettingsChange({ selectedId: next.at(-1) ?? null })
      return next
    })
  }
  const clearHistory = () => {
    if (fallbackCenter) setHistory([fallbackCenter.id])
  }
  const interpolate = (expanded: number, compact: number) => expanded + ((compact - expanded) * compactProgress)
  const relationshipStyle = {
    '--relationship-compact-progress': compactProgress,
    '--relationship-header-current-height': `calc(${interpolate(128, 80)}px + var(--relationship-safe-top))`,
    '--relationship-header-current-padding-top': `calc(${interpolate(14, 8)}px + var(--relationship-safe-top))`,
    '--relationship-header-current-padding-bottom': `${interpolate(12, 8)}px`,
    '--relationship-header-current-gap': `${interpolate(12, 8)}px`,
    '--relationship-header-leading-width': `${interpolate(44, 36)}px`,
    '--relationship-header-copy-height': `${interpolate(48, 40)}px`,
    '--relationship-eyebrow-height': `${interpolate(24, 0)}px`,
    '--relationship-eyebrow-opacity': 1 - compactProgress,
    '--relationship-title-size': `${interpolate(22, 16)}px`,
    '--relationship-title-line-height': interpolate(1.35, 1.2),
    '--relationship-dock-current-top': `calc(${interpolate(128, 80)}px + var(--relationship-safe-top))`,
    '--relationship-dock-current-height': `${interpolate(214, 100)}px`,
    '--relationship-summary-height': `${interpolate(18, 0)}px`,
    '--relationship-summary-max-height': `${interpolate(24, 0)}px`,
    '--relationship-summary-margin': `${interpolate(4, 0)}px`,
    '--relationship-summary-opacity': 1 - compactProgress,
    '--relationship-card-image-width': `${interpolate(92, 58)}px`,
    '--relationship-card-height': `${interpolate(100, 58)}px`,
    '--relationship-card-radius': `${interpolate(18, 14)}px`,
    '--relationship-card-copy-gap': `${interpolate(2, 1)}px`,
    '--relationship-card-copy-padding-y': `${interpolate(6, 4)}px`,
    '--relationship-card-copy-padding-x': `${interpolate(9, 7)}px`,
    '--relationship-card-title-size': `${interpolate(15, 13)}px`,
    '--relationship-card-title-line-height': interpolate(1.2, 1.15),
    '--relationship-category-size': `${interpolate(10, 9)}px`,
    '--relationship-related-count-size': `${interpolate(9, 8)}px`,
    '--relationship-category-margin': `${interpolate(5, 4)}px`,
    '--relationship-category-padding-top': `${interpolate(4, 0)}px`,
    '--relationship-category-padding-x': `${interpolate(4, 0)}px`,
    '--relationship-category-padding-bottom': `${interpolate(4, 2)}px`,
    '--relationship-category-button-height': `${interpolate(28, 27)}px`,
    '--relationship-tree-height': `${interpolate(18, 0)}px`,
    '--relationship-tree-opacity': 1 - compactProgress,
  } as CSSProperties
  const isCompactHeader = compactProgress >= .995

  return (
    <main style={relationshipStyle} className={`relationship-page relationship-screen-enter is-center-mode${isCompactHeader ? ' is-compact' : ''}`}>
      <header className="relationship-header">
        <button className="back-button" onClick={onBack} aria-label="ホームに戻る">‹</button>
        <div className="relationship-header-copy">
          <div className="relationship-large-title"><p className="eyebrow">RELATIONSHIP</p><h1>施設関係図</h1></div>
        </div>
      </header>
      <div ref={setCenterDockHost} className="relationship-center-dock-slot" />
      <div ref={relationshipScrollRef} className="relationship-scroll-region">
        <p className="relationship-description">中心施設と直接関係する施設を、カテゴリ別に表示しています。</p>

        {fallbackCenter ? (
          <CenterRelationshipView
            facilities={facilities}
            center={fallbackCenter}
            history={history}
            onSelectCenter={selectCenter}
            onOpenFacility={onOpenFacility}
            onHistoryBack={historyBack}
            onClearHistory={clearHistory}
            dockHost={isMobileLayout ? centerDockHost : null}
            useDock={isMobileLayout}
          />
        ) : <div className="relationship-empty page-empty"><strong>施設がまだありません</strong></div>}
      </div>
    </main>
  )
}

export function RelationshipGraph(props: RelationshipGraphProps) {
  return <RelationshipGraphInner {...props} />
}
