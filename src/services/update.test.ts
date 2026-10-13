import { afterEach, expect, it, vi } from 'vitest'

const { check } = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  check.mockReset()
})

it('does not call the upstream updater in a custom build', async () => {
  vi.stubEnv('VITE_CVR_CUSTOM_BUILD', '1')
  const { checkUpdateSafe } = await import('./update')
  await expect(checkUpdateSafe()).resolves.toBeNull()
  expect(check).not.toHaveBeenCalled()
})
