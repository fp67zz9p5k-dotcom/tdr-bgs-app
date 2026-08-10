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
