import type { Facility } from './types'

export const getBidirectionalRelatedFacilityIds = (
  facilities: Facility[],
  facilityId: string,
): string[] => {
  const facility = facilities.find((item) => item.id === facilityId)
  const relatedIds = new Set<string>(facility?.relatedFacilityIds ?? [])

  facilities.forEach((item) => {
    if (item.relatedFacilityIds.includes(facilityId)) relatedIds.add(item.id)
  })

  relatedIds.delete(facilityId)
  return [...relatedIds].filter((id) => facilities.some((item) => item.id === id))
}

export const getBidirectionalRelatedFacilities = (
  facilities: Facility[],
  facilityId: string,
): Facility[] => {
  const ids = new Set(getBidirectionalRelatedFacilityIds(facilities, facilityId))
  return facilities.filter((item) => ids.has(item.id))
}

export type FacilityRelationship = {
  id: string
  source: string
  target: string
}

export const getUniqueBidirectionalRelationships = (
  facilities: Facility[],
): FacilityRelationship[] => {
  const validIds = new Set(facilities.map((facility) => facility.id))
  const seen = new Set<string>()
  const relationships: FacilityRelationship[] = []

  facilities.forEach((facility) => {
    facility.relatedFacilityIds.forEach((targetId) => {
      if (targetId === facility.id || !validIds.has(targetId)) return
      const [source, target] = [facility.id, targetId].sort()
      const id = `${source}--${target}`
      if (seen.has(id)) return
      seen.add(id)
      relationships.push({ id, source, target })
    })
  })

  return relationships
}
