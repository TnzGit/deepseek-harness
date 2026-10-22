/** Read-only overlap and regression inventory for the personal DSH fork. */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MANIFEST = '.agents/skills/dsh-fork-upgrade/customizations.json'
const MAX_OUTPUT = 32 * 1024 * 1024

function options(argv) {
  const result = { repo: DEFAULT_ROOT, upstream: 'upstream/master', head: 'HEAD', manifest: DEFAULT_MANIFEST, json: false }
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index]
    if (key === '--json') { result.json = true; continue }
    if (key === '--help') { result.help = true; continue }
    if (!['--repo', '--upstream', '--head', '--manifest'].includes(key)) throw new Error(`unknown option: ${key}`)
    const value = argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`)
    result[key.slice(2)] = value
  }
  result.repo = resolve(result.repo)
  result.manifest = resolve(result.repo, result.manifest)
  return result
}

function git(repo, ...args) {
  const result = spawnSync('git', ['-C', repo, '-c', 'core.fsmonitor=false', ...args], {
    encoding: 'utf8', maxBuffer: MAX_OUTPUT,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LANG: 'C', LC_ALL: 'C' },
  })
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${(result.stderr || result.error?.message || '').trim()}`)
  return result.stdout.trimEnd()
}

function sha(repo, ref) {
  return git(repo, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`)
}

function changedPaths(repo, base, head) {
  const output = git(repo, '-c', 'diff.renames=false', 'diff', '--no-ext-diff', '--name-only', '-z', base, head)
  return new Set(output.split('\0').filter(Boolean))
}

function matches(path, watch) {
  return watch.endsWith('/') ? path.startsWith(watch) : path === watch
}

function manifestAt(path) {
  const value = JSON.parse(readFileSync(path, 'utf8'))
  if (value.version !== 1 || !Array.isArray(value.features)) throw new Error('unsupported customization manifest')
  const ids = new Set()
  for (const feature of value.features) {
    if (typeof feature.id !== 'string' || !Array.isArray(feature.watch) || !Array.isArray(feature.anchors) || !Array.isArray(feature.checks)) {
      throw new Error('invalid customization feature')
    }
    if (ids.has(feature.id)) throw new Error(`duplicate customization id: ${feature.id}`)
    ids.add(feature.id)
    for (const path of [...feature.watch, ...feature.anchors]) {
      if (typeof path !== 'string' || path.startsWith('/') || path.includes('..') || path.length === 0) throw new Error(`invalid customization path: ${path}`)
    }
  }
  return value
}

function report(input) {
  const { repo, upstream, head, manifest } = input
  const upstreamSha = sha(repo, upstream)
  const headSha = sha(repo, head)
  const baseSha = git(repo, 'merge-base', headSha, upstreamSha)
  const upstreamPaths = changedPaths(repo, baseSha, upstreamSha)
  const forkPaths = changedPaths(repo, baseSha, headSha)
  const overlap = [...upstreamPaths].filter(path => forkPaths.has(path)).sort()
  const inventory = manifestAt(manifest)
  const watched = inventory.features.flatMap(feature => feature.watch)
  const unclassifiedForkPaths = [...forkPaths]
    .filter(path => /^(apps|native|packages|scripts)\//.test(path))
    .filter(path => !watched.some(watch => matches(path, watch)))
    .sort()
  const features = inventory.features.map(feature => {
    const upstreamTouched = [...upstreamPaths].filter(path => feature.watch.some(watch => matches(path, watch)))
    const forkTouched = [...forkPaths].filter(path => feature.watch.some(watch => matches(path, watch)))
    const missingAnchors = feature.anchors.filter(path => {
      const found = spawnSync('git', ['-C', repo, 'cat-file', '-e', `${headSha}:${path}`], { stdio: 'ignore' })
      return found.status !== 0
    })
    return { ...feature, upstreamTouched, forkTouched, missingAnchors }
  })
  const dirty = git(repo, 'status', '--porcelain').length > 0
  return {
    version: 1, refs: { upstream, upstreamSha, head, headSha, baseSha },
    commits: {
      upstreamSinceBase: Number(git(repo, 'rev-list', '--count', `${baseSha}..${upstreamSha}`)),
      forkSinceBase: Number(git(repo, 'rev-list', '--count', `${baseSha}..${headSha}`)),
    },
    paths: { upstreamCount: upstreamPaths.size, forkCount: forkPaths.size, overlap, unclassifiedForkPaths },
    features, localOnly: inventory.localOnly ?? [], dirty,
  }
}

function showText(data) {
  const lines = [
    'Fork upgrade preflight (read-only; fetch upstream separately)',
    `upstream ${data.refs.upstream}: ${data.refs.upstreamSha}`,
    `fork ${data.refs.head}: ${data.refs.headSha}`,
    `common base: ${data.refs.baseSha}`,
    `new commits: upstream ${data.commits.upstreamSinceBase}, fork ${data.commits.forkSinceBase}`,
    `changed paths: upstream ${data.paths.upstreamCount}, fork ${data.paths.forkCount}, exact overlap ${data.paths.overlap.length}`,
    ...data.paths.overlap.slice(0, 30).map(path => `  overlap: ${path}`),
  ]
  if (data.paths.overlap.length > 30) lines.push(`  ... ${data.paths.overlap.length - 30} more; use --json`)
  lines.push(`fork paths outside feature inventory: ${data.paths.unclassifiedForkPaths.length}`)
  for (const path of data.paths.unclassifiedForkPaths.slice(0, 10)) lines.push(`  unclassified: ${path}`)
  if (data.paths.unclassifiedForkPaths.length > 10) lines.push(`  ... ${data.paths.unclassifiedForkPaths.length - 10} more; use --json and extend the inventory where appropriate`)
  for (const feature of data.features) {
    const risk = feature.upstreamTouched.length && feature.forkTouched.length ? 'review both' : feature.upstreamTouched.length ? 'upstream changed' : 'baseline check'
    lines.push(`${feature.id}: ${risk}; missing anchors ${feature.missingAnchors.length}`)
    for (const anchor of feature.missingAnchors) lines.push(`  MISSING: ${anchor}`)
    if (feature.upstreamTouched.length || feature.forkTouched.length || feature.missingAnchors.length) {
      for (const check of feature.checks) lines.push(`  check: ${check}`)
    }
  }
  if (data.dirty) lines.push('WARNING: worktree has local changes; preserve them before merging or rebasing.')
  lines.push('Local deployment items are not committed:')
  for (const item of data.localOnly) lines.push(`  - ${item}`)
  return lines.join('\n')
}

try {
  const input = options(process.argv.slice(2))
  if (input.help) {
    process.stdout.write('Usage: node scripts/fork-upgrade-plan.mjs [--repo DIR] [--upstream REF] [--head REF] [--manifest FILE] [--json]\n')
  } else {
    const data = report(input)
    process.stdout.write(`${input.json ? JSON.stringify(data, null, 2) : showText(data)}\n`)
    if (data.features.some(feature => feature.missingAnchors.length > 0)) process.exitCode = 2
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
