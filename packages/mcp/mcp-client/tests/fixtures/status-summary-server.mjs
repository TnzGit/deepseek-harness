/** External protocol fixture: verbose status with a small active-target summary. */
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

const server = new McpServer({ name: 'status-evidence-fixture', version: '1' })
server.registerTool('binary_session', {
  description: 'Read the current binary target and analysis activity.', inputSchema: z.object({}),
}, async () => ({ content: [{ type: 'text', text: JSON.stringify({ result: {
  open: true, path: '/fixture/binary', analysis_activity: { status: 'idle' },
  capabilities: Array.from({ length: 80 }, (_, index) => ({ symbol: `evidence_${index}`, address: `0x${(4096 + index * 16).toString(16)}`, detail: 'Complete original provider capability evidence. '.repeat(20) })),
} }) }] }))
await serveStdio(() => server)
