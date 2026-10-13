import { createInstance } from 'i18next'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import settings from '@/locales/en/settings.json'
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) =>
    snapshot(),
}))
vi.mock('@/utils/open-external-url', () => ({ openExternalUrl: vi.fn() }))

let notices: typeof import('@/services/notice-service')
let NoticeManager: typeof import('./notice-manager')['NoticeManager']

beforeEach(async () => {
  vi.stubEnv('VITE_CVR_CORE_NAME', 'verge-mihomo')
  vi.stubEnv('VITE_CVR_CORE_ALPHA_NAME', 'verge-mihomo-alpha')
  vi.resetModules()
  notices = await import('@/services/notice-service')
  NoticeManager = (await import('./notice-manager')).NoticeManager
}, 60_000)

afterEach(async () => {
  const { getSnapshotNotices, hideNotice } = await import(
    '@/services/notice-service'
  )
  getSnapshotNotices().forEach(({ id }) => hideNotice(id))
  vi.unstubAllEnvs()
  vi.resetModules()
})

it.each([
  [
    'startup',
    'process verge-mihomo remains after IPC failure; refusing a second core',
  ],
  [
    'restart',
    'process verge-mihomo-alpha remains after IPC failure; refusing a second core',
  ],
  [
    'sidecar',
    'Service core rejected: permission denied; Sidecar fallback failed: process verge-mihomo.exe (PID 123) is still running; refusing a second core',
  ],
])(
  'explains an occupied core during %s and preserves diagnostics',
  async (operation, detail) => {
    const { showNotice, syncSidecarFailure } = notices
    if (operation === 'startup') {
      showNotice.error('settings.feedback.errors.clash.startFailed', detail)
    } else if (operation === 'restart') {
      showNotice.error({ code: 'CORE_RESTART_FAILED', detail })
    } else {
      syncSidecarFailure({ revision: 1, detail })
    }
    const i18n = createInstance()
    await i18n.init({
      lng: 'en',
      resources: { en: { translation: { settings } } },
    })
    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(NoticeManager)),
    )
    expect(html).toContain('a core process is already running')
    expect(html).toContain('Close the related app or stop the leftover process')
    expect(html).toContain(detail)
    if (operation === 'sidecar') {
      expect(html).toContain('service-core-permissions')
      expect(html).toContain('PID 123')
    }
  },
)

it('explains an occupied branded core without losing its PID', async () => {
  vi.stubEnv('VITE_CVR_CORE_NAME', 'aurora-core')
  vi.stubEnv('VITE_CVR_CORE_ALPHA_NAME', 'aurora-core-alpha')
  vi.resetModules()
  const notices = await import('@/services/notice-service')
  const { NoticeManager: BrandedNoticeManager } = await import(
    './notice-manager'
  )
  const detail =
    'process aurora-core-alpha.exe (PID 456) is still running; refusing a second core'
  notices.showNotice.error({ code: 'CORE_RESTART_FAILED', detail })
  try {
    const i18n = createInstance()
    await i18n.init({
      lng: 'en',
      resources: { en: { translation: { settings } } },
    })
    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(BrandedNoticeManager),
      ),
    )
    expect(html).toContain('a core process is already running')
    expect(html).toContain('PID 456')
    expect(html).toContain(detail)
  } finally {
    notices.getSnapshotNotices().forEach(({ id }) => notices.hideNotice(id))
  }
})
