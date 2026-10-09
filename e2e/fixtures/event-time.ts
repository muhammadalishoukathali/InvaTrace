import type { Page } from '@playwright/test'

/** Day 15 of next month — always in the future and inside the one-year window. */
export function nextMonthDay(day = 15) {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + 1, day)
}

/** Drive the host form's calendar: next month, the given day, hour, then duration. */
export async function pickEventTime(page: Page, { hour = 8, duration = '2 h', day = 15 } = {}) {
  await page.getByRole('button', { name: 'Next month' }).click()
  await page.getByRole('group', { name: /^Days in / }).getByRole('button', { name: new RegExp(` ${day} `) }).click()
  await page.getByRole('group', { name: 'Hour' }).getByRole('button', { name: String(hour).padStart(2, '0'), exact: true }).click()
  await page.getByRole('group', { name: 'Minute' }).getByRole('button', { name: ':00', exact: true }).click()
  await page.getByRole('group', { name: 'Duration' }).getByRole('button', { name: duration, exact: true }).click()
}
