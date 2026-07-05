import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const config = JSON.parse(
  readFileSync(join(root, 'scripts/agent-tools/approved-tools.json'), 'utf8'),
)
const availableMcps = readAvailableMcps(process.argv.slice(2))
const failures = []
const warnings = []

checkFile(
  join(root, '.agents/skills/marketmind-frontend-workflow/SKILL.md'),
  'project routing skill',
)
checkFile(
  join(root, 'node_modules/next/dist/docs/01-app'),
  'version-matched Next.js bundled docs (run npm install first)',
)
checkManifest(
  join(
    root,
    '.agents/skills/marketmind-frontend-workflow/agents/openai.yaml',
  ),
)

const installedSkills = discoverSkills(root)
for (const skillSource of config.skill_sources) {
  for (const expected of skillSource.expected_skills) {
    const candidates = installedSkills.filter(
      (skill) => skill.name === expected.name,
    )
    if (candidates.length === 0) {
      failures.push(
        `Missing approved skill "${expected.name}". Run npm run agent:setup.`,
      )
      continue
    }

    const exact = candidates.find(
      (skill) => gitBlobSha(skill.content) === expected.skill_file_git_blob_sha,
    )
    if (!exact) {
      failures.push(
        `Skill "${expected.name}" is installed, but its SKILL.md does not match the reviewed revision.`,
      )
      continue
    }
    console.log(`✓ ${expected.name} (${relativePath(exact.path)})`)
  }
}

if (availableMcps.size === 0) {
  warnings.push(
    'MCP runtime availability was not reported. Re-run with ' +
      '--available-mcp context7 and any on-demand MCPs your agent exposes.',
  )
} else {
  for (const mcp of config.mcps) {
    const isAvailable = availableMcps.has(mcp.name)
    if (mcp.status === 'default' && !isAvailable) {
      failures.push(`Required default MCP "${mcp.name}" was not reported.`)
    } else if (isAvailable) {
      console.log(`✓ MCP ${mcp.name}`)
    }
  }
}

for (const warning of warnings) {
  console.warn(`! ${warning}`)
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`✗ ${failure}`)
  }
  process.exit(1)
}

console.log('Agent toolchain is ready.')

function readAvailableMcps(args) {
  const names = new Set()
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--available-mcp') {
      console.error(`Unknown argument: ${args[index]}`)
      process.exit(1)
    }
    const name = args[index + 1]
    if (!name) {
      console.error('--available-mcp requires a name.')
      process.exit(1)
    }
    names.add(name)
    index += 1
  }
  return names
}

function discoverSkills(projectRoot) {
  const roots = [
    join(projectRoot, '.agents/skills'),
    join(projectRoot, '.codex/skills'),
    join(projectRoot, '.cursor/skills'),
    join(projectRoot, '.claude/skills'),
  ]
  const skills = []

  for (const skillRoot of roots) {
    if (!existsSync(skillRoot)) {
      continue
    }
    for (const entry of readdirSync(skillRoot)) {
      const skillFile = join(skillRoot, entry, 'SKILL.md')
      if (!existsSync(skillFile) || !statSync(skillFile).isFile()) {
        continue
      }
      const content = readFileSync(skillFile)
      const text = content.toString('utf8')
      const name = text.match(/^name:\s*([^\r\n]+)$/m)?.[1]?.trim()
      if (name) {
        skills.push({
          name,
          path: realpathSync(skillFile),
          content,
        })
      }
    }
  }
  return skills
}

function gitBlobSha(content) {
  const header = Buffer.from(`blob ${content.length}\0`)
  return createHash('sha1').update(header).update(content).digest('hex')
}

function checkFile(path, label) {
  if (!existsSync(path)) {
    failures.push(`Missing ${label}: ${relativePath(path)}`)
  } else {
    console.log(`✓ ${label}`)
  }
}

function checkManifest(path) {
  if (!existsSync(path)) {
    failures.push(`Missing skill manifest: ${relativePath(path)}`)
    return
  }

  const manifest = readFileSync(path, 'utf8')
  const requiredSections = ['interface:', 'dependencies:', 'policy:']
  const missing = requiredSections.filter(
    (section) => !manifest.includes(`\n${section}`) && !manifest.startsWith(section),
  )
  const unsupportedTopLevel = /^(name|description|instructions|references|tools|mcps):/m

  if (missing.length > 0 || unsupportedTopLevel.test(manifest)) {
    failures.push(
      `Skill manifest does not match the supported interface/dependencies/policy shape: ${relativePath(path)}`,
    )
    return
  }
  console.log('✓ project skill manifest')
}

function relativePath(path) {
  return path.startsWith(root) ? path.slice(root.length + 1) : path
}
