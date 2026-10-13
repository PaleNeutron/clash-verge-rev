import { afterEach, expect, it, vi } from 'vitest'

import { version } from '@root/package.json'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('preserves upstream TUN device defaults without build overrides', async () => {
  vi.stubEnv('VITE_CVR_TUN_DEVICE', undefined)
  vi.stubEnv('VITE_CVR_TUN_DEVICE_MACOS', undefined)
  const { getDefaultTunDevice } = await import('./branding')
  expect(getDefaultTunDevice('linux')).toBe('Mihomo')
  expect(getDefaultTunDevice('windows')).toBe('Mihomo')
  expect(getDefaultTunDevice('macos')).toBe('utun1024')
})

it('uses compiled device defaults for reset and empty field fallback', async () => {
  vi.stubEnv('VITE_CVR_TUN_DEVICE', 'aurora')
  vi.stubEnv('VITE_CVR_TUN_DEVICE_MACOS', 'utun2048')
  const { getDefaultTunDevice } = await import('./branding')
  expect(getDefaultTunDevice('linux')).toBe('aurora')
  expect(getDefaultTunDevice('windows')).toBe('aurora')
  expect(getDefaultTunDevice('macos')).toBe('utun2048')
})

it('uses the installed executable identity in the profile user agent', async () => {
  vi.stubEnv('VITE_CVR_APP_BINARY', 'aurora')
  const { USER_AGENT } = await import('./branding')
  expect(USER_AGENT).toBe(`aurora/v${version}`)
})
