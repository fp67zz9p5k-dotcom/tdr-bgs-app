import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
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

type RelationshipViewport = { x: number; y: number; scale: number }
let relationshipExplorationCache: { history: string[]; viewport: RelationshipViewport; positions: Record<string, { x: number; y: number }> } | null = null

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
  const [history, setHistory] = useState<string[]>(() => {
    if (fallbackCenter && relationshipExplorationCache?.history.at(-1) === fallbackCenter.id) return relationshipExplorationCache.history
    return fallbackCenter ? [fallbackCenter.id] : []
  })
  const initialCenterIdRef = useRef<string | null>(relationshipExplorationCache?.history[0] ?? fallbackCenter?.id ?? null)
  useEffect(() => {
    if (!fallbackCenter) return
    setHistory((current) => current.at(-1) === fallbackCenter.id ? current : [...current, fallbackCenter.id])
  }, [fallbackCenter])

  const selectCenter = (facility: Facility) => {
    setHistory((current) => {
      const next = current.at(-1) === facility.id ? current : [...current, facility.id]
      relationshipExplorationCache = { history: next, viewport: relationshipExplorationCache?.viewport ?? { x: 8, y: 8, scale: .72 }, positions: relationshipExplorationCache?.positions ?? {} }
      return next
    })
    onSettingsChange({ selectedId: facility.id })
  }
  const historyBack = () => {
    setHistory((current) => {
      if (current.length < 2) return current
      const next = current.slice(0, -1)
      relationshipExplorationCache = { history: next, viewport: relationshipExplorationCache?.viewport ?? { x: 8, y: 8, scale: .72 }, positions: relationshipExplorationCache?.positions ?? {} }
      onSettingsChange({ selectedId: next.at(-1) ?? null })
      return next
    })
  }
  const resetExploration = () => {
    const initialId = initialCenterIdRef.current
    if (!initialId) return
    setHistory([initialId])
    relationshipExplorationCache = null
    onSettingsChange({ selectedId: initialId })
  }

  return (
    <main className="relationship-page relationship-screen-enter is-node-mode">
      <header className="relationship-header">
        <button className="back-button" onClick={onBack} aria-label="ホームに戻る">‹</button>
        <div className="relationship-header-copy">
          <div className="relationship-large-title"><p className="eyebrow">RELATIONSHIP</p><h1>施設関係図</h1></div>
        </div>
      </header>
      <div className="relationship-scroll-region">
        <p className="relationship-description">中心施設からつながる関連施設を、ノードと線で表示しています。</p>

        {fallbackCenter ? (
          <NodeRelationshipView key={fallbackCenter.id} facilities={facilities} center={fallbackCenter} trail={history.map((id) => facilities.find((facility) => facility.id === id)).filter((facility): facility is Facility => Boolean(facility))} onSelectCenter={selectCenter} canGoBack={history.length > 1} onBack={historyBack} onReset={resetExploration} onOpenFacility={onOpenFacility} />
        ) : <div className="relationship-empty page-empty"><strong>施設がまだありません</strong></div>}
      </div>
    </main>
  )
}

export function RelationshipGraph(props: RelationshipGraphProps) {
  return <RelationshipGraphInner {...props} />
}

type NodeGraphNode = {
  facility: Facility
  level: number
  x: number
  y: number
}

type NodeGraphEdge = {
  source: string
  target: string
  sourceOffset?: number
  targetOffset?: number
}

function NodeRelationshipView({
  facilities,
  center,
  trail,
  onSelectCenter,
  canGoBack,
  onBack,
  onReset,
  onOpenFacility,
}: {
  facilities: Facility[]
  center: Facility
  trail: Facility[]
  onSelectCenter: (facility: Facility) => void
  canGoBack: boolean
  onBack: () => void
  onReset: () => void
  onOpenFacility: (facility: Facility) => void
}) {
  const nodes = useMemo(() => {
    const byId = new Map(facilities.map((facility) => [facility.id, facility]))
    const levels = new Map<string, number>([[center.id, 0]])
    const queue = [center.id]
    while (queue.length > 0) {
      const id = queue.shift()!
      const level = levels.get(id) ?? 0
      // Render only the current facility and its direct neighbours. Further
      // relationships are explored by explicitly making a neighbour the new
      // center, keeping the initial canvas bounded and responsive.
      if (level >= 1) continue
      for (const relatedId of getBidirectionalRelatedFacilityIds(facilities, id)) {
        if (!byId.has(relatedId) || levels.has(relatedId)) continue
        levels.set(relatedId, level + 1)
        queue.push(relatedId)
      }
    }

    const byLevel = [0, 1, 2].map((level) => [...levels.entries()]
      .filter(([, nodeLevel]) => nodeLevel === level)
      .map(([id]) => byId.get(id))
      .filter((facility): facility is Facility => Boolean(facility)))
    const nodeWidth = 238
    const nodeHeight = 72
    const gapX = 120
    const gapY = 28
    const originalIndex = new Map(byLevel.flat().map((facility, index) => [facility.id, index]))
    const neighborsInLevel = (facility: Facility, level: number) => getBidirectionalRelatedFacilityIds(facilities, facility.id)
      .filter((id) => levels.get(id) === level)
    const orderByBarycenter = (facilitiesAtLevel: Facility[], neighborLevel: number, positions: Map<string, number>) => {
      const ranked = facilitiesAtLevel.map((facility, index) => {
        const neighborPositions = neighborsInLevel(facility, neighborLevel)
          .map((id) => positions.get(id))
          .filter((position): position is number => position !== undefined)
        const barycenter = neighborPositions.length > 0
          ? neighborPositions.reduce((sum, position) => sum + position, 0) / neighborPositions.length
          : Number.MAX_SAFE_INTEGER
        return { facility, index, barycenter }
      })
      ranked.sort((a, b) => a.barycenter - b.barycenter || (originalIndex.get(a.facility.id) ?? a.index) - (originalIndex.get(b.facility.id) ?? b.index))
      return ranked.map(({ facility }) => facility)
    }

    // Repeated downward/upward barycenter sweeps reduce crossings without shrinking cards.
    for (let pass = 0; pass < 4; pass += 1) {
      const levelTwoPositions = new Map(byLevel[2].map((facility, index) => [facility.id, index]))
      byLevel[1] = orderByBarycenter(byLevel[1], 2, levelTwoPositions)
      const levelOnePositions = new Map(byLevel[1].map((facility, index) => [facility.id, index]))
      byLevel[2] = orderByBarycenter(byLevel[2], 1, levelOnePositions)
    }
    // The second level is displayed as one vertical lane. Order it by the
    // average position of its first-level parents so orthogonal routes stay
    // close to their source instead of making large vertical excursions.
    const levelOnePositions = new Map(byLevel[1].map((facility, index) => [facility.id, index]))
    const originalLevelTwoOrder = new Map(byLevel[2].map((facility, index) => [facility.id, index]))
    const levelTwoAnchor = (facility: Facility) => {
      const parentPositions = getBidirectionalRelatedFacilityIds(facilities, facility.id)
        .map((id) => levelOnePositions.get(id))
        .filter((position): position is number => position !== undefined)
      return parentPositions.length > 0
        ? parentPositions.reduce((sum, position) => sum + position, 0) / parentPositions.length
        : Number.MAX_SAFE_INTEGER
    }
    byLevel[2].sort((a, b) => levelTwoAnchor(a) - levelTwoAnchor(b)
      || (originalLevelTwoOrder.get(a.id) ?? 0) - (originalLevelTwoOrder.get(b.id) ?? 0))
    // Keep second-level nodes close to their first-level parent. Small groups
    // stay in one column; larger groups use at most two columns so the graph
    // grows in both directions without becoming a uniform grid.
    const assignedLevelTwo = new Set<string>()
    const levelTwoGroups = byLevel[1].map((parent) => {
      const children = byLevel[2].filter((facility) => !assignedLevelTwo.has(facility.id)
        && getBidirectionalRelatedFacilityIds(facilities, parent.id).includes(facility.id))
      children.forEach((facility) => assignedLevelTwo.add(facility.id))
      return { parent, facilities: children }
    }).filter((group) => group.facilities.length > 0)
    const groupedLevelTwo = [
      ...levelTwoGroups.flatMap((group) => group.facilities),
      ...byLevel[2].filter((facility) => !assignedLevelTwo.has(facility.id)),
    ]
    byLevel[2] = groupedLevelTwo
    const levelTwoLayouts = levelTwoGroups.map((group) => {
      const columns = group.facilities.length >= 9 ? 3 : group.facilities.length >= 4 ? 2 : 1
      const rows = Math.ceil(group.facilities.length / columns)
      return { ...group, columns, rows }
    })
    const levelTwoMaxColumns = Math.max(...levelTwoLayouts.map((group) => group.columns), 1)
    const levelTwoTotalHeight = levelTwoLayouts.reduce((sum, group) => sum + group.rows * nodeWidth + Math.max(0, group.rows - 1) * gapX + gapX, 0)
    const firstLevelColumns = byLevel[1].length <= 4 ? 1 : Math.min(5, Math.ceil(Math.sqrt(byLevel[1].length)))
    const firstLevelRows = Math.ceil(Math.max(byLevel[1].length, 1) / firstLevelColumns)
    const firstLevelGroupWidth = levelTwoMaxColumns * nodeHeight + Math.max(0, levelTwoMaxColumns - 1) * gapY
    const firstLevelX = 24 + nodeWidth + gapX
    const firstLevelColumnWidth = nodeHeight + gapY
    const levelTwoBaseX = firstLevelX + firstLevelColumns * firstLevelColumnWidth + gapY
    const width = Math.max(420, levelTwoBaseX + firstLevelGroupWidth + 24)
    const height = Math.max(720, firstLevelRows * nodeWidth + Math.max(0, firstLevelRows - 1) * gapX + 64, levelTwoTotalHeight + 80)
    const result: NodeGraphNode[] = []
    const centerNode = byLevel[0][0]
    if (centerNode) result.push({ facility: centerNode, level: 0, x: 24, y: (height - nodeHeight) / 2 })
    byLevel[1].forEach((facility, index) => {
      const column = Math.floor(index / firstLevelRows)
      const row = index % firstLevelRows
      result.push({
        facility,
        level: 1,
        x: firstLevelX + column * firstLevelColumnWidth,
        y: Math.max(40, (height - firstLevelRows * nodeWidth - Math.max(0, firstLevelRows - 1) * gapX) / 2) + row * (nodeWidth + gapX),
      })
    })
    byLevel[2].forEach((facility) => result.push({ facility, level: 2, x: 0, y: 0 }))
    const nodeById = new Map(result.map((node) => [node.facility.id, node]))
    let levelTwoCursor = 40
    levelTwoLayouts.forEach(({ parent, facilities: children, columns, rows }) => {
      const parentNode = nodeById.get(parent.id)
      if (!parentNode) return
      const groupHeight = rows * nodeWidth + Math.max(0, rows - 1) * gapX
      const desiredStart = parentNode.y + (nodeHeight - groupHeight) / 2
      const groupStart = Math.max(levelTwoCursor, Math.max(40, Math.min(height - groupHeight - 40, desiredStart)))
      const groupX = levelTwoBaseX
      children.forEach((child, index) => {
        const childNode = nodeById.get(child.id)
        if (!childNode) return
        const column = Math.floor(index / rows)
        const row = index % rows
        childNode.x = groupX + column * (nodeHeight + gapY)
        childNode.y = groupStart + row * (nodeWidth + gapX)
      })
      levelTwoCursor = groupStart + groupHeight + gapY
    })
    // The layout calculation above uses the same compact group geometry as
    // before. Rotate the resulting coordinate system so hierarchy flows from
    // top to bottom while columns remain the within-level axis.
    result.forEach((node) => {
      const previousX = node.x
      node.x = node.y
      node.y = previousX
    })
    const nodeIds = new Set(result.map((node) => node.facility.id))
    const edges: NodeGraphEdge[] = []
    const seenEdges = new Set<string>()
    result.forEach((node) => {
      getBidirectionalRelatedFacilityIds(facilities, node.facility.id).forEach((relatedId) => {
        if (!nodeIds.has(relatedId)) return
        const relatedLevel = levels.get(relatedId)
        // Keep the visual graph hierarchical: only adjacent levels are drawn.
        // Same-level and level-skipping links create long crossing lines without
        // improving the two-level exploration view.
        if (relatedLevel === undefined || Math.abs(node.level - relatedLevel) !== 1) return
        const key = [node.facility.id, relatedId].sort().join(':')
        if (seenEdges.has(key)) return
        seenEdges.add(key)
        edges.push({ source: node.facility.id, target: relatedId })
      })
    })
    edges.forEach((edge) => {
      const source = nodeById.get(edge.source)
      const target = nodeById.get(edge.target)
      if (!source || !target) return
      const sourceChildren = edges.filter((candidate) => candidate.source === edge.source)
        .sort((a, b) => (nodeById.get(a.target)?.y ?? 0) - (nodeById.get(b.target)?.y ?? 0))
      const targetParents = edges.filter((candidate) => candidate.target === edge.target)
        .sort((a, b) => (nodeById.get(a.source)?.y ?? 0) - (nodeById.get(b.source)?.y ?? 0))
      const distributeOnEdge = (index: number, count: number) => {
        const edgePadding = 12
        if (count <= 1) return nodeHeight / 2
        return edgePadding + (nodeHeight - edgePadding * 2) * (index / (count - 1))
      }
      edge.sourceOffset = distributeOnEdge(sourceChildren.indexOf(edge), sourceChildren.length)
      edge.targetOffset = distributeOnEdge(targetParents.indexOf(edge), targetParents.length)
    })
    return { nodes: result, edges, width: height, height: width }
  }, [center.id, facilities])

  const viewportRef = useRef<HTMLDivElement>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const gestureRef = useRef<{
    moved: boolean
    blocked: boolean
    startX: number
    startY: number
    originX: number
    originY: number
    startMidX: number
    startMidY: number
    distance: number
    scale: number
  } | null>(null)
  const suppressClickRef = useRef(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const explorationNodes = useMemo(() => {
    const byId = new Map(facilities.map((facility) => [facility.id, facility]))
    const path = trail.map((item) => byId.get(item.id)).filter((item): item is Facility => Boolean(item))
    const pathIds = new Set(path.map((item) => item.id))
    const candidates = getBidirectionalRelatedFacilities(facilities, center.id)
      .filter((facility) => !pathIds.has(facility.id))
    const nodeWidth = 238
    const nodeHeight = 72
    const gapY = 54
    const candidateColumns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(Math.max(candidates.length, 1)))))
    const candidateRows = Math.ceil(Math.max(candidates.length, 1) / candidateColumns)
    const gridGapX = 56
    const gridGapY = 54
    const gridWidth = candidateColumns * nodeWidth + Math.max(0, candidateColumns - 1) * gridGapX
    const gridHeight = candidateRows * nodeHeight + Math.max(0, candidateRows - 1) * gridGapY
    const width = Math.max(1600, gridWidth + 160)
    const height = Math.max(1200, 700 + path.length * 280 + candidateRows * (nodeHeight + gapY))
    const layoutCache = relationshipExplorationCache?.history[0] === path[0]?.id ? relationshipExplorationCache : null
    const positions = layoutCache?.positions ?? {}
    const hashOf = (id: string) => [...id].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 17)
    const overlaps = (x: number, y: number, other: { x: number; y: number }) => Math.abs(x - other.x) < nodeWidth + 34 && Math.abs(y - other.y) < nodeHeight + 34
    const placeAround = (facility: Facility, anchor: { x: number; y: number }, occupied: { x: number; y: number }[]) => {
      const hash = hashOf(facility.id)
      const angles = [0.32, 2.18, 4.52, 5.72, 1.18, 3.42, 0.86, 4.02, 2.76, 5.12, 1.82, 3.86]
      const start = hash % angles.length
      for (let attempt = 0; attempt < angles.length * 18; attempt += 1) {
        const ring = Math.floor(attempt / angles.length)
        const angle = angles[(start + attempt) % angles.length] + ring * .17
        const radius = 210 + ring * 72 + ((hash + attempt * 47) % 42)
        const x = Math.max(32, Math.min(width - nodeWidth - 32, anchor.x + Math.cos(angle) * radius))
        const y = Math.max(32, Math.min(height - nodeHeight - 32, anchor.y + Math.sin(angle) * radius))
        if (!occupied.some((other) => overlaps(x, y, other))) return { x, y }
      }
      // A final deterministic scan expands the map coordinate space instead of
      // accepting an overlapping fallback position.
      for (let y = 32; y <= height - nodeHeight - 32; y += nodeHeight + 34) {
        for (let x = 32; x <= width - nodeWidth - 32; x += nodeWidth + 34) {
          if (!occupied.some((other) => overlaps(x, y, other))) return { x, y }
        }
      }
      return { x: width - nodeWidth - 32, y: height - nodeHeight - 32 }
    }
    if (path[0] && !positions[path[0].id]) positions[path[0].id] = { x: 680, y: 500 }
    for (let index = 1; index < path.length; index += 1) {
      const facility = path[index]
      if (!positions[facility.id]) {
        const confirmedOccupied = path.slice(0, index)
          .map((item) => positions[item.id])
          .filter((position): position is { x: number; y: number } => Boolean(position))
        positions[facility.id] = placeAround(facility, positions[path[index - 1].id], confirmedOccupied)
      }
    }
    if (layoutCache) layoutCache.positions = positions
    const candidatePositions: Record<string, { x: number; y: number }> = {}
    const pathRects = path.map((facility) => ({ x: positions[facility.id].x - 20, y: positions[facility.id].y - 20, width: nodeWidth + 40, height: nodeHeight + 40 }))
    const routeRects = path.slice(1).map((facility, index) => {
      const from = positions[path[index].id]
      const to = positions[facility.id]
      return { x: Math.min(from.x, to.x) - 10, y: Math.min(from.y, to.y) - 10, width: Math.abs(to.x - from.x) + nodeWidth + 20, height: Math.abs(to.y - from.y) + nodeHeight + 20 }
    })
    const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
    const currentPosition = positions[center.id] ?? positions[path.at(-1)?.id ?? ''] ?? { x: 680, y: 500 }
    const anchorCandidates = [-1, -.5, 0, .5, 1].flatMap((horizontal) => [-1, -.5, 0, .5, 1].map((vertical) => ({
      x: currentPosition.x - gridWidth / 2 + horizontal * (gridWidth * .75),
      y: currentPosition.y - gridHeight / 2 + vertical * (gridHeight + nodeHeight + 46),
    })))
    const validAnchors = anchorCandidates.map((anchor) => ({
      x: Math.max(32, Math.min(width - gridWidth - 32, anchor.x)),
      y: Math.max(32, Math.min(height - gridHeight - 32, anchor.y)),
    })).filter((anchor) => {
      const gridRect = { x: anchor.x - 8, y: anchor.y - 8, width: gridWidth + 16, height: gridHeight + 16 }
      return !pathRects.some((rect) => intersects(gridRect, rect)) && !routeRects.some((rect) => intersects(gridRect, rect))
    })
    const gridAnchor = validAnchors.sort((a, b) => {
      const distance = (anchor: { x: number; y: number }) => Math.hypot(anchor.x + gridWidth / 2 - currentPosition.x, anchor.y + gridHeight / 2 - currentPosition.y)
      return distance(a) - distance(b)
    })[0] ?? { x: Math.max(32, currentPosition.x - gridWidth / 2), y: Math.max(32, currentPosition.y + nodeHeight + 46) }
    candidates.forEach((facility, index) => {
      const point = { x: gridAnchor.x + (index % candidateColumns) * (nodeWidth + gridGapX), y: gridAnchor.y + Math.floor(index / candidateColumns) * (nodeHeight + gridGapY) }
      candidatePositions[facility.id] = point
    })
    if (!layoutCache) {
      relationshipExplorationCache = { history: path.map((facility) => facility.id), viewport: relationshipExplorationCache?.viewport ?? { x: 8, y: 8, scale: .72 }, positions }
    }
    const nodes: NodeGraphNode[] = [
      ...path.map((facility, index) => ({ facility, level: index, x: positions[facility.id].x, y: positions[facility.id].y })),
      ...candidates.map((facility, index) => ({
        facility,
        level: path.length,
        ...candidatePositions[facility.id],
      })),
    ]
    const edges: NodeGraphEdge[] = path.slice(1).map((facility, index) => ({ source: path[index].id, target: facility.id }))
    return { nodes, edges, width, height }
  }, [center.id, facilities, trail])

  const cachedViewport = relationshipExplorationCache?.history.join('|') === trail.map((facility) => facility.id).join('|')
    ? relationshipExplorationCache.viewport
    : null
  const shouldRestoreViewportRef = useRef(Boolean(cachedViewport))
  const [viewport, setViewport] = useState(cachedViewport ?? { x: 8, y: 8, scale: .72 })
  useEffect(() => {
    relationshipExplorationCache = { history: trail.map((facility) => facility.id), viewport, positions: relationshipExplorationCache?.positions ?? {} }
  }, [trail, viewport])
  const nodeById = new Map(explorationNodes.nodes.map((node) => [node.facility.id, node]))

  useEffect(() => {
    const viewportElement = viewportRef.current
    if (!viewportElement || !Number.isFinite(explorationNodes.width) || !Number.isFinite(explorationNodes.height)) return
    if (shouldRestoreViewportRef.current) {
      shouldRestoreViewportRef.current = false
      return
    }
    const rect = viewportElement.getBoundingClientRect()
    const fitScale = Math.min(
      .72,
      Math.max(.3, Math.min((rect.width - 24) / explorationNodes.width, (rect.height - 24) / explorationNodes.height)),
    )
    setViewport({
      scale: fitScale,
      x: (rect.width - explorationNodes.width * fitScale) / 2,
      y: (rect.height - explorationNodes.height * fitScale) / 2,
    })
  }, [explorationNodes.width, explorationNodes.height])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const points = [...pointersRef.current.values()]
    if (points.length === 1) {
      const startedOnCard = event.target instanceof Element && Boolean(event.target.closest('.node-relationship-node'))
      gestureRef.current = { moved: false, blocked: startedOnCard, startX: event.clientX, startY: event.clientY, originX: viewport.x, originY: viewport.y, startMidX: event.clientX, startMidY: event.clientY, distance: 0, scale: viewport.scale }
    } else if (points.length === 2) {
      const [first, second] = points
      gestureRef.current = {
        moved: true,
        blocked: false,
        startX: 0,
        startY: 0,
        originX: viewport.x,
        originY: viewport.y,
        startMidX: (first.x + second.x) / 2,
        startMidY: (first.y + second.y) / 2,
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        scale: viewport.scale,
      }
    }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || !pointersRef.current.has(event.pointerId)) return
    if (gesture.blocked) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const points = [...pointersRef.current.values()]
    if (points.length >= 2) {
      const [first, second] = points
      const distance = Math.hypot(second.x - first.x, second.y - first.y)
      if (gesture.distance > 0) {
        const midX = (first.x + second.x) / 2
        const midY = (first.y + second.y) / 2
        const nextScale = Math.min(2.2, Math.max(.3, gesture.scale * distance / gesture.distance))
        const anchorX = (gesture.startMidX - gesture.originX) / gesture.scale
        const anchorY = (gesture.startMidY - gesture.originY) / gesture.scale
        const nextX = midX - anchorX * nextScale
        const nextY = midY - anchorY * nextScale
        setViewport({ x: nextX, y: nextY, scale: nextScale })
      }
      return
    }
    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY
    if (Math.abs(dx) + Math.abs(dy) > 6) gesture.moved = true
    if (gesture.moved) setViewport(() => {
      const rect = viewportRef.current?.getBoundingClientRect()
      const minX = Math.min(20, (rect?.width ?? 320) - explorationNodes.width * gesture.scale - 20)
      const minY = Math.min(20, (rect?.height ?? 450) - explorationNodes.height * gesture.scale - 20)
      return { scale: gesture.scale, x: Math.min(20, Math.max(minX, gesture.originX + dx)), y: Math.min(20, Math.max(minY, gesture.originY + dy)) }
    })
  }
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.moved) {
      suppressClickRef.current = true
      window.setTimeout(() => { suppressClickRef.current = false }, 0)
    }
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size === 1 && gestureRef.current) {
      // Transitioning from pinch to one-finger pan must not reuse the pinch's
      // synthetic (0, 0) start coordinates. Rebase only the gesture origin;
      // do not change the viewport at pointer-up time.
      const [remaining] = [...pointersRef.current.values()]
      gestureRef.current = {
        moved: false,
        blocked: false,
        startX: remaining.x,
        startY: remaining.y,
        originX: viewport.x,
        originY: viewport.y,
        startMidX: remaining.x,
        startMidY: remaining.y,
        distance: 0,
        scale: viewport.scale,
      }
    } else if (pointersRef.current.size === 0) {
      gestureRef.current = null
    }
  }
  return (
    <section className="node-relationship-view" aria-label="ノード型関係図">
      <div className="node-relationship-exploration" aria-live="polite">
        <span className="node-relationship-exploration-label">探索中の中心</span>
        <strong>{center.name}</strong>
        {trail.length > 1 && <div className="node-relationship-trail" aria-label="探索履歴">
          {trail.map((facility, index) => <span key={`${facility.id}-${index}`} className={facility.id === center.id ? 'current' : ''}>{facility.name}</span>)}
        </div>}
      </div>
      <div className="node-relationship-toolbar">
        <span>直接の関連施設を表示</span>
        <div className="node-relationship-toolbar-actions">
          <button type="button" className="node-relationship-back-button" onClick={onBack} disabled={!canGoBack} aria-label="前の探索地点へ戻る" title="前の探索地点へ戻る">‹</button>
          <button type="button" className="node-relationship-reset-button" onClick={onReset} disabled={!canGoBack} aria-label="探索をリセット" title="探索をリセット">↻</button>
        </div>
      </div>
      <div
        className="node-relationship-viewport"
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div className="node-relationship-stage" style={{ width: explorationNodes.width, height: explorationNodes.height, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
          <svg className="node-relationship-lines" viewBox={`0 0 ${explorationNodes.width} ${explorationNodes.height}`} aria-hidden="true">
            {explorationNodes.edges.map((edge) => {
              const source = nodeById.get(edge.source)
              const target = nodeById.get(edge.target)
              if (!source || !target) return null
              const spanEdges = explorationNodes.edges.filter((candidate) => {
                const candidateSource = nodeById.get(candidate.source)
                const candidateTarget = nodeById.get(candidate.target)
                return candidateSource && candidateTarget && candidateSource.level === source.level && candidateTarget.level === target.level
              })
              const laneIndex = Math.max(0, spanEdges.indexOf(edge))
              const laneCount = Math.max(1, spanEdges.length)
              const sourceX = source.x + 119
              const targetX = target.x + 119
              const startY = source.y + 72
              const endY = target.y
              const laneY = startY + (endY - startY) * ((laneIndex + 1) / (laneCount + 1))
              const sourceXOffset = sourceX + ((edge.sourceOffset ?? 36) - 36)
              const targetXOffset = targetX + ((edge.targetOffset ?? 36) - 36)
              const highlightsPath = selectedNodeId !== null && (
                (source.facility.id === selectedNodeId && target.level !== 0)
                || (target.facility.id === selectedNodeId && source.level !== 0)
                || (selectedNodeId !== null && nodeById.get(selectedNodeId)?.level === 2
                  && ((source.facility.id === center.id && target.level === 1 && getBidirectionalRelatedFacilityIds(facilities, target.facility.id).includes(selectedNodeId))
                    || (target.facility.id === center.id && source.level === 1 && getBidirectionalRelatedFacilityIds(facilities, source.facility.id).includes(selectedNodeId))))
              )
              const footprintCount = Math.max(3, Math.min(10, Math.round(Math.abs(endY - startY) / 46)))
              const curveDirection = laneIndex % 2 === 0 ? 1 : -1
              const controlY = (startY + endY) / 2
              const controlCandidates = [0, 1, -1, 2, -2].map((offset) => (sourceXOffset + targetXOffset) / 2 + curveDirection * offset * Math.min(110, 34 + Math.abs(targetXOffset - sourceXOffset) * .18))
              const isBlocked = (controlX: number) => Array.from({ length: 9 }, (_, sampleIndex) => (sampleIndex + 1) / 10).some((progress) => {
                const inverse = 1 - progress
                const x = inverse * inverse * sourceXOffset + 2 * inverse * progress * controlX + progress * progress * targetXOffset
                const y = inverse * inverse * startY + 2 * inverse * progress * controlY + progress * progress * endY
                return explorationNodes.nodes.some((candidate) => candidate.facility.id !== source.facility.id && candidate.facility.id !== target.facility.id
                  && x > candidate.x - 12 && x < candidate.x + 250 && y > candidate.y - 12 && y < candidate.y + 84)
              })
              const controlX = controlCandidates.find((candidate) => !isBlocked(candidate)) ?? controlCandidates[0]
              const footprints = Array.from({ length: footprintCount }, (_, index) => {
                const progress = (index + 1) / (footprintCount + 1)
                const inverse = 1 - progress
                const x = inverse * inverse * sourceXOffset + 2 * inverse * progress * controlX + progress * progress * targetXOffset
                const y = inverse * inverse * startY + 2 * inverse * progress * controlY + progress * progress * endY
                const tangentX = 2 * inverse * (controlX - sourceXOffset) + 2 * progress * (targetXOffset - controlX)
                const tangentY = 2 * inverse * (controlY - startY) + 2 * progress * (endY - controlY)
                const rotation = Math.atan2(tangentY, tangentX) * 180 / Math.PI + 90
                const side = index % 2 === 0 ? -7 : 7
                return <path key={index} className="relationship-footprint" d="M -3 -8 C -6 -5 -5 1 -2 7 C 0 10 3 8 3 4 C 4 -1 2 -6 0 -8 Z" transform={`translate(${x + side},${y}) rotate(${rotation})`} />
              })
              return <g className={highlightsPath ? 'is-highlighted' : undefined} key={`${edge.source}-${edge.target}`}>{footprints}</g>
            })}
          </svg>
          {explorationNodes.nodes.map((node) => (
            <div
              role="button"
              tabIndex={0}
              key={node.facility.id}
              className={`node-relationship-node${node.level === 0 ? ' is-center' : ''}${node.facility.id === selectedNodeId ? ' is-selected' : ''}`}
              data-level={node.level}
              style={{ left: node.x, top: node.y }}
              onClick={() => {
                if (suppressClickRef.current) return
                if (node.level === trail.length) {
                  setSelectedNodeId((current) => current === node.facility.id ? null : node.facility.id)
                  onSelectCenter(node.facility)
                }
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                if (node.level === trail.length) {
                  setSelectedNodeId((current) => current === node.facility.id ? null : node.facility.id)
                  onSelectCenter(node.facility)
                }
              }}
            >
              <span className="node-relationship-node-icon" aria-hidden="true">{getCategoryDefinition(node.facility.category).icon}</span>
              <span className="node-relationship-node-copy"><strong>{node.facility.name}</strong><small>{getCategoryDefinition(node.facility.category).label}</small></span>
              <button type="button" className="node-relationship-detail-button" onClick={(event) => { event.stopPropagation(); onOpenFacility(node.facility) }}>詳細</button>
            </div>
          ))}
        </div>
      </div>
      <p className="node-relationship-hint">候補カードをタップして足跡をたどります。‹ で戻り、↻ で最初から探索できます。</p>
    </section>
  )
}
