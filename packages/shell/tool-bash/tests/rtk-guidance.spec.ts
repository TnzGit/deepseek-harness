import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import * as BashEnvPlugin from '@deepseek-ai/dsh-shell-env'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

async function assembledBashGuidance(): Promise<string> {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(LocalBashExecutor, {})
    await ctx.plugin(ToolBash)
    const section = (await ctx.systemPrompt.assemble()).sections.find(candidate => candidate.name === 'tool:bash')
    if (section === undefined) throw new Error('tool:bash prompt section was not registered')
    return section.text
  } finally {
    await ctx.dispose()
  }
}

describe('RTK bash guidance', () => {
  it('prefers explicit wrappers, preserves exact-output fallback, and forbids hook installation', async () => {
    const text = await assembledBashGuidance()

    for (const command of ['grep', 'find', 'read', 'git', 'test', 'log']) {
      expect(text).toContain(`rtk ${command}`)
    }
    expect(text).toContain('complete, exact, or machine-readable output')
    expect(text).toContain('Never run `rtk init`')
    expect(text).toContain('install RTK hooks')
    expect(text).toContain('Codex')
  })
})
