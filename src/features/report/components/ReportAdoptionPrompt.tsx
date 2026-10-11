import { PlantLoader } from '@/components/PlantLoader'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api-client'
import type { AdoptedAreaListResponse, PlaceDetail } from '@/types'
import './report-adoption-prompt.css'

interface Props {
  reportId: string
  /** Where the report was submitted; the prompt is for the supported place around it. */
  location: { lat: number; lng: number }
}

/**
 * AC 6.1.2: after a report lands inside or along a supported place, offer to
 * save that place as a monitoring bookmark. This used to live only in
 * ReportTrackingPage.tsx; it was pulled out so the confirmation screen
 * (ReportSubmissionResult.tsx) shows the same prompt with the same wording,
 * instead of the user having to open the report to find it.
 *
 * It renders nothing when the report is not in a supported place, or when
 * this user has already adopted that place. "Not now" only hides the prompt:
 * it sends nothing, so the report is untouched and no adoption is created.
 */
export function ReportAdoptionPrompt({ reportId, location }: Props) {
  const queryClient = useQueryClient()
  const [dismissed, setDismissed] = useState(false)
  const adoptionPlace = useQuery({
    queryKey: ['report-adoption-place', reportId, location],
    queryFn: () => api<{ place: PlaceDetail | null }>(
      `/api/v1/places/at-location?lat=${location.lat}&lon=${location.lng}`,
    ),
  })
  // Same key as PlaceDetailPage.tsx, so an adoption made anywhere else is seen here too.
  const adoptions = useQuery({
    queryKey: ['adopted-areas', 'recent_activity'],
    queryFn: () => api<AdoptedAreaListResponse>('/api/v1/adopted-areas?sort=recent_activity'),
  })
  const adopt = useMutation({
    mutationFn: (placeId: string) => api<{ adoptionId: string }>(
      '/api/v1/adopted-areas',
      { method: 'POST', body: JSON.stringify({ placeId }) },
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adopted-areas'] }),
  })

  const place = adoptionPlace.data?.place
  // Presentation-safe: trails are no longer offered for new adoptions.
  // Existing trail adoptions remain visible on the user's My Adopted Areas
  // page — this only hides the prompt for a new one.
  if (!place || place.placeType === 'trail' || dismissed) return null
  // Wait for the list before offering, so an already-adopted place never
  // flashes the prompt. Once adopted from here, keep the confirmation visible.
  if (!adopt.isSuccess) {
    if (adoptions.isLoading) return null
    if (adoptions.data?.items.some((item) => item.placeId === place.placeId)) return null
  }

  return (
    <section className="report-adoption-prompt" aria-labelledby="report-adoption-heading">
      <h2 id="report-adoption-heading">Adopt this area for monitoring?</h2>
      <p className="report-adoption-prompt__text">
        Your report is inside or along <strong>{place.displayName}</strong>.
        Save it as a non-exclusive monitoring bookmark. This does not grant ownership,
        responsibility, access rights or removal permission.
      </p>
      {adopt.isSuccess ? (
        <p className="report-adoption-prompt__text" role="status">{place.displayName} is adopted for monitoring.</p>
      ) : (
        <div className="report-adoption-prompt__actions">
          <button
            type="button"
            onClick={() => adopt.mutate(place.placeId)}
            disabled={adopt.isPending}
          >
            {adopt.isPending ? <PlantLoader compact label="Adding…" /> : 'Adopt for monitoring'}
          </button>
          <button type="button" onClick={() => setDismissed(true)}>Not now</button>
        </div>
      )}
      {adopt.isError && (
        <p className="report-adoption-prompt__text" role="alert">
          This monitoring bookmark could not be saved. Check your connection and try again.
        </p>
      )}
    </section>
  )
}
