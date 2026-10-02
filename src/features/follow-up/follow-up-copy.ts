import type { FollowUpOutcome } from '@/services/api/followUp'

export const FOLLOW_UP_LOCATION_ERRORS: Record<string, { title: string; body: string }> = {
  follow_up_location_stale: {
    title: 'Get a fresh location',
    body: 'Use your current GPS location, then try again while you are at the reported plant.',
  },
  follow_up_accuracy_too_low: {
    title: 'Location accuracy is too low',
    body: 'Move outdoors with a clearer view of the sky and retry when accuracy is 250 m or better.',
  },
  follow_up_too_far: {
    title: 'You are too far from this sighting',
    body: 'Follow-up can only be recorded within 250 m of the reported plant.',
  },
  follow_up_location_unavailable: {
    title: 'Location could not be checked',
    body: 'Try again when a current GPS location is available.',
  },
}

export const OUTCOME_COPY: Record<FollowUpOutcome, { label: string; description: string; next: string; completed: string }> = {
  no_regrowth: {
    label: 'No regrowth found',
    description: 'The plant was not found growing again at this location.',
    next: 'The marker will be resolved and hidden from the default map.',
    completed: 'The marker is resolved and hidden from the default map.',
  },
  regrowth_present: {
    label: 'Regrowth present',
    description: 'The plant appears to be growing again at this location.',
    next: 'The marker will return to the active map with a regrowth label.',
    completed: 'The marker has returned to the active map with a regrowth label.',
  },
  unable_to_confirm: {
    label: 'Unable to confirm',
    description: 'Conditions did not allow a reliable check today.',
    next: 'The marker will remain grey and needs another follow-up.',
    completed: 'The marker remains grey and needs another follow-up.',
  },
}
