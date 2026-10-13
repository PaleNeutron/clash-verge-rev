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
const evidence = {
  target,
  identity,
  checks: [],
  installerRunId:
    process.env.IDENTITY_INSTALLER_RUN_ID ?? process.env.GITHUB_RUN_ID ?? null,
  installerHeadSha:
    process.env.IDENTITY_INSTALLER_HEAD_SHA ?? process.env.GITHUB_SHA ?? null,
  verifierHeadSha: process.env.GITHUB_SHA ?? null,
  limitations: [
    'Autostart entry creation and removal require toggling the application setting. Hosted GUI setting automation is unavailable in this workflow; persisted enable_auto_launch values do not apply OS registration on launch. Scheduled task, LaunchAgent and XDG autostart creation/removal are therefore not runtime-verified.',
  ],
}
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'installed-identity-'))
const windows = process.platform === 'win32'
const macos = process.platform === 'darwin'
const ext = windows ? '.exe' : ''
const verificationStartedAt = Date.now()
const runtimeLogs = path.resolve('target', 'identity-runtime-logs')
const appRuns = []
evidence.applicationProcesses = []
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
async function waitFor(predicate, description, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
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

function applicationDataDirectory() {
  const home = os.homedir()
  const base = windows
    ? powershell("[Environment]::GetFolderPath('ApplicationData')")
    : macos
      ? path.join(home, 'Library', 'Application Support')
      : process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME)
        ? process.env.XDG_DATA_HOME
        : path.join(home, '.local', 'share')
  return path.join(base, identity.CVR_APP_ID)
}

async function launchApplication(app, stage) {
  await fs.mkdir(runtimeLogs, { recursive: true })
  const stdoutPath = path.join(runtimeLogs, `${stage}-stdout.log`)
  const stderrPath = path.join(runtimeLogs, `${stage}-stderr.log`)
  const stdout = await fs.open(stdoutPath, 'w')
  const stderr = await fs.open(stderrPath, 'w')
  const record = {
    stage,
    executable: app,
    launcher: process.platform === 'linux' ? 'xvfb-run' : app,
    stdoutPath,
    stderrPath,
    startedAt: new Date().toISOString(),
  }
  evidence.applicationProcesses.push(record)
  try {
    const child =
      process.platform === 'linux'
        ? spawn('xvfb-run', ['-a', app], {
            stdio: ['ignore', stdout.fd, stderr.fd],
          })
        : spawn(app, [], { stdio: ['ignore', stdout.fd, stderr.fd] })
    record.pid = child.pid
    const closed = new Promise((resolve) => {
      child.on('error', (error) => {
        record.spawnError = error.message
      })
      child.on('exit', (exitCode, signal) => {
        record.exitCode = exitCode
        record.signal = signal
        record.exitedAt = new Date().toISOString()
      })
      child.on('close', (exitCode, signal) => {
        record.exitCode ??= exitCode
        record.signal ??= signal
        record.closed = true
        record.closedAt = new Date().toISOString()
        resolve()
      })
    })
    appRuns.push({ child, closed, record })
    return child
  } finally {
    await Promise.all([stdout.close(), stderr.close()])
  }
}

async function waitForApplication(predicate, description) {
  await waitFor(
    () => {
      const record = appRuns.at(-1)?.record
      assert.ok(
        !record?.spawnError,
        `Application spawn failed: ${record?.spawnError}`,
      )
      assert.ok(
        !record?.closed,
        `Application exited before ${description}: ${JSON.stringify(record)}`,
      )
      return predicate()
    },
    description,
    120000,
  )
}

async function stopApplication(app, force = false) {
  if (running(identity.CVR_APP_BINARY)) {
    if (windows)
      powershell(
        `Get-Process -Name '${identity.CVR_APP_BINARY}' -ErrorAction SilentlyContinue | Stop-Process -Force`,
      )
    else if (macos && !force) {
      run('osascript', [
        '-e',
        `tell application id "${identity.CVR_APP_ID}" to quit`,
      ])
      await waitFor(
        () => !running(identity.CVR_APP_BINARY),
        'macOS application normal Quit',
      )
      await waitFor(
        () =>
          !running(identity.CVR_CORE_NAME) &&
          !running(identity.CVR_CORE_ALPHA_NAME),
        'core shutdown after macOS application normal Quit',
      )
    } else {
      const pattern =
        !macos && !force
          ? `^${app.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
          : app
      run('pkill', ['-f', pattern])
      if (!macos && !force)
        await waitFor(
          () => !running(identity.CVR_APP_BINARY),
          'Linux application shutdown before closing its display',
        )
    }
  }
  if (!macos || force) appProcess?.kill()
  const current = appRuns.at(-1)
  if (current) await Promise.race([current.closed, delay(3000)])
  appProcess = undefined
}

async function captureApplicationLogs(stage) {
  // Copy only this run's application logs on a fresh hosted runner, never configuration or credentials.
  if (process.env.GITHUB_ACTIONS !== 'true') return
  const output = path.join(runtimeLogs, stage)
  try {
    const logs = path.join(applicationDataDirectory(), 'logs')
    for (const relative of ['', 'sidecar']) {
      const directory = path.join(logs, relative)
      const entries = await fs
        .readdir(directory, { withFileTypes: true })
        .catch((error) => {
          if (error.code === 'ENOENT') return []
          throw error
        })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.log')) continue
        const source = path.join(directory, entry.name)
        const metadata = await fs.stat(source)
        if (metadata.mtimeMs < verificationStartedAt) continue
        const destination = path.join(output, relative, entry.name)
        await fs.mkdir(path.dirname(destination), { recursive: true })
        await fs.copyFile(source, destination)
      }
    }
  } catch (error) {
    evidence.runtimeLogErrors ??= []
    evidence.runtimeLogErrors.push(`${stage}: ${error.message}`)
  }
}

function detachDmg(force = false) {
  if (!mountedDmg) return
  run('hdiutil', ['detach', mountedDmg, ...(force ? ['-force'] : [])])
  mountedDmg = undefined
  evidence.installer.dmgDetached = true
}

async function installMacDmg(artifacts, destination) {
  const dmg = artifacts.find((file) => file.endsWith('.dmg'))
  assert.ok(dmg, 'DMG installer is missing')
  mountedDmg = path.join(root, 'dmg-mount')
  await fs.mkdir(mountedDmg)
  evidence.installer = { type: 'dmg', path: dmg, mountpoint: mountedDmg }
  run('hdiutil', [
    'attach',
    dmg,
    '-readonly',
    '-nobrowse',
    '-noautoopen',
    '-mountpoint',
    mountedDmg,
  ])
  const apps = (await fs.readdir(mountedDmg, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.endsWith('.app'),
  )
  assert.equal(
    apps.length,
    1,
    'Expected one application bundle in the DMG installer',
  )
  assert.equal(apps[0].name, `${identity.CVR_APP_NAME}.app`)
  evidence.installer.applicationBundle = apps[0].name
  privileged('ditto', [path.join(mountedDmg, apps[0].name), destination])
  detachDmg()
  check('installed application copied from packaged DMG')
}

async function verifyInstalledLauncher(app) {
  if (windows) {
    const shortcutName = `${identity.CVR_APP_NAME}.lnk`.replaceAll("'", "''")
    const shortcuts = JSON.parse(
      powershell(
        `$shell = New-Object -ComObject WScript.Shell; $roots = @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms')); $entries = @($roots | Select-Object -Unique | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { Get-ChildItem -LiteralPath $_ -Recurse -Filter '*.lnk' } | Where-Object { $_.Name -eq '${shortcutName}' } | ForEach-Object { [PSCustomObject]@{ Path = $_.FullName; Target = $shell.CreateShortcut($_.FullName).TargetPath } }); ConvertTo-Json -InputObject $entries -Compress`,
      ),
    )
    assert.ok(shortcuts.length > 0, 'Installed Start menu shortcut is missing')
    for (const shortcut of shortcuts)
      assert.equal(
        path.resolve(shortcut.Target).toLowerCase(),
        path.resolve(app).toLowerCase(),
        `Wrong Start menu shortcut target: ${shortcut.Path}`,
      )
    evidence.launcher = shortcuts
    check('installed Start menu shortcut name and executable target')
  } else if (macos) {
    const plist = path.join(path.dirname(appDirectory), 'Info.plist')
    const executable = run('/usr/libexec/PlistBuddy', [
      '-c',
      'Print :CFBundleExecutable',
      plist,
    ])
    assert.equal(executable, identity.CVR_APP_BINARY)
    assert.equal(path.join(appDirectory, executable), app)
    evidence.launcher = { plist, executable }
    check('installed application bundle executable target')
  } else {
    const desktopFiles = run('dpkg', ['-L', packageName])
      .split('\n')
      .filter((file) => /\/applications\/[^/]+\.desktop$/.test(file))
    const launchers = []
    for (const desktop of desktopFiles) {
      const entries = Object.fromEntries(
        (await fs.readFile(desktop, 'utf8'))
          .split(/\r?\n/)
          .filter((line) => /^(Name|Exec)=/.test(line))
          .map((line) => [
            line.slice(0, line.indexOf('=')),
            line.slice(line.indexOf('=') + 1),
          ]),
      )
      if (entries.Name === identity.CVR_APP_NAME)
        launchers.push({ desktop, entries })
    }
    assert.equal(
      launchers.length,
      1,
      'Expected one installed desktop launcher with the configured display name',
    )
    const [{ desktop, entries }] = launchers
    const command = entries.Exec?.match(/^(?:"([^"\n]+)"|(\S+))/)
    assert.ok(command, 'Installed desktop launcher has no executable')
    const executable = command[1] ?? command[2]
    assert.equal(path.basename(executable), identity.CVR_APP_BINARY)
    const target = path.isAbsolute(executable)
      ? executable
      : run('which', [executable])
    assert.equal(await fs.realpath(target), await fs.realpath(app))
    evidence.launcher = { desktop, name: entries.Name, executable: target }
    check('installed desktop launcher display name and executable target')
  }
}

let appDirectory
let toolsDirectory
let uninstaller
let appUninstaller
let packageName
let appProcess
let appExecutable
let mountedDmg
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
    appDirectory = path.join(
      '/Applications',
      `${identity.CVR_APP_NAME}.app`,
      'Contents',
      'MacOS',
    )
    await installMacDmg(artifacts, path.dirname(path.dirname(appDirectory)))
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
  appExecutable = app
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
  await verifyInstalledLauncher(app)
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

  appProcess = await launchApplication(app, 'service-launch')
  await waitForApplication(
    () => running(identity.CVR_APP_BINARY),
    'installed main application process',
  )
  check('installed main application process name')
  await waitForApplication(
    () => running(identity.CVR_CORE_NAME),
    'installed application service-managed stable core',
  )
  check('installed application service-managed stable core process name')
  await stopApplication(app)
  await captureApplicationLogs('service-launch')
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
  appProcess = await launchApplication(app, 'sidecar-launch')
  await waitForApplication(
    () => running(identity.CVR_APP_BINARY),
    'installed application in sidecar mode',
  )
  await waitForApplication(
    () => running(identity.CVR_CORE_NAME),
    'application-owned sidecar core',
  )
  check('installed application sidecar core process name')
  await stopApplication(app)
  await captureApplicationLogs('sidecar-launch')
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
  const launcherPaths = windows
    ? evidence.launcher.map((shortcut) => shortcut.Path)
    : [macos ? evidence.launcher.plist : evidence.launcher.desktop]
  await waitFor(async () => {
    const entries = await Promise.all(
      launcherPaths.map((filename) => fs.stat(filename).catch(() => null)),
    )
    return entries.every((entry) => entry === null)
  }, 'installed launcher removal')
  check('installed application launcher removal')
  evidence.success = true
} catch (error) {
  evidence.success = false
  evidence.error = error.stack
  throw error
} finally {
  await delay(600)
  await captureApplicationLogs('before-cleanup')
  if (appProcess && appExecutable) {
    try {
      await stopApplication(appExecutable, true)
    } catch (error) {
      evidence.runtimeLogErrors ??= []
      evidence.runtimeLogErrors.push(`Application cleanup: ${error.message}`)
    }
  }
  await captureApplicationLogs('after-process-exit')
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
  if (mountedDmg) {
    try {
      detachDmg(true)
    } catch (error) {
      evidence.cleanupErrors ??= []
      evidence.cleanupErrors.push(`DMG detach: ${error.message}`)
    }
  }
  await fs.mkdir('target', { recursive: true })
  await fs.writeFile(
    'target/identity-verification.json',
    JSON.stringify(evidence, null, 2),
  )
  if (!mountedDmg) await fs.rm(root, { recursive: true, force: true })
}
