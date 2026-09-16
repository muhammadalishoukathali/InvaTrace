// Registers the mock service worker in the browser. Split from handlers.ts so
// the Node-side tests can import the handlers without pulling in msw/browser.
import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)
