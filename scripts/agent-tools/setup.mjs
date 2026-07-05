import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const config = JSON.parse(
  readFileSync(new URL('./approved-tools.json', import.meta.url), 'utf8'),
)

const args = process.argv.slice(2)
const agents = []
let dryRun = false
const supportedAgents = new Set(['codex', 'cursor', 'claude-code'])

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--agent') {
    const agent = args[index + 1]
    if (!agent || !/^[a-z0-9-]+$/.test(agent)) {
      fail('Each --agent requires a lowercase agent identifier.')
    }
    if (!supportedAgents.has(agent)) {
      fail(
        `Unsupported agent "${agent}". Supported agents: ${[...supportedAgents].join(', ')}.`,
      )
    }
    agents.push(agent)
    index += 1
  } else if (arg === '--dry-run') {
    dryRun = true
  } else if (arg === '--help') {
    printUsage()
    process.exit(0)
  } else {
    fail(`Unknown argument: ${arg}`)
  }
}

if (agents.length === 0) {
  printUsage()
  fail('Choose at least one target agent. Nothing was installed.')
}

for (const skillSource of config.skill_sources) {
  const commandArgs = [
    '--yes',
    `skills@${config.skills_cli_version}`,
    'add',
    skillSource.source,
  ]

  for (const selector of skillSource.selectors) {
    commandArgs.push('--skill', selector)
  }
  for (const agent of agents) {
    commandArgs.push('--agent', agent)
  }
  commandArgs.push('--yes')

  run('npx', commandArgs, dryRun)
}

for (const agent of agents) {
  if (agent !== 'claude-code') {
    continue
  }
  run(
    'npx',
    [
      '--yes',
      `skills@${config.skills_cli_version}`,
      'add',
      './.agents/skills/marketmind-frontend-workflow',
      '--agent',
      agent,
      '--yes',
    ],
    dryRun,
  )
}

console.log('\nApproved MCP configuration (register in your agent locally):')
for (const mcp of config.mcps) {
  if (mcp.transport === 'streamable_http') {
    console.log(`- ${mcp.name}: ${mcp.url}`)
  } else {
    console.log(`- ${mcp.name}: ${mcp.command} ${mcp.args.join(' ')}`)
  }
}
console.log(
  '\nDo not commit credentials or agent-local MCP configuration. ' +
    'After registration, run npm run agent:doctor and report available MCP names.',
)

function run(command, commandArgs, shouldOnlyPrint) {
  console.log(`\n${command} ${commandArgs.join(' ')}`)
  if (shouldOnlyPrint) {
    return
  }

  const result = spawnSync(command, commandArgs, {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function printUsage() {
  console.log(
    'Usage: npm run agent:setup -- --agent <agent> [--agent <agent>] [--dry-run]',
  )
  console.log('Example: npm run agent:setup -- --agent codex --agent cursor')
  console.log('Supported agents: codex, cursor, claude-code')
}

function fail(message) {
  console.error(`Agent setup failed: ${message}`)
  process.exit(1)
}
