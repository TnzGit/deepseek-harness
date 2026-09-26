/** Browser plugin contributing the live long-task-monitor card to Plugins settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { LongTaskMonitorCard } from './LongTaskMonitorCard.tsx'
import { LONG_TASK_MONITOR_NS, LongTaskMonitorCardController } from './long-task-monitor-card-controller.ts'
import { en, zh, type LongTaskMonitorLocaleKey } from './locales.ts'

export type { LongTaskMonitorCardProps } from './LongTaskMonitorCard.tsx'
export type { LongTaskMonitorCardFace, LongTaskMonitorCardState, LongTaskMonitorSettings } from './long-task-monitor-card-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Long-task progress settings copy. */
    'settings.longTaskMonitor': LongTaskMonitorLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.longTaskMonitor'

/** Required browser services. */
export const inject = ['slots', 'locale', 'configForms']

/** @param ctx - browser plugin context. */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-long-task-monitor: dictionaries')
  const card = new LongTaskMonitorCardController(ctx.configForms.get(LONG_TASK_MONITOR_NS))
  ctx.effect(() => () => { card.dispose() }, 'ui-settings-long-task-monitor: form subscription')
  ctx.effect(() => ctx.configForms.whileServed([LONG_TASK_MONITOR_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'long-task-monitor', order: 25, label: () => t('title'), locale: NS, inject: () => card.inject(),
  }, LongTaskMonitorCard))), 'ui-settings-long-task-monitor: page')
}
