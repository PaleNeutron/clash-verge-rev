import fs from 'node:fs/promises'
import path from 'node:path'

const defaults = {
  CVR_APP_NAME: 'Clash Verge',
  CVR_APP_BINARY: 'clash-verge',
  CVR_APP_ID: 'io.github.clash-verge-rev.clash-verge-rev',
  CVR_CORE_NAME: 'verge-mihomo',
  CVR_CORE_ALPHA_NAME: 'verge-mihomo-alpha',
  CVR_SERVICE_BINARY: 'clash-verge-service',
  CVR_SERVICE_SLUG: 'clash-verge-service',
  CVR_WINDOWS_SERVICE_NAME: 'clash_verge_service',
  CVR_SERVICE_DISPLAY_NAME: 'Clash Verge Service',
  CVR_MACOS_SERVICE_ID: 'io.github.clash-verge-rev.clash-verge-rev.service',
  CVR_BACKUP_DIR: 'clash-verge-rev-backup',
  CVR_URL_SCHEME: 'clash-verge',
  CVR_TUN_DEVICE: 'Mihomo',
  CVR_TUN_DEVICE_MACOS: 'utun1024',
  CVR_CORE_IPC_NAME: 'verge-mihomo',
  CVR_OWNER_TOKEN_FILE: '.clash-verge-service-owner-token',
  CVR_CORE_LOCK_NAME: 'clash-verge-service.core-execution',
}

export function resolveBuildIdentity(input = process.env) {
  const brand = input.CVR_BRAND
  if (brand !== undefined && !/^[a-z][a-z0-9-]{0,14}$/.test(brand)) {
    throw new Error(
      'CVR_BRAND must be a lowercase slug of at most 15 characters',
    )
  }
  const env = { ...defaults }
  if (brand) {
    Object.assign(env, {
      CVR_APP_NAME: brand[0].toUpperCase() + brand.slice(1),
      CVR_APP_BINARY: brand,
      CVR_APP_ID: `io.github.paleneutron.${brand}`,
      CVR_CORE_NAME: `${brand}-core`,
      CVR_CORE_ALPHA_NAME: `${brand}-core-alpha`,
      CVR_SERVICE_BINARY: `${brand}-service`,
      CVR_SERVICE_SLUG: `${brand}-service`,
      CVR_WINDOWS_SERVICE_NAME: `${brand.replaceAll('-', '_')}_service`,
      CVR_BACKUP_DIR: `${brand}-backup`,
      CVR_URL_SCHEME: brand,
      CVR_TUN_DEVICE: brand,
    })
  }
  for (const key of Object.keys(defaults)) {
    if (input[key] !== undefined) env[key] = input[key]
  }
  const changed = (key) => env[key] !== defaults[key]
  if (brand || changed('CVR_APP_NAME'))
    env.CVR_SERVICE_DISPLAY_NAME =
      input.CVR_SERVICE_DISPLAY_NAME ?? `${env.CVR_APP_NAME} Service`
  if (brand || changed('CVR_APP_ID'))
    env.CVR_MACOS_SERVICE_ID =
      input.CVR_MACOS_SERVICE_ID ?? `${env.CVR_APP_ID}.service`
  if (brand || changed('CVR_CORE_NAME'))
    env.CVR_CORE_IPC_NAME = input.CVR_CORE_IPC_NAME ?? env.CVR_CORE_NAME
  if (brand || changed('CVR_SERVICE_SLUG')) {
    env.CVR_OWNER_TOKEN_FILE =
      input.CVR_OWNER_TOKEN_FILE ?? `.${env.CVR_SERVICE_SLUG}-owner-token`
    env.CVR_CORE_LOCK_NAME =
      input.CVR_CORE_LOCK_NAME ?? `${env.CVR_SERVICE_SLUG}.core-execution`
  }
  for (const [key, value] of Object.entries(env)) {
    let valid
    if (key === 'CVR_APP_NAME' || key === 'CVR_SERVICE_DISPLAY_NAME') {
      valid = /^[\p{L}\p{N} _().-]{1,80}$/u.test(value) && !/[ .]$/.test(value)
    } else if (key === 'CVR_APP_ID' || key === 'CVR_MACOS_SERVICE_ID') {
      valid =
        /^[a-zA-Z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/.test(value) &&
        value.length <= 100
    } else if (key === 'CVR_TUN_DEVICE_MACOS') {
      valid = /^utun\d{1,5}$/.test(value)
    } else if (key === 'CVR_TUN_DEVICE') {
      valid = /^[a-zA-Z][a-zA-Z0-9_-]{0,14}$/.test(value)
    } else if (key === 'CVR_URL_SCHEME') {
      valid = /^[a-z][a-z0-9+-]{0,39}$/.test(value)
    } else if (key === 'CVR_OWNER_TOKEN_FILE') {
      valid = /^\.[a-zA-Z0-9][a-zA-Z0-9_.-]{0,70}$/.test(value)
    } else if (key === 'CVR_CORE_IPC_NAME') {
      valid = /^[a-zA-Z][a-zA-Z0-9_.-]{0,23}$/.test(value)
    } else if (key === 'CVR_SERVICE_SLUG') {
      valid = /^[a-zA-Z][a-zA-Z0-9_.-]{0,31}$/.test(value)
    } else {
      valid = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(value)
    }
    if (!valid) throw new Error(`Invalid ${key}: ${JSON.stringify(value)}`)
  }
  if (env.CVR_APP_ID.length + env.CVR_CORE_IPC_NAME.length > 64) {
    throw new Error(
      'CVR_APP_ID and CVR_CORE_IPC_NAME must total at most 64 characters for Unix sockets',
    )
  }
  const binaries = [
    env.CVR_APP_BINARY,
    env.CVR_CORE_NAME,
    env.CVR_CORE_ALPHA_NAME,
    env.CVR_SERVICE_BINARY,
    `${env.CVR_SERVICE_BINARY}-install`,
    `${env.CVR_SERVICE_BINARY}-uninstall`,
  ]
  if (
    [env.CVR_CORE_NAME, env.CVR_CORE_ALPHA_NAME].some((name) =>
      /\.(next|old)$/i.test(name),
    )
  ) {
    throw new Error(
      'Core executable names cannot use reserved .next or .old suffixes',
    )
  }
  if (
    new Set(binaries.map((name) => name.toLowerCase())).size !== binaries.length
  ) {
    throw new Error(
      'Application, core and service executable names must be distinct',
    )
  }
  env.CVR_CUSTOM_BUILD =
    brand || Object.keys(defaults).some(changed) ? '1' : '0'
  return env
}

export function buildEnvironment(input = process.env) {
  const identity = resolveBuildIdentity(input)
  const vite = Object.fromEntries(
    Object.entries(identity).map(([key, value]) => [`VITE_${key}`, value]),
  )
  return { ...input, ...identity, ...vite }
}

function replaceIdentity(source, env, replacements = []) {
  const pairs = [
    ...replacements,
    [
      'io.github.clash-verge-rev.clash-verge-rev.service',
      env.CVR_MACOS_SERVICE_ID,
    ],
    ['io.github.clash-verge-rev.clash-verge-rev', env.CVR_APP_ID],
    ['clash-verge-service', env.CVR_SERVICE_BINARY],
    ['clash_verge_service', env.CVR_WINDOWS_SERVICE_NAME],
    ['verge-mihomo-alpha', env.CVR_CORE_ALPHA_NAME],
    ['verge-mihomo', env.CVR_CORE_NAME],
    ['Clash Verge Rev', env.CVR_APP_NAME],
    ['Clash Verge', env.CVR_APP_NAME],
    ['ClashVerge', env.CVR_APP_BINARY],
    ['clash-verge', env.CVR_APP_BINARY],
  ].sort(([a], [b]) => b.length - a.length)
  // Replace against the original template once, so an override containing another old name stays intact.
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const values = new Map(pairs)
  return source.replace(
    new RegExp(pairs.map(([key]) => escape(key)).join('|'), 'g'),
    (key) => values.get(key),
  )
}

export async function prepareBuildConfig(
  root,
  env,
  platform,
  development = false,
) {
  const appId = env.CVR_APP_ID + (development ? '.dev' : '')
  const identity = {
    ...env,
    CVR_APP_ID: appId,
    CVR_WINDOWS_SERVICE_NAME:
      env.CVR_WINDOWS_SERVICE_NAME + (development ? '_dev' : ''),
    CVR_MACOS_SERVICE_ID: development
      ? env.CVR_MACOS_SERVICE_ID === `${env.CVR_APP_ID}.service`
        ? `${env.CVR_APP_ID}.dev.service`
        : `${env.CVR_MACOS_SERVICE_ID}.dev`
      : env.CVR_MACOS_SERVICE_ID,
  }
  const generated = path.join(root, 'src-tauri', 'gen', 'build-identity')
  await fs.mkdir(generated, { recursive: true })
  const output = async (relative, additions) => {
    const text = await fs.readFile(
      path.join(root, 'src-tauri', relative),
      'utf8',
    )
    const filename = path.basename(relative)
    await fs.writeFile(
      path.join(generated, filename),
      env.CVR_CUSTOM_BUILD === '1' || development
        ? replaceIdentity(text, identity, additions)
        : text,
    )
    return `gen/build-identity/${filename}`
  }
  const config = {
    productName: env.CVR_APP_NAME,
    mainBinaryName: env.CVR_APP_BINARY,
    identifier: appId,
    bundle: {
      shortDescription:
        env.CVR_CUSTOM_BUILD === '1' ? env.CVR_APP_NAME : 'Clash Verge Rev',
      longDescription:
        env.CVR_CUSTOM_BUILD === '1' ? env.CVR_APP_NAME : 'Clash Verge Rev',
      publisher:
        env.CVR_CUSTOM_BUILD === '1' ? env.CVR_APP_NAME : 'Clash Verge Rev',
      externalBin: [
        `sidecar/${env.CVR_CORE_NAME}`,
        `sidecar/${env.CVR_CORE_ALPHA_NAME}`,
      ],
    },
    plugins: {
      'deep-link': {
        desktop: {
          schemes:
            env.CVR_CUSTOM_BUILD === '1'
              ? [env.CVR_URL_SCHEME]
              : ['clash', 'clash-verge'],
        },
      },
    },
  }
  if (env.CVR_CUSTOM_BUILD === '1') {
    config.bundle.createUpdaterArtifacts = false
    config.plugins.updater = { endpoints: [] }
  }
  if (platform === 'win32') {
    const template = await output('packages/windows/installer.nsi', [
      ['clash-meta-alpha', env.CVR_CORE_ALPHA_NAME],
      ['clash-meta', env.CVR_CORE_NAME],
    ])
    config.bundle.windows = { nsis: { template } }
  } else if (platform === 'linux') {
    const desktopTemplate = await output('packages/linux/clash-verge.desktop', [
      ['x-scheme-handler/clash;', `x-scheme-handler/${env.CVR_URL_SCHEME};`],
    ])
    const postInstallScript = await output('packages/linux/post-install.sh')
    const preRemoveScript = await output('packages/linux/pre-remove.sh')
    const rpmPost = await output('packages/linux/post-install-rpm.sh', [
      ['clash-verge-service-dev', `${env.CVR_SERVICE_SLUG}-dev`],
      [
        'for service in clash-verge-service ',
        `for service in ${env.CVR_SERVICE_SLUG} `,
      ],
    ])
    const common = {
      desktopTemplate,
      provides: [env.CVR_APP_BINARY],
      conflicts: [env.CVR_APP_BINARY],
      preRemoveScript,
    }
    config.bundle.linux = {
      deb: { ...common, replaces: [env.CVR_APP_BINARY], postInstallScript },
      rpm: {
        ...common,
        obsoletes: [env.CVR_APP_BINARY],
        postInstallScript: rpmPost,
      },
    }
    config.bundle.externalBin.unshift(
      ...['', '-install', '-uninstall'].map(
        (suffix) => `sidecar/${env.CVR_SERVICE_BINARY}${suffix}`,
      ),
    )
  } else if (platform === 'darwin') {
    config.bundle.macOS = {
      entitlements: await output('packages/macos/entitlements.plist'),
      infoPlist: await output('packages/macos/info_merge.plist'),
    }
  } else throw new Error(`Unsupported build platform: ${platform}`)
  const filename = path.join(generated, 'tauri.identity.json')
  await fs.writeFile(filename, `${JSON.stringify(config, null, 2)}\n`)
  await fs.writeFile(
    path.join(generated, 'identity.json'),
    `${JSON.stringify(resolveBuildIdentity(env), null, 2)}\n`,
  )
  return filename
}
