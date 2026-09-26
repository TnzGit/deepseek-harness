/** Localized labels for the long-task-monitor Plugins card. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys rendered by this card. */
export type LongTaskMonitorLocaleKey =
  | 'title' | 'description' | 'conversationEnabled' | 'conversationStart' | 'conversationInterval'
  | 'bashEnabled' | 'bashStart' | 'bashInterval' | 'bashHint' | 'minutesHint'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable' | 'save' | 'saving' | 'saveFailed' | 'invalidNumber'

/** English copy. */
export const en: Record<LongTaskMonitorLocaleKey, string> = {
  title: 'Long-task progress',
  description: 'Progress prompts for long conversations and a non-intrusive foreground Bash watchdog.',
  conversationEnabled: 'Report long conversations',
  conversationStart: 'First report after (minutes)',
  conversationInterval: 'Report every (minutes)',
  bashEnabled: 'Watch foreground Bash',
  bashStart: 'Watch after (minutes)',
  bashInterval: 'Watch every (minutes)',
  bashHint: 'Foreground Bash blocks the agent; checkpoints go to the server log, not its prompt. Use a background job for live agent inspection.',
  minutesHint: 'Whole minutes; changes apply to running tasks without restarting DSH.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'The monitor plugin is not loaded.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values.',
  invalidNumber: 'Enter a positive whole number.',
}

/** Simplified Chinese copy. */
export const zh: Record<LongTaskMonitorLocaleKey, string> = {
  title: '长任务进度',
  description: '长对话进度提醒，以及不打断前台 Bash 的监测。',
  conversationEnabled: '汇报长对话进度',
  conversationStart: '首次汇报等待（分钟）',
  conversationInterval: '汇报间隔（分钟）',
  bashEnabled: '监测前台 Bash',
  bashStart: '开始监测等待（分钟）',
  bashInterval: '监测间隔（分钟）',
  bashHint: '前台 Bash 会阻塞 Agent；监测点只写入服务日志，不向模型排队提示。需要模型实时检查请使用后台任务。',
  minutesHint: '填写正整数分钟；修改后无需重启 DSH 即可作用于运行中的任务。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '长任务监控插件当前未加载。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值。',
  invalidNumber: '请输入正整数。',
}

/** Collect translated labels for the staged settings form.
 * @param t - locale reader.
 * @returns labels shared by the staged settings form.
 */
export function formLabels(t: (key: LongTaskMonitorLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
