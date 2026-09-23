// Mobile-only check for the camera capture screen. Runs under the
// "mobile-chromium" Playwright project (Pixel 5 viewport) - that's the only
// project this spec is matched against. Guards against the camera staying on
// (battery drain, privacy risk) when the tab gets backgrounded mid-scan, and
// against layout overflow on a narrow screen.
import { expect, test, type Page } from '@playwright/test'

async function startPrivateAccess(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start privately' }).click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue to InvaTrace' }).click()
  await expect(page).toHaveURL(/\/map$/)
}

// Fires pagehide rather than a normal navigation, since that's the case most
// likely to leave a camera stream running if the cleanup logic isn't wired up
// properly (a real navigation would tear things down more predictably).
test('mobile scan stops the camera on interruption and stays within the viewport', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 480
        const stream = canvas.captureStream(5)
        Object.assign(window, { __testCameraStream: stream })
        return stream
      },
    })
  })
  await startPrivateAccess(page)
  await expect(page.getByRole('link', { name: 'Browse places' })).toBeVisible()
  await page.goto('/scan')
  await page.getByRole('button', { name: 'Open camera' }).click()
  await expect(page.getByRole('heading', { name: 'Frame one clear plant feature' })).toBeVisible()

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))

  await expect(page.getByText('Camera closed when the app was interrupted')).toBeVisible()
  const state = await page.evaluate(() => {
    const stream = (window as Window & { __testCameraStream: MediaStream }).__testCameraStream
    return {
      trackStates: stream.getTracks().map((track) => track.readyState),
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }
  })
  expect(state.trackStates).toEqual(['ended'])
  expect(state.documentWidth).toBeLessThanOrEqual(state.viewportWidth)
})

// UT-02: when the camera cannot provide a usable image, the user must not be
// stuck - they get a clear error and an obvious gallery fallback, and a photo
// picked from the library still flows through to a usable, large preview.
test('a failed camera offers a gallery fallback that produces a usable preview', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        throw new DOMException('Permission denied', 'NotAllowedError')
      },
    })
  })
  await startPrivateAccess(page)
  await page.goto('/scan')

  // The camera fails to start, so the error and its fallbacks appear.
  await page.getByRole('button', { name: 'Open camera' }).click()
  const cameraError = page.getByRole('alert')
  await expect(cameraError).toContainText('Camera access was unavailable')
  await expect(cameraError.getByRole('button', { name: 'Choose from library' })).toBeVisible()

  // Falling back to a library photo still reaches a usable, checked preview.
  await page.locator('input[aria-label="Choose photo from gallery"]').setInputFiles(
    'public/reference-images/mikania-micrantha.jpg',
  )
  await expect(page.getByText('Photo quality check passed')).toBeVisible({ timeout: 5000 })
  await expect(page.getByRole('button', { name: /Analyse plant/ })).toBeVisible()
  const previewBox = await page.locator('.scan-capture__preview img[alt="Captured plant"]').boundingBox()
  expect(previewBox?.height ?? 0).toBeGreaterThan(200)
})
