// This is the single TanStack Query client for the whole app, set up once in
// src/main.tsx and shared by every feature that pulls server data (map
// sightings, notifications, etc). Kept the retry/stale-time config here so
// I'm not repeating the same defaults across every feature that fetches data.
import { QueryClient } from '@tanstack/react-query'

// went with pretty generous retries + backoff here because this whole app is
// meant to work out in the field where connectivity is unreliable (see
// docs/product.md) - didn't want one dropped request throwing an error at
// someone standing on a trail with one bar of signal
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
      staleTime: 30_000,
    },
  },
})
