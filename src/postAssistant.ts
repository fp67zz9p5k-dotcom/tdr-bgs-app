import type { Facility } from './types'

export type PostCandidate = {
  key: string
  facilityId: string
  facilityName: string
  type: 'BGS' | 'トリビア'
  entryId: string
  text: string
}

export type PostDraft = {
  candidateKey: string | null
  text: string
  savedAt: string | null
}

export type PostAssistantState = {
  draft: PostDraft
  postedCandidateKeys: string[]
}

export const defaultPostAssistantState = (): PostAssistantState => ({
  draft: { candidateKey: null, text: '', savedAt: null },
  postedCandidateKeys: [],
})

export const getPostCandidates = (facilities: Facility[], postedCandidateKeys: string[] = []): PostCandidate[] => {
  const posted = new Set(postedCandidateKeys)
  return facilities.flatMap((facility) => [
    ...facility.bgs.filter((entry) => entry.text.trim()).map((entry) => ({
      key: `${facility.id}:bgs:${entry.id}`,
      facilityId: facility.id,
      facilityName: facility.name,
      type: 'BGS' as const,
      entryId: entry.id,
      text: entry.text.trim(),
    })),
    ...facility.trivia.filter((entry) => entry.text.trim()).map((entry) => ({
      key: `${facility.id}:trivia:${entry.id}`,
      facilityId: facility.id,
      facilityName: facility.name,
      type: 'トリビア' as const,
      entryId: entry.id,
      text: entry.text.trim(),
    })),
  ]).sort((a, b) => Number(posted.has(a.key)) - Number(posted.has(b.key)) || a.facilityName.localeCompare(b.facilityName, 'ja'))
}

export const createPostText = (candidate: PostCandidate): string =>
  `${candidate.facilityName}の${candidate.type}。\n${candidate.text}`
