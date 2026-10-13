import { APP_NAME, SERVICE_DISPLAY_NAME, CUSTOM_BUILD } from '@/utils/branding'

const RUNTIME_IDENTITY_KEYS: Record<string, string[]> = {
  layout: [
    'components.serviceMigration.notAutoStartedMessage',
    'components.serviceMigration.message',
    'components.serviceMigration.unavailableMessage',
    'components.serviceMigration.success',
    'components.sysproxyPrivilege.message',
    'components.sysproxyPrivilege.serviceReadyMessage',
    'components.sysproxyPrivilege.tunMessage',
  ],
  settings: [
    'components.verge.basic.title',
    'components.verge.advanced.title',
    'components.verge.advanced.actions.copyVersion',
    'components.verge.advanced.notifications.versionCopied',
    'components.verge.advanced.fields.vergeVersion',
    'feedback.errors.sysproxy.privilegeRequired',
    'feedback.errors.sysproxy.sidecarWhileServiceReady',
    'feedback.errors.sysproxy.coreNotReady',
  ],
  home: [
    'components.proxyTun.status.tunModeServiceRequired',
    'components.systemInfo.fields.vergeVersion',
  ],
}

export const applyLocaleBranding = (
  section: string,
  resources: Record<string, unknown>,
) => {
  if (!CUSTOM_BUILD) return
  for (const path of RUNTIME_IDENTITY_KEYS[section] ?? []) {
    const keys = path.split('.')
    const key = keys.pop()!
    let parent: Record<string, unknown> | undefined = resources
    for (const part of keys) {
      const next: unknown = parent?.[part]
      parent =
        next && typeof next === 'object'
          ? (next as Record<string, unknown>)
          : undefined
    }
    if (parent && typeof parent[key] === 'string') {
      parent[key] = parent[key].replace(
        /Clash Verge [Ss]ervice|Clash Verge(?: Rev)?|Verge/g,
        (name) =>
          /^Clash Verge [Ss]ervice$/.test(name)
            ? SERVICE_DISPLAY_NAME
            : APP_NAME,
      )
    }
  }
}
