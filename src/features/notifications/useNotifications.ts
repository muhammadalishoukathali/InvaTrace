/**
 * Two hooks for the notification bell. useNotifications polls the unread
 * list every 30s while the tab's actually visible - turned background
 * polling off so a hidden tab doesn't keep hammering the API for no reason.
 * useMarkNotificationRead handles marking one or all as read.
 *
 * useNotifications can be called anywhere you need the count/list, though
 * right now that's only NotificationsPanel.tsx. It's gated on sessionReady
 * from private-access-store.ts so it doesn't fire before there's a profile.
 * One gotcha I ran into: markOne/markAll do a full refetchQueries instead of
 * an optimistic update, so the panel briefly still shows the old unread
 * state until that refetch comes back. Good enough for now, could revisit.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api-client'
import type { AppNotification } from '@/types'
import { usePrivateAccess } from '@/features/private-access/private-access-store'

interface Payload { items: AppNotification[]; unread: number }

export function useNotifications() {
  const sessionReady = usePrivateAccess((state) => state.status === 'ready')
  const profileId = usePrivateAccess((state) => state.profile?.id ?? null)
  return useQuery({
    queryKey: ['notifications', profileId],
    queryFn: () => api<Payload>('/api/v1/notifications'),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 15_000,
    enabled: sessionReady,
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  const profileId = usePrivateAccess((state) => state.profile?.id ?? null)
  return {
    markOne: async (id: string) => {
      await api(`/api/v1/notifications/${id}/read`, { method: 'POST' })
      await qc.refetchQueries({ queryKey: ['notifications', profileId] })
    },
    markAll: async () => {
      await api('/api/v1/notifications/read-all', { method: 'POST' })
      await qc.refetchQueries({ queryKey: ['notifications', profileId] })
    },
  }
}
