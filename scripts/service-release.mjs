const SERVICE_URL_PREFIX =
  'https://github.com/clash-verge-rev/clash-verge-service-ipc/releases/download'

export function resolveServiceRelease(cargoManifest, host, platform) {
  const dependency = cargoManifest
    .split(/\r?\n/)
    .find((line) => line.trimStart().startsWith('clash_verge_service_ipc ='))
  const packageVersion = dependency?.match(/\bversion\s*=\s*"([^"]+)"/)?.[1]
  if (!packageVersion) {
    throw new Error(
      'clash_verge_service_ipc dependency must declare an inline version',
    )
  }

  const version = `v${packageVersion}`
  const archiveExt = platform === 'win32' ? 'zip' : 'tar.gz'
  const archiveFile = `clash-verge-service-ipc-${version}-${host}.${archiveExt}`
  return {
    version,
    archiveFile,
    downloadURL: `${SERVICE_URL_PREFIX}/${version}/${archiveFile}`,
  }
}
import fs from 'node:fs/promises'
import path from 'node:path'

export async function publishServiceBundle(
  directory,
  filenames,
  stateFile,
  legacyFilenames,
) {
  let previous = []
  try {
    previous = JSON.parse(await fs.readFile(stateFile, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  for (const filename of new Set([...previous, ...legacyFilenames])) {
    if (filename !== path.basename(filename))
      throw new Error('Invalid service bundle filename')
    if (!filenames.includes(filename))
      await fs.rm(path.join(directory, filename), { force: true })
  }
  await fs.writeFile(stateFile, JSON.stringify(filenames))
}
