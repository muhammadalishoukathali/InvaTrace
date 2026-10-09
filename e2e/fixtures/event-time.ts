import type { Page } from '@playwright/test'

/** Day 15 of next month — always in the future and inside the one-year window. */
export function nextMonthDay(day = 15) {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + 1, day)
}

/** Drive the host form's drop-downs: date (next month), hour, minute, then duration. */
export async function pickEventTime(page: Page, { hour = 8, duration = '2 h', day = 15 } = {}) {
  await page.getByRole('button', { name: /^Date / }).click()
  await page.getByRole('button', { name: 'Next month' }).click()
  await page.getByRole('group', { name: /^Days in / }).getByRole('button', { name: new RegExp(` ${day} `) }).click()
  await page.getByRole('button', { name: /^Start time / }).click()
  await page.getByRole('group', { name: 'Hour' }).getByRole('button', { name: String(hour).padStart(2, '0'), exact: true }).click()
  await page.getByRole('group', { name: 'Minute' }).getByRole('button', { name: ':00', exact: true }).click()
  await page.getByRole('button', { name: /^How long / }).click()
  await page.getByRole('list', { name: 'Duration' }).getByRole('button', { name: new RegExp(`^${duration} until`) }).click()
}
