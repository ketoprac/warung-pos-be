import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')
const DB_PATH = join(DATA_DIR, 'pos.db')

// Ensure data directory exists
import { mkdirSync } from 'node:fs'
try { mkdirSync(DATA_DIR, { recursive: true }) } catch {}

const db = new Database(DB_PATH)

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Run schema
const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8')
db.exec(schema)

export default db
