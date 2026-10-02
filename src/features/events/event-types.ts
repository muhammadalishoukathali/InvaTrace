import type { EventType } from '@/services/api/events'
export const eventTypeLabels: Record<EventType, string> = { survey: 'Community survey', removal: 'Removal activity', monitoring: 'Repeat monitoring', other: 'Other community activity' }
export const eventTypeGuidance: Record<EventType, string> = {
  survey: 'Record observations carefully. Community reports are not expert-validated.',
  removal: 'Joining does not give permission to remove plants. Follow the host’s safety and permission instructions.',
  monitoring: 'Return observations help show changes over time; they do not prove treatment success.',
  other: 'Check the host’s purpose, location and safety information before attending.',
}
