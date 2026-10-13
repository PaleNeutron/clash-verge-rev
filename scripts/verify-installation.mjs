import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveBuildIdentity } from './build-identity.mjs'

const identity = resolveBuildIdentity()
const target = process.argv[2]
assert.ok(target, 'Verification requires a target triple')
const bundle = path.resolve('target', target, 'release', 'bundle')
const evidence = { target, identity, checks: [] }
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'installed-identity-'))
const windows = process.platform === 'win32'
const macos = process.platform === 'darwin'
const ext = windows ? '.exe' : ''
const run = (command, args = [], options = {}) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim()
const powershell = (script) =>
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
const privileged = (command, args) =>
  windows ? run(command, args) : run('sudo', [command, ...args])
const check = (name) => {
  evidence.checks.push(name)
  console.log(`Verified ${name}`)
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(predicate, description) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await predicate()) return
    await delay(500)
  }
  throw new Error(`Timed out waiting for ${description}`)
}
async function files(directory) {
  const result = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...(await files(filename)))
    else result.push(filename)
  }
  return result
}
function running(name) {
  if (windows)
    return (
      powershell(
        `@(Get-Process -Name '${name}' -ErrorAction SilentlyContinue).Count`,
      ) !== '0'
    )
  if (!macos)
    return (
      run('sudo', [
        'python3',
        '-c',
        'import os,sys\nfor p in os.listdir("/proc"):\n if not p.isdigit(): continue\n try:\n  if os.path.basename(os.readlink("/proc/"+p+"/exe")) == sys.argv[1]: print("running"); break\n except OSError: pass',
        name,
      ]) === 'running'
    )
  return run('ps', ['-axo', 'comm'])
    .split('\n')
    .some((line) => path.basename(line.trim()) === name)
}

let appDirectory
let toolsDirectory
let uninstaller
let appUninstaller
let packageName
let appProcess
const driver = path.resolve(
  'target',
  'bundled-service',
  target,
  'release',
  `service-integration-driver${ext}`,
)
try {
  const artifacts = await files(bundle)
  if (windows) {
    const installer = artifacts.find((file) => file.endsWith('-setup.exe'))
    assert.ok(installer, 'NSIS installer is missing')
    appDirectory = path.join(process.env.ProgramFiles, identity.CVR_APP_NAME)
    powershell(
      `$p = Start-Process -FilePath '${installer.replaceAll("'", "''")}' -ArgumentList '/S' -Wait -PassThru; if ($p.ExitCode -ne 0) { throw "Installer failed: $($p.ExitCode)" }`,
    )
    toolsDirectory = path.join(appDirectory, 'resources')
    appUninstaller = path.join(appDirectory, 'uninstall.exe')
  } else if (macos) {
    const app = artifacts
      .find((file) => file.endsWith('/Info.plist'))
      ?.replace(/\/Contents\/Info\.plist$/, '')
    assert.ok(app, 'Application bundle is missing')
    appDirectory = path.join(
      '/Applications',
      `${identity.CVR_APP_NAME}.app`,
      'Contents',
      'MacOS',
    )
    privileged('ditto', [app, path.dirname(path.dirname(appDirectory))])
    toolsDirectory = path.join(
      path.dirname(appDirectory),
      'Resources',
      'resources',
    )
    const bundleId = run('/usr/libexec/PlistBuddy', [
      '-c',
      'Print :CFBundleIdentifier',
      path.join(path.dirname(appDirectory), 'Info.plist'),
    ])
    assert.equal(bundleId, identity.CVR_APP_ID)
  } else {
    const deb = artifacts.find((file) => file.endsWith('.deb'))
    assert.ok(deb, 'Debian package is missing')
    packageName = run('dpkg-deb', ['-f', deb, 'Package'])
    privileged('dpkg', ['-i', deb])
    appDirectory = '/usr/bin'
    toolsDirectory = appDirectory
    const listing = run('dpkg', ['-L', packageName])
    assert.ok(listing.includes(`/usr/bin/${identity.CVR_APP_BINARY}`))
    assert.ok(listing.includes(`/usr/bin/${identity.CVR_CORE_NAME}`))
  }
  const app = path.join(appDirectory, `${identity.CVR_APP_BINARY}${ext}`)
  const stable = path.join(appDirectory, `${identity.CVR_CORE_NAME}${ext}`)
  const alpha = path.join(appDirectory, `${identity.CVR_CORE_ALPHA_NAME}${ext}`)
  const service = path.join(
    toolsDirectory,
    `${identity.CVR_SERVICE_BINARY}${ext}`,
  )
  const install = path.join(
    toolsDirectory,
    `${identity.CVR_SERVICE_BINARY}-install${ext}`,
  )
  uninstaller = path.join(
    toolsDirectory,
    `${identity.CVR_SERVICE_BINARY}-uninstall${ext}`,
  )
  for (const filename of [app, stable, alpha, service, install, uninstaller])
    assert.ok(
      (await fs.stat(filename)).isFile(),
      `Missing installed executable: ${filename}`,
    )
  run(stable, ['-v'])
  run(alpha, ['-v'])
  check(
    'installed application, stable/alpha cores and service helper filenames',
  )

  const coreArgs = []
  for (const filename of [stable, alpha])
    coreArgs.push(
      '--install-core',
      filename,
      '--sha256',
      createHash('sha256')
        .update(await fs.readFile(filename))
        .digest('hex'),
    )
  privileged(install, ['--install-service', ...coreArgs])
  if (windows) {
    const serviceInfo = JSON.parse(
      powershell(
        `Get-CimInstance Win32_Service -Filter "Name='${identity.CVR_WINDOWS_SERVICE_NAME}'" | Select-Object Name,DisplayName,PathName | ConvertTo-Json -Compress`,
      ),
    )
    assert.equal(serviceInfo.Name, identity.CVR_WINDOWS_SERVICE_NAME)
    assert.equal(serviceInfo.DisplayName, identity.CVR_SERVICE_DISPLAY_NAME)
    assert.ok(
      serviceInfo.PathName.includes(`${identity.CVR_SERVICE_BINARY}.exe`),
    )
  } else if (macos)
    run('sudo', [
      'launchctl',
      'print',
      `system/${identity.CVR_MACOS_SERVICE_ID}`,
    ])
  else run('systemctl', ['is-active', `${identity.CVR_SERVICE_SLUG}.service`])
  check('registered service identity and executable path')
  run(driver, ['ready'], { cwd: root })
  check('matching service/client compiled IPC namespace')

  const token = randomBytes(32)
  const driverEnv = {
    ...process.env,
    CLASH_VERGE_TEST_SESSION_TOKEN: randomBytes(32).toString('hex'),
  }
  if (windows) {
    driverEnv.CLASH_VERGE_TEST_OWNER_TOKEN = token.toString('hex')
    driverEnv.CLASH_VERGE_TEST_OWNER_SID = powershell(
      '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    )
    const tokenFile = path.join(root, identity.CVR_OWNER_TOKEN_FILE)
    await fs.writeFile(tokenFile, token)
    const sid = driverEnv.CLASH_VERGE_TEST_OWNER_SID
    powershell(
      `$acl=New-Object System.Security.AccessControl.FileSecurity; $acl.SetSecurityDescriptorSddlForm('O:${sid}G:${sid}D:P(A;;FA;;;${sid})(A;;FA;;;SY)(A;;FA;;;BA)'); Set-Acl -LiteralPath '${tokenFile}' -AclObject $acl`,
    )
  }
  const config = path.join(root, 'tun.yaml')
  const device = macos ? identity.CVR_TUN_DEVICE_MACOS : identity.CVR_TUN_DEVICE
  await fs.writeFile(
    config,
    `mode: rule\nmixed-port: 0\nipv6: false\ntun:\n  enable: true\n  device: ${device}\n  stack: system\n  auto-route: false\n  auto-detect-interface: true\n`,
  )
  driverEnv.CLASH_VERGE_TEST_CONFIG_PATH = config
  for (const core of [stable, alpha]) {
    driverEnv.CLASH_VERGE_TEST_CORE_PATH = core
    const generation = run(driver, ['start'], { cwd: root, env: driverEnv })
    driverEnv.CLASH_VERGE_TEST_SESSION_GENERATION = generation
    try {
      await waitFor(
        () => running(path.basename(core, ext)),
        'service-owned core process',
      )
      await waitFor(() => {
        try {
          if (windows)
            return (
              powershell(
                `@(Get-NetAdapter -Name '${device}' -ErrorAction SilentlyContinue).Count`,
              ) !== '0'
            )
          if (macos) run('ifconfig', [device])
          else run('ip', ['link', 'show', 'dev', device])
          return true
        } catch {
          return false
        }
      }, `TUN ${device}`)
      check(`service core process ${path.basename(core)} and TUN ${device}`)
    } finally {
      run(driver, ['stop'], { cwd: root, env: driverEnv })
    }
  }

  appProcess =
    process.platform === 'linux'
      ? spawn('xvfb-run', ['-a', app], { stdio: 'ignore' })
      : spawn(app, [], { stdio: 'ignore' })
  await waitFor(
    () => running(identity.CVR_APP_BINARY),
    'installed main application process',
  )
  check('installed main application process name')
  if (windows)
    powershell(
      `Get-Process -Name '${identity.CVR_APP_BINARY}' -ErrorAction SilentlyContinue | Stop-Process -Force`,
    )
  else run('pkill', ['-f', app])
  appProcess = undefined
  privileged(uninstaller, [])
  uninstaller = undefined
  if (windows)
    assert.equal(
      powershell(
        `@(Get-Service -Name '${identity.CVR_WINDOWS_SERVICE_NAME}' -ErrorAction SilentlyContinue).Count`,
      ),
      '0',
    )
  else if (macos)
    assert.ok(
      !(await fs
        .stat(`/Library/LaunchDaemons/${identity.CVR_MACOS_SERVICE_ID}.plist`)
        .catch(() => null)),
    )
  else
    assert.ok(
      !(await fs
        .stat(`/etc/systemd/system/${identity.CVR_SERVICE_SLUG}.service`)
        .catch(() => null)),
    )
  check('configured service uninstallation')
  appProcess =
    process.platform === 'linux'
      ? spawn('xvfb-run', ['-a', app], { stdio: 'ignore' })
      : spawn(app, [], { stdio: 'ignore' })
  await waitFor(
    () => running(identity.CVR_APP_BINARY),
    'installed application in sidecar mode',
  )
  await waitFor(
    () => running(identity.CVR_CORE_NAME),
    'application-owned sidecar core',
  )
  check('installed application sidecar core process name')
  if (windows)
    powershell(
      `Get-Process -Name '${identity.CVR_APP_BINARY}' -ErrorAction SilentlyContinue | Stop-Process -Force`,
    )
  else run('pkill', ['-f', app])
  appProcess = undefined
  if (windows) {
    powershell(
      `Start-Process -FilePath '${appUninstaller}' -ArgumentList '/S' -Wait`,
    )
    appUninstaller = undefined
    await waitFor(
      async () => !(await fs.stat(app).catch(() => null)),
      'application uninstallation',
    )
  } else if (macos)
    privileged('rm', ['-rf', path.dirname(path.dirname(appDirectory))])
  else privileged('dpkg', ['-r', packageName])
  assert.ok(!(await fs.stat(app).catch(() => null)))
  check('installed application removal')
  evidence.success = true
} catch (error) {
  evidence.success = false
  evidence.error = error.stack
  throw error
} finally {
  if (appProcess) appProcess.kill()
  if (uninstaller) {
    try {
      privileged(uninstaller, [])
    } catch {}
  }
  if (appUninstaller) {
    try {
      powershell(
        `Start-Process -FilePath '${appUninstaller}' -ArgumentList '/S' -Wait`,
      )
    } catch {}
  }
  await fs.mkdir('target', { recursive: true })
  await fs.writeFile(
    'target/identity-verification.json',
    JSON.stringify(evidence, null, 2),
  )
  await fs.rm(root, { recursive: true, force: true })
}
