// db.js — supports SQLite (dev) and Postgres (production via DATABASE_URL)
//
// When DATABASE_URL is set Blend will have provisioned a dedicated Postgres
// instance and injected the connection string automatically. In dev (no
// DATABASE_URL) the app falls back to a local SQLite file so there is zero
// setup required to run locally.

import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const DATABASE_URL = process.env.DATABASE_URL

// ─── Postgres ─────────────────────────────────────────────────────────────────

let pgPool = null

if (DATABASE_URL) {
  const pg = await import('pg')
  const Pool = pg.default?.Pool ?? pg.Pool
  pgPool = new Pool({ connectionString: DATABASE_URL })

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS todos (
      id         SERIAL PRIMARY KEY,
      text       TEXT        NOT NULL,
      done       BOOLEAN     NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  console.log('[db] connected to Postgres')
}

// ─── SQLite ───────────────────────────────────────────────────────────────────

let sqliteDb = null

if (!DATABASE_URL) {
  const { default: Database } = await import('better-sqlite3')
  const DB_PATH = process.env.DB_PATH ?? './data/todos.db'
  const dir = dirname(DB_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  sqliteDb = new Database(DB_PATH)
  sqliteDb.pragma('journal_mode = WAL')
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      text       TEXT    NOT NULL,
      done       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  console.log('[db] connected to SQLite at', DB_PATH)
}

// ─── Unified API (always async) ───────────────────────────────────────────────

export async function getAllTodos() {
  if (pgPool) {
    const { rows } = await pgPool.query('SELECT * FROM todos ORDER BY created_at DESC')
    return rows
  }
  return sqliteDb.prepare('SELECT * FROM todos ORDER BY created_at DESC').all()
}

export async function createTodo(text) {
  if (pgPool) {
    const { rows } = await pgPool.query(
      'INSERT INTO todos (text) VALUES ($1) RETURNING *',
      [text.trim()],
    )
    return rows[0]
  }
  const stmt = sqliteDb.prepare('INSERT INTO todos (text) VALUES (?)')
  const info = stmt.run(text.trim())
  return sqliteDb.prepare('SELECT * FROM todos WHERE id = ?').get(info.lastInsertRowid)
}

export async function toggleTodo(id) {
  if (pgPool) {
    const { rows } = await pgPool.query(
      'UPDATE todos SET done = NOT done WHERE id = $1 RETURNING *',
      [id],
    )
    return rows[0] ?? null
  }
  sqliteDb.prepare('UPDATE todos SET done = NOT done WHERE id = ?').run(id)
  return sqliteDb.prepare('SELECT * FROM todos WHERE id = ?').get(id) ?? null
}

export async function deleteTodo(id) {
  if (pgPool) {
    await pgPool.query('DELETE FROM todos WHERE id = $1', [id])
    return
  }
  sqliteDb.prepare('DELETE FROM todos WHERE id = ?').run(id)
}
