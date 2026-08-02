import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Category, Facility, Park, RelationshipGraphSettings } from './types'
import { CATEGORY_DEFINITIONS, getCategoryDefinition, type CategoryId } from './categories'
import {
  getBidirectionalRelatedFacilities,
  getBidirectionalRelatedFacilityIds,
  getUniqueBidirectionalRelationships,
} from './relationships'

const degreeOf = (facility: Facility, facilities: Facility[]) =>
  getBidirectionalRelatedFacilityIds(facilities, facility.id).length

const isCategoryId = (value: string): value is CategoryId =>
  CATEGORY_DEFINITIONS.some((category) => category.id === value)

const drawRoundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  context.moveTo(x + safeRadius, y)
  context.lineTo(x + width - safeRadius, y)
  context.arcTo(x + width, y, x + width, y + safeRadius, safeRadius)
  context.lineTo(x + width, y + height - safeRadius)
  context.arcTo(x + width, y + height, x + width - safeRadius, y + height, safeRadius)
  context.lineTo(x + safeRadius, y + height)
  context.arcTo(x, y + height, x, y + height - safeRadius, safeRadius)
  context.lineTo(x, y + safeRadius)
  context.arcTo(x, y, x + safeRadius, y, safeRadius)
  context.closePath()
}

function CategoryHeadingFrame({ collapsed }: { collapsed: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const paint = () => {
      const bounds = canvas.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) return

      const pixelRatio = Math.max(1, window.devicePixelRatio || 1)
      const pixelWidth = Math.max(1, Math.round(bounds.width * pixelRatio))
      const pixelHeight = Math.max(1, Math.round(bounds.height * pixelRatio))
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight

      const context = canvas.getContext('2d')
      if (!context) return

      const width = pixelWidth / pixelRatio
      const height = pixelHeight / pixelRatio
      const style = getComputedStyle(canvas)
      const borderColor = style.getPropertyValue('--border-strong').trim() || '#c8b38f'
      const backgroundVariable = collapsed ? '--bg-card-strong' : '--relationship-heading-bg'
      const backgroundColor = style.getPropertyValue(backgroundVariable).trim() || '#f5efe4'

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, width, height)

      drawRoundedRect(context, 0, 0, width, height, 13)
      context.fillStyle = borderColor
      context.fill()

      // Keep the straight edges at exactly 1 CSS px. A slightly smaller inner
      // corner radius compensates for WebKit's stronger antialiasing on curved
      // edges without making the horizontal or vertical borders thicker.
      drawRoundedRect(context, 1, 1, Math.max(0, width - 2), Math.max(0, height - 2), 11.5)
      context.fillStyle = backgroundColor
      context.fill()
    }

    const resizeObserver = new ResizeObserver(paint)
    const themeObserver = new MutationObserver(paint)
    resizeObserver.observe(canvas)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    paint()

    return () => {
      resizeObserver.disconnect()
      themeObserver.disconnect()
    }
  }, [collapsed])

  return <canvas ref={canvasRef} className="relationship-group-heading-frame" aria-hidden="true" />
}

const layoutPositions = (facilities: Facility[], centerId?: string | null) => {
  const ordered = [...facilities].sort((a, b) => degreeOf(b, facilities) - degreeOf(a, facilities))
  const center = ordered.find((facility) => facility.id === centerId) ?? ordered[0]
  const positions: Record<string, { x: number; y: number }> = {}
  if (!center) return positions
  positions[center.id] = { x: 0, y: 0 }
  const connected = new Set(getBidirectionalRelatedFacilityIds(facilities, center.id))
  const neighbors = ordered.filter((facility) => connected.has(facility.id))
  const others = ordered.filter((facility) => facility.id !== center.id && !connected.has(facility.id))
  neighbors.forEach((facility, index) => {
    const angle = (index / Math.max(neighbors.length, 1)) * Math.PI * 2
    positions[facility.id] = { x: Math.cos(angle) * 310, y: Math.sin(angle) * 240 }
  })
  others.forEach((facility, index) => {
    const angle = (index / Math.max(others.length, 1)) * Math.PI * 2
    const ring = 560 + Math.floor(index / 14) * 210
    positions[facility.id] = { x: Math.cos(angle) * ring, y: Math.sin(angle) * ring * .72 }
  })
  return positions
}

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
}: {
  facilities: Facility[]
  center: Facility
  history: string[]
  onSelectCenter: (facility: Facility) => void
  onOpenFacility: (facility: Facility) => void
  onHistoryBack: () => void
  onClearHistory: () => void
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

  useEffect(() => {
    setCollapsed(new Set())
    setActiveCategoryId(groups[0]?.category.id ?? '')
  }, [center.id, groups])

  useEffect(() => {
    const container = categoryGroupsRef.current
    if (!container || typeof IntersectionObserver === 'undefined') return
    const sections = [...container.querySelectorAll<HTMLElement>('.relationship-category-group')]
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top))[0]
      if (visible?.target.id) {
        const categoryId = visible.target.id.replace('relationship-category-', '')
        if (isCategoryId(categoryId)) setActiveCategoryId(categoryId)
      }
    }, { root: null, rootMargin: '-32% 0px -58% 0px', threshold: 0 })
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [center.id, groups])

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

  return (
    <div className={`relationship-center-view density-${density}`}>
      <section className="center-summary" aria-label="直接の関連件数">
        <span>直接の関連 {related.length}件</span>
      </section>

      <div className="relationship-center-layout">
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
            <nav className="relationship-category-overview" aria-label="関連カテゴリ概要">
              {groups.map(({ category, facilities: groupFacilities }) => (
                <button
                  type="button"
                  key={category.id}
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
                    <div className="relationship-group-heading-shell">
                      <CategoryHeadingFrame collapsed={isCollapsed} />
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

function OverviewRelationshipView({
  facilities,
  settings,
  onSettingsChange,
  onOpenFacility,
}: {
  facilities: Facility[]
  settings: RelationshipGraphSettings
  onSettingsChange: (settings: RelationshipGraphSettings) => void
  onOpenFacility: (facility: Facility) => void
}) {
  const areas = useMemo(() => Array.from(new Set(facilities
    .filter((facility) => settings.park === 'すべて' || facility.park === settings.park)
    .map((facility) => facility.area).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ja')), [facilities, settings.park])
  const visibleFacilities = useMemo(() => facilities.filter((facility) =>
    (settings.park === 'すべて' || facility.park === settings.park)
    && (!settings.category || facility.category === settings.category)
    && (!settings.area || facility.area === settings.area)),
  [facilities, settings.park, settings.category, settings.area])
  const visibleIds = useMemo(() => new Set(visibleFacilities.map((facility) => facility.id)), [visibleFacilities])
  const connectedIds = useMemo(() => new Set(settings.selectedId
    ? [settings.selectedId, ...getBidirectionalRelatedFacilityIds(facilities, settings.selectedId)]
    : []), [facilities, settings.selectedId])
  const generatedPositions = useMemo(
    () => layoutPositions(visibleFacilities, settings.selectedId),
    [visibleFacilities, settings.selectedId],
  )
  const baseNodes = useMemo<Node[]>(() => visibleFacilities.map((facility) => {
    const category = getCategoryDefinition(facility.category)
    const selected = facility.id === settings.selectedId
    const related = connectedIds.has(facility.id)
    const dimmed = Boolean(settings.selectedId) && !related
    return {
      id: facility.id,
      position: settings.positions[facility.id] ?? generatedPositions[facility.id] ?? { x: 0, y: 0 },
      className: `relation-node${selected ? ' selected' : ''}${related && !selected ? ' related' : ''}${dimmed ? ' dimmed' : ''}`,
      data: {
        label: (
          <div className="relation-node-content">
            {selected && <FacilityImage facility={facility} />}
            <span className="relation-node-category" aria-hidden="true">{category.icon}</span>
            <strong>{facility.name}</strong>
            <small>{facility.area || 'エリア未設定'} · {category.label}</small>
            {selected && <button className="nodrag nopan" type="button" onClick={() => onOpenFacility(facility)}>詳細</button>}
          </div>
        ),
      },
    }
  }), [visibleFacilities, settings.selectedId, settings.positions, generatedPositions, connectedIds, onOpenFacility])
  const [nodes, setNodes] = useState<Node[]>(baseNodes)
  useEffect(() => setNodes(baseNodes), [baseNodes])

  const edges = useMemo<Edge[]>(() => getUniqueBidirectionalRelationships(facilities)
    .filter(({ source, target }) => visibleIds.has(source) && visibleIds.has(target))
    .map((relationship) => {
      const active = !settings.selectedId
        || relationship.source === settings.selectedId
        || relationship.target === settings.selectedId
      return {
        ...relationship,
        className: active ? 'relation-edge active' : 'relation-edge dimmed',
      }
    }), [facilities, visibleIds, settings.selectedId])

  const save = (patch: Partial<RelationshipGraphSettings>) => onSettingsChange({ ...settings, ...patch })
  const onNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
  }, [])

  return (
    <div className="relationship-overview">
      <div className="relationship-filters">
        <select aria-label="パーク" value={settings.park} onChange={(event) => save({ park: event.target.value as 'すべて' | Park, area: '' })}>
          <option>すべて</option><option>東京ディズニーランド</option><option>東京ディズニーシー</option>
        </select>
        <select aria-label="カテゴリ" value={settings.category} onChange={(event) => save({ category: event.target.value as '' | Category })}>
          <option value="">全カテゴリ</option>
          {CATEGORY_DEFINITIONS.map((category) => <option value={category.value} key={category.id}>{category.icon} {category.label}</option>)}
        </select>
        <select aria-label="エリア" value={settings.area} onChange={(event) => save({ area: event.target.value })}>
          <option value="">全エリア</option>{areas.map((area) => <option key={area}>{area}</option>)}
        </select>
      </div>
      <div className="overview-status"><span>{visibleFacilities.length}施設を表示</span><span>選択した施設と直接関係する項目を強調します</span></div>
      <div className="relationship-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onNodeClick={(_, node) => save({ selectedId: node.id })}
          onNodeDoubleClick={(_, node) => {
            const facility = facilities.find((item) => item.id === node.id)
            if (facility) onOpenFacility(facility)
          }}
          onNodeDragStop={(_, node) => save({ positions: { ...settings.positions, [node.id]: node.position } })}
          onMoveEnd={(_, viewport: Viewport) => save({ viewport })}
          defaultViewport={settings.viewport}
          fitView={!Object.keys(settings.positions).length}
          minZoom={.25}
          maxZoom={2.5}
          nodesConnectable={false}
          zoomOnPinch
          zoomOnScroll
          panOnDrag
        >
          <Background gap={22} size={1} />
        </ReactFlow>
      </div>
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
  const normalizedSettings = useMemo(
    () => ({ ...settings, mode: settings.mode ?? 'center', category: settings.category ?? '' }),
    [settings],
  )
  const fallbackCenter = useMemo(
    () => facilities.find((facility) => facility.id === normalizedSettings.selectedId)
      ?? [...facilities].sort((a, b) => degreeOf(b, facilities) - degreeOf(a, facilities))[0],
    [facilities, normalizedSettings.selectedId],
  )
  const [history, setHistory] = useState<string[]>(() => fallbackCenter ? [fallbackCenter.id] : [])
  const relationshipPageRef = useRef<HTMLElement>(null)
  const scrollFrameRef = useRef(0)
  const relationshipPageTopRef = useRef(0)
  const [headerProgress, setHeaderProgress] = useState(0)

  useEffect(() => {
    const measurePageTop = () => {
      const page = relationshipPageRef.current
      if (!page) return
      relationshipPageTopRef.current = window.scrollY + page.getBoundingClientRect().top
    }

    const updateHeaderProgress = () => {
      cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = requestAnimationFrame(() => {
        const nextProgress = Math.min(
          1,
          Math.max(0, (window.scrollY - relationshipPageTopRef.current) / 170),
        )
        setHeaderProgress((current) => Math.abs(current - nextProgress) < .002 ? current : nextProgress)
      })
    }

    measurePageTop()
    updateHeaderProgress()
    window.addEventListener('scroll', updateHeaderProgress, { passive: true })
    const handleResize = () => {
      measurePageTop()
      updateHeaderProgress()
    }
    window.addEventListener('resize', handleResize)
    return () => {
      cancelAnimationFrame(scrollFrameRef.current)
      window.removeEventListener('scroll', updateHeaderProgress)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  useEffect(() => {
    if (!fallbackCenter) return
    setHistory((current) => current.at(-1) === fallbackCenter.id ? current : [...current, fallbackCenter.id])
  }, [fallbackCenter])

  const setMode = (mode: RelationshipGraphSettings['mode']) => {
    onSettingsChange({ ...normalizedSettings, mode })
  }
  const selectCenter = (facility: Facility) => {
    setHistory((current) => current.at(-1) === facility.id ? current : [...current, facility.id])
    onSettingsChange({ ...normalizedSettings, selectedId: facility.id })
  }
  const historyBack = () => {
    setHistory((current) => {
      if (current.length < 2) return current
      const next = current.slice(0, -1)
      onSettingsChange({ ...normalizedSettings, selectedId: next.at(-1) ?? null })
      return next
    })
  }
  const clearHistory = () => {
    if (fallbackCenter) setHistory([fallbackCenter.id])
  }

  const relationshipPageStyle = {
    '--relationship-compact-progress': headerProgress,
    '--relationship-large-opacity': 1 - headerProgress,
    '--relationship-compact-opacity': headerProgress,
    '--relationship-large-transform': `translateY(${-8 * headerProgress}px) scale(${1 - (.06 * headerProgress)})`,
    '--relationship-compact-transform': `scale(${.94 + (.06 * headerProgress)})`,
    '--relationship-header-shadow-opacity': headerProgress * .18,
    '--relationship-header-top-padding': `${14 - (headerProgress * 8)}px`,
    '--relationship-header-bottom-padding': `${12 - (headerProgress * 6)}px`,
    '--relationship-title-height': `${48 - (headerProgress * 4)}px`,
    '--relationship-mode-height': `${42 - (headerProgress * 6)}px`,
    '--relationship-center-card-height': `${154 - (headerProgress * 66)}px`,
    '--relationship-center-image-width': `${126 - (headerProgress * 54)}px`,
    '--relationship-center-name-size': `${17 - (headerProgress * 3)}px`,
    '--relationship-optional-line-height': `${18 * (1 - headerProgress)}px`,
    '--relationship-related-line-height': `${18 * headerProgress}px`,
    '--relationship-tree-height': `${30 * (1 - headerProgress)}px`,
  } as CSSProperties

  return (
    <main ref={relationshipPageRef} className="relationship-page screen-enter" style={relationshipPageStyle}>
      <header className="relationship-header">
        <button className="back-button" onClick={onBack} aria-label="ホームに戻る">‹</button>
        <div className="relationship-header-copy">
          <div className="relationship-large-title"><p className="eyebrow">RELATIONSHIP</p><h1>施設関係図</h1></div>
          <strong className="relationship-compact-title">{fallbackCenter?.name ?? '施設関係図'}</strong>
        </div>
        <div className="relationship-mode-switch" role="group" aria-label="関係図の表示方法">
          <button type="button" className={normalizedSettings.mode === 'center' ? 'active' : ''} onClick={() => setMode('center')}>中心表示</button>
          <button type="button" className={normalizedSettings.mode === 'overview' ? 'active' : ''} onClick={() => setMode('overview')}>全体表示</button>
        </div>
      </header>
      <p className="relationship-description">
        {normalizedSettings.mode === 'center'
          ? '中心施設と直接関係する施設を、カテゴリ別に表示しています。'
          : '全施設のつながりを俯瞰表示しています。ノードを選択すると直接の関係を強調します。'}
      </p>

      {normalizedSettings.mode === 'center' ? (
        fallbackCenter ? (
          <CenterRelationshipView
            facilities={facilities}
            center={fallbackCenter}
            history={history}
            onSelectCenter={selectCenter}
            onOpenFacility={onOpenFacility}
            onHistoryBack={historyBack}
            onClearHistory={clearHistory}
          />
        ) : <div className="relationship-empty page-empty"><strong>施設がまだありません</strong></div>
      ) : (
        <OverviewRelationshipView
          facilities={facilities}
          settings={normalizedSettings}
          onSettingsChange={onSettingsChange}
          onOpenFacility={onOpenFacility}
        />
      )}
    </main>
  )
}

export function RelationshipGraph(props: RelationshipGraphProps) {
  return <ReactFlowProvider><RelationshipGraphInner {...props} /></ReactFlowProvider>
}
