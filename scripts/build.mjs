import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { buildEnvironment, prepareBuildConfig } from './build-identity.mjs'

const args = process.argv.slice(2)
function optionValues(long, short) {
  const values = []
  for (let index = 0; index < args.length; index++) {
    if (args[index].startsWith(`${long}=`))
      values.push(args[index].slice(long.length + 1))
    else if (args[index] === long || args[index] === short) {
      while (index + 1 < args.length && !args[index + 1].startsWith('-'))
        values.push(args[++index])
    }
  }
  return values
}
const target = optionValues('--target', '-t')[0]
const platform = target?.includes('windows')
  ? 'win32'
  : target?.includes('apple')
    ? 'darwin'
    : target?.includes('linux')
      ? 'linux'
      : process.platform
const env = buildEnvironment()
const features = optionValues('--features', '-f').flatMap((value) =>
  value.split(/[,\s]+/),
)
env.CVR_DEVELOPMENT_CHANNEL =
  args.includes('--all-features') ||
  features.some((feature) => ['verge-dev', 'dev-sidecar'].includes(feature))
    ? '1'
    : '0'
const config = await prepareBuildConfig(
  process.cwd(),
  env,
  platform,
  env.CVR_DEVELOPMENT_CHANNEL === '1',
)
const require = createRequire(import.meta.url)

function run(script, arguments_) {
  const result = spawnSync(process.execPath, [script, ...arguments_], {
    env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (args.includes('--prepare-only')) {
  console.log(config)
} else {
  if (env.CVR_CUSTOM_BUILD === '1' || env.CVR_BUILD_SERVICE_SOURCE === '1')
    run('scripts/prebuild.mjs', target ? [target] : [])
  run(require.resolve('@tauri-apps/cli/tauri.js'), [
    'build',
    '--config',
    config,
    ...args,
  ])
}
