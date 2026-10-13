import { version } from '@root/package.json'

export const APP_NAME = import.meta.env.VITE_CVR_APP_NAME ?? 'Clash Verge'
export const SERVICE_DISPLAY_NAME =
  import.meta.env.VITE_CVR_SERVICE_DISPLAY_NAME ?? 'Clash Verge Service'
const APP_BINARY = import.meta.env.VITE_CVR_APP_BINARY ?? 'clash-verge'
export const CORE_NAME = import.meta.env.VITE_CVR_CORE_NAME ?? 'verge-mihomo'
export const CORE_ALPHA_NAME =
  import.meta.env.VITE_CVR_CORE_ALPHA_NAME ?? 'verge-mihomo-alpha'
export const CUSTOM_BUILD = import.meta.env.VITE_CVR_CUSTOM_BUILD === '1'
export const USER_AGENT = `${APP_BINARY}/v${version}`
const TUN_DEVICE = import.meta.env.VITE_CVR_TUN_DEVICE ?? 'Mihomo'
const TUN_DEVICE_MACOS =
  import.meta.env.VITE_CVR_TUN_DEVICE_MACOS ?? 'utun1024'

export const getDefaultTunDevice = (platform: string) =>
  platform === 'macos' ? TUN_DEVICE_MACOS : TUN_DEVICE
