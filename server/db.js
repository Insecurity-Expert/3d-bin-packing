const path = require ("path");
const fs = require ("fs");
const Database = require ("better-sqlite3");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true});

const db = new Database(path.join(DATA_DIR, "app.db"));
db.pragma("journal_more = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'researcher',
    pass_hash  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    strategy    TEXT,
    instance    TEXT,
    n_items     INTEGER,
    space_util  REAL,
    dissipation REAL,
    runtime_s   REAL,
    bins_used   INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

module.exports = db;