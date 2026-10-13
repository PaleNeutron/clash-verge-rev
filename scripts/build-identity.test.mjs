import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import * as serviceRelease from './service-release.mjs'

async function implementation() {
  assert.ok(
    existsSync(new URL('./build-identity.mjs', import.meta.url)),
    'build identity resolver is not implemented',
  )
  return import('./build-identity.mjs')
}

test('CLI target and feature aliases select matching installer and service channels', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cvr-build-cli-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.cp(
    path.resolve(import.meta.dirname, '../src-tauri/packages'),
    path.join(root, 'src-tauri/packages'),
    { recursive: true },
  )
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith('CVR_') && !key.startsWith('VITE_CVR_'),
      ),
    ),
    CVR_BRAND: 'aurora',
  }
  for (const args of [
    ['--target=x86_64-pc-windows-msvc', '--features=verge-dev'],
    ['-t', 'x86_64-pc-windows-msvc', '-f', 'tauri-dev', 'verge-dev'],
  ]) {
    const configFile = execFileSync(
      process.execPath,
      [path.join(import.meta.dirname, 'build.mjs'), '--prepare-only', ...args],
      { cwd: root, env, encoding: 'utf8' },
    ).trim()
    const config = JSON.parse(await fs.readFile(configFile, 'utf8'))
    assert.equal(config.identifier, 'io.github.paleneutron.aurora.dev')
    assert.ok(config.bundle.windows?.nsis.template)
    const template = await fs.readFile(
      path.join(root, 'src-tauri', config.bundle.windows.nsis.template),
      'utf8',
    )
    assert.ok(template.includes('SimpleSC::ExistsService "aurora_service_dev"'))
  }
})

test('rebuilding a service removes obsolete bundled names and preserves unrelated resources', async (t) => {
  assert.equal(
    typeof serviceRelease.publishServiceBundle,
    'function',
    'service bundle publication is not implemented',
  )
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cvr-service-bundle-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const state = path.join(root, 'state.json')
  const resources = path.join(root, 'resources')
  await fs.mkdir(resources)
  for (const name of [
    'clash-verge-service.exe',
    'old-agent.exe',
    'aurora-service.exe',
    'Country.mmdb',
  ])
    await fs.writeFile(path.join(resources, name), name)
  await fs.writeFile(state, JSON.stringify(['old-agent.exe']))
  await serviceRelease.publishServiceBundle(
    resources,
    ['aurora-service.exe'],
    state,
    ['clash-verge-service.exe'],
  )
  assert.deepEqual((await fs.readdir(resources)).sort(), [
    'Country.mmdb',
    'aurora-service.exe',
  ])
  assert.deepEqual(JSON.parse(await fs.readFile(state)), ['aurora-service.exe'])
})

test('unconfigured builds preserve upstream executable and service identity', async () => {
  const { resolveBuildIdentity } = await implementation()
  const env = resolveBuildIdentity({})
  assert.equal(env.CVR_APP_BINARY, 'clash-verge')
  assert.equal(env.CVR_CORE_NAME, 'verge-mihomo')
  assert.equal(env.CVR_WINDOWS_SERVICE_NAME, 'clash_verge_service')
  assert.equal(env.CVR_TUN_DEVICE, 'Mihomo')
  assert.equal(env.CVR_CUSTOM_BUILD, '0')
})

test('a brand propagates to distinct executable, service, IPC and data names', async () => {
  const { resolveBuildIdentity } = await implementation()
  const env = resolveBuildIdentity({
    CVR_BRAND: 'aurora',
    CVR_APP_NAME: 'Aurora Network',
    CVR_CORE_ALPHA_NAME: 'aurora-preview',
  })
  assert.equal(env.CVR_APP_NAME, 'Aurora Network')
  assert.equal(env.CVR_APP_BINARY, 'aurora')
  assert.equal(env.CVR_APP_ID, 'io.github.paleneutron.aurora')
  assert.equal(env.CVR_CORE_NAME, 'aurora-core')
  assert.equal(env.CVR_CORE_ALPHA_NAME, 'aurora-preview')
  assert.equal(env.CVR_SERVICE_BINARY, 'aurora-service')
  assert.equal(env.CVR_WINDOWS_SERVICE_NAME, 'aurora_service')
  assert.equal(env.CVR_OWNER_TOKEN_FILE, '.aurora-service-owner-token')
  assert.equal(env.CVR_CORE_IPC_NAME, 'aurora-core')
  assert.equal(env.CVR_BACKUP_DIR, 'aurora-backup')
  assert.equal(env.CVR_CUSTOM_BUILD, '1')
})

test('invalid names and colliding bundled executables fail before compilation', async () => {
  const { resolveBuildIdentity } = await implementation()
  for (const env of [
    { CVR_BRAND: '../aurora' },
    { CVR_APP_NAME: 'Aurora $INSTDIR' },
    { CVR_APP_ID: 'not an identifier' },
    { CVR_TUN_DEVICE: 'too-long-interface' },
    { CVR_TUN_DEVICE_MACOS: 'aurora0' },
    { CVR_CORE_IPC_NAME: 'a'.repeat(40) },
    { CVR_SERVICE_SLUG: 'a'.repeat(40) },
    { CVR_CORE_NAME: 'aurora.next' },
    { CVR_CORE_ALPHA_NAME: 'aurora.old' },
    { CVR_APP_BINARY: 'same', CVR_CORE_NAME: 'same' },
  ])
    assert.throws(() => resolveBuildIdentity(env))
})

test('generated Windows and Linux installers use the custom identity at install boundaries', async (t) => {
  const { resolveBuildIdentity, prepareBuildConfig } = await implementation()
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cvr-identity-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = path.resolve(import.meta.dirname, '..')
  await fs.cp(
    path.join(source, 'src-tauri', 'packages'),
    path.join(root, 'src-tauri', 'packages'),
    { recursive: true },
  )
  const env = resolveBuildIdentity({
    CVR_BRAND: 'aurora',
    CVR_APP_NAME: 'Aurora Network',
  })
  const windows = await prepareBuildConfig(
    root,
    { ...env, REVIEW_SENTINEL_SECRET: 'dummy', CVR_UNKNOWN_SECRET: 'dummy' },
    'win32',
  )
  const recorded = JSON.parse(
    await fs.readFile(
      path.join(root, 'src-tauri/gen/build-identity/identity.json'),
      'utf8',
    ),
  )
  assert.equal(recorded.REVIEW_SENTINEL_SECRET, undefined)
  assert.equal(recorded.CVR_UNKNOWN_SECRET, undefined)
  assert.equal(recorded.CVR_APP_NAME, 'Aurora Network')
  const config = JSON.parse(await fs.readFile(windows, 'utf8'))
  assert.equal(config.mainBinaryName, 'aurora')
  assert.equal(config.productName, 'Aurora Network')
  assert.equal(config.identifier, 'io.github.paleneutron.aurora')
  assert.equal(config.bundle.createUpdaterArtifacts, false)
  assert.deepEqual(config.plugins['deep-link'].desktop.schemes, ['aurora'])
  assert.deepEqual(config.bundle.externalBin, [
    'sidecar/aurora-core',
    'sidecar/aurora-core-alpha',
  ])
  const installer = await fs.readFile(
    path.join(root, 'src-tauri', config.bundle.windows.nsis.template),
    'utf8',
  )
  assert.match(installer, /SimpleSC::ExistsService "aurora_service"/)
  assert.match(installer, /resources\\aurora-service-install\.exe/)
  assert.doesNotMatch(
    installer,
    /FindProcess[^\n]*"(?:clash-meta|clash-verge|verge-mihomo)/,
  )
  const linux = JSON.parse(
    await fs.readFile(await prepareBuildConfig(root, env, 'linux'), 'utf8'),
  )
  assert.deepEqual(linux.bundle.linux.deb.provides, ['aurora'])
  assert.deepEqual(linux.bundle.linux.deb.conflicts, ['aurora'])
  const preRemove = await fs.readFile(
    path.join(root, 'src-tauri', linux.bundle.linux.deb.preRemoveScript),
    'utf8',
  )
  assert.match(preRemove, /\/usr\/bin\/aurora-service-uninstall/)
  const upstream = JSON.parse(
    await fs.readFile(
      await prepareBuildConfig(root, resolveBuildIdentity({}), 'win32'),
      'utf8',
    ),
  )
  const originalInstaller = await fs.readFile(
    path.join(root, 'src-tauri', upstream.bundle.windows.nsis.template),
    'utf8',
  )
  assert.match(originalInstaller, /FindProcess "clash-meta\.exe"/)
})
