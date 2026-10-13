import { afterEach, expect, it, vi } from 'vitest'

import layout from '@/locales/en/layout.json'
import settings from '@/locales/en/settings.json'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('brands runtime titles and service notices without altering attribution', async () => {
  vi.stubEnv('VITE_CVR_APP_NAME', 'Aurora $&')
  vi.stubEnv('VITE_CVR_SERVICE_DISPLAY_NAME', 'Aurora $& service')
  vi.stubEnv('VITE_CVR_CUSTOM_BUILD', '1')
  const { applyLocaleBranding } = await import('./i18n-branding')
  const resources = structuredClone(settings)
  applyLocaleBranding('settings', resources)
  expect(resources.components.verge.basic.title).toBe('Aurora $& Basic Setting')
  expect(resources.feedback.errors.sysproxy.privilegeRequired).toContain(
    'Aurora $& service',
  )
  const attribution = { attribution: 'Based on Clash Verge Rev' }
  applyLocaleBranding('settings', attribution)
  expect(attribution.attribution).toBe('Based on Clash Verge Rev')
  const messages = structuredClone(layout)
  applyLocaleBranding('layout', messages)
  expect(messages.components.serviceMigration.message).toContain(
    'Aurora $& service',
  )
})

it('preserves upstream localized labels in an unconfigured build', async () => {
  vi.stubEnv('VITE_CVR_CUSTOM_BUILD', '0')
  const { applyLocaleBranding } = await import('./i18n-branding')
  const resources = structuredClone(settings)
  applyLocaleBranding('settings', resources)
  expect(resources).toEqual(settings)
})

it('uses an independent service display name while preserving localized service terms', async () => {
  vi.stubEnv('VITE_CVR_APP_NAME', 'Aurora')
  vi.stubEnv('VITE_CVR_SERVICE_DISPLAY_NAME', 'Polar Agent')
  vi.stubEnv('VITE_CVR_CUSTOM_BUILD', '1')
  const { applyLocaleBranding } = await import('./i18n-branding')
  const messages = structuredClone(layout)
  applyLocaleBranding('layout', messages)
  expect(messages.components.serviceMigration.message).toContain(
    'The Polar Agent version',
  )
  expect(messages.components.sysproxyPrivilege.tunMessage).toContain(
    'Aurora system service',
  )
})
