import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const script = join(dirname(fileURLToPath(import.meta.url)), 'fork-upgrade-plan.mjs')

interface UpgradeReport {
  commits: { upstreamSinceBase: number; forkSinceBase: number }
  paths: { overlap: string[]; unclassifiedForkPaths: string[] }
  features: { upstreamTouched: string[]; forkTouched: string[]; missingAnchors: string[] }[]
  localOnly: string[]
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, '-c', 'user.name=Upgrade Test', '-c', 'user.email=upgrade@test.invalid', ...args], { encoding: 'utf8' }).trim()
}

function write(repo: string, path: string, contents: string): void {
  const destination = join(repo, path)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, contents)
}

function commit(repo: string, message: string): void {
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', message)
}

function fixture({ overlap = false, missingAnchor = false, unclassified = false }: {
  overlap?: boolean
  missingAnchor?: boolean
  unclassified?: boolean
} = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'dsh-upgrade-plan-'))
  git(repo, 'init', '-q')
  write(repo, 'src/feature.ts', 'export const value = 1\n')
  commit(repo, 'base')
  const base = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'switch', '-q', '-c', 'upstream')
  write(repo, overlap ? 'src/feature.ts' : 'src/official.ts', 'export const official = true\n')
  commit(repo, 'official change')
  git(repo, 'switch', '-q', '-c', 'fork', base)
  if (missingAnchor) git(repo, 'rm', 'src/feature.ts')
  else write(repo, 'src/feature.ts', 'export const value = 2\n')
  if (unclassified) write(repo, 'packages/novel/src/index.ts', 'export const novel = true\n')
  commit(repo, 'fork change')
  const manifest = join(repo, 'inventory.json')
  writeFileSync(manifest, JSON.stringify({
    version: 1,
    features: [{ id: 'feature', watch: ['src/'], anchors: ['src/feature.ts'], checks: ['unit test'] }],
    localOnly: ['secret environment variables'],
  }))
  return { repo, manifest }
}

function run({ repo, manifest }: { repo: string; manifest: string }) {
  const result = spawnSync(process.execPath, [script, '--repo', repo, '--upstream', 'upstream', '--head', 'fork', '--manifest', manifest, '--json'], { encoding: 'utf8' })
  return { ...result, data: JSON.parse(result.stdout) as UpgradeReport }
}

test('reports fork changes without claiming an unrelated upstream conflict', () => {
  const input = fixture({ unclassified: true })
  try {
    const { status, data } = run(input)
    expect(status).toBe(0)
    expect(data.paths.overlap).toEqual([])
    expect(data.commits.upstreamSinceBase).toBe(1)
    expect(data.commits.forkSinceBase).toBe(1)
    expect(data.features[0]?.missingAnchors).toEqual([])
    expect(data.paths.unclassifiedForkPaths).toEqual(['packages/novel/src/index.ts'])
    expect(data.localOnly).toEqual(['secret environment variables'])
  } finally {
    rmSync(input.repo, { recursive: true, force: true })
  }
})

test('reports exact overlap when both sides change the same file', () => {
  const input = fixture({ overlap: true })
  try {
    const { status, data } = run(input)
    expect(status).toBe(0)
    expect(data.paths.overlap).toEqual(['src/feature.ts'])
    expect(data.features[0]?.upstreamTouched).toEqual(['src/feature.ts'])
    expect(data.features[0]?.forkTouched).toEqual(['src/feature.ts'])
  } finally {
    rmSync(input.repo, { recursive: true, force: true })
  }
})

test('fails preflight if a required fork anchor is absent', () => {
  const input = fixture({ missingAnchor: true })
  try {
    const { status, data } = run(input)
    expect(status).toBe(2)
    expect(data.features[0]?.missingAnchors).toEqual(['src/feature.ts'])
  } finally {
    rmSync(input.repo, { recursive: true, force: true })
  }
})
