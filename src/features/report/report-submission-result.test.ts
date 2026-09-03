import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// AC 2.3.2 — merged branch in the submission-result screen. No jsdom /
// testing-library is wired into this project's Vitest config, so these are
// source-text asserts on the component file. They pin the invariants that
// the branch exists, says the merged evidence joined an existing sighting,
// exposes the existing-sighting link, and never renders "Report published"
// for the incoming merged report.

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(resolve(HERE, 'ReportSubmissionResult.tsx'), 'utf8')

describe('ReportSubmissionResult merged branch', () => {
  it('has a dedicated branch for status === "merged"', () => {
    expect(SOURCE).toContain("status === 'merged'")
  })

  it('surfaces the retainedReportId from the polled report', () => {
    expect(SOURCE).toContain('latest.retainedReportId')
    expect(SOURCE).toContain('retainedReportId')
  })

  it('exposes a link to the existing sighting when one is known', () => {
    expect(SOURCE).toContain('View existing sighting')
    expect(SOURCE).toContain('/map?sighting=')
  })

  it('offers a report fallback when there is no sighting id', () => {
    expect(SOURCE).toContain('View report')
  })

  it('never renders "Report published" inside the merged branch', () => {
    const start = SOURCE.indexOf("status === 'merged'")
    expect(start).toBeGreaterThan(-1)
    // Slice out the merged JSX block (up to the closing return of the branch).
    const branch = SOURCE.slice(start, SOURCE.indexOf("status === 'needs_rescan'"))
    expect(branch).not.toContain('Report published')
    expect(branch).toContain('Added to a recent nearby report')
    expect(branch).toContain('Community report - not expert validated')
  })
})
