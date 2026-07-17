import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { resolve } from 'path'

type Messages = Record<string, string | Record<string, unknown>>

function flattenKeys(obj: Messages, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'object' && value !== null) {
      keys.push(...flattenKeys(value as Messages, fullKey))
    } else {
      keys.push(fullKey)
    }
  }
  return keys
}

function loadMessages(locale: string): Messages {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const path = resolve(__dirname, '..', 'messages', `${locale}.json`)
  return JSON.parse(readFileSync(path, 'utf-8'))
}

const en = loadMessages('en')
const ar = loadMessages('ar')

const enKeys = new Set(flattenKeys(en))
const arKeys = new Set(flattenKeys(ar))

const missingInAr = [...enKeys].filter((k) => !arKeys.has(k))
const missingInEn = [...arKeys].filter((k) => !enKeys.has(k))

let exitCode = 0


/*
 * Prints every missing key clearly so you know exactly what to fix
 * exitCode = 1 is the critical part — a non-zero exit code tells CI/CD pipelines (GitHub Actions, etc.) that the script failed
 * process.exit(0) means success, process.exit(1) means failure — this is Unix convention
 */

if (missingInAr.length > 0) {
  console.error(`Missing in ar.json (${missingInAr.length}):`)
  missingInAr.forEach((k) => console.error(`  - ${k}`))
  exitCode = 1
}

if (missingInEn.length > 0) {
  console.error(`Missing in en.json (${missingInEn.length}):`)
  missingInEn.forEach((k) => console.error(`  - ${k}`))
  exitCode = 1
}

if (exitCode === 0) {
  console.log('Dictionary parity check passed — all keys match between en.json and ar.json.')
}

process.exit(exitCode)
