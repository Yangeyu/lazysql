/**
 * Seed a sample SQLite database for development and the Phase 0 demo.
 * Run with: `bun run seed`  → writes ./data/sample.db
 */

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';

const DB_PATH = 'data/sample.db';

mkdirSync('data', { recursive: true });

const db = new Database(DB_PATH, { create: true });

db.exec('PRAGMA journal_mode = WAL;');
db.exec('DROP TABLE IF EXISTS orders;');
db.exec('DROP TABLE IF EXISTS users;');

db.exec(`
  CREATE TABLE users (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE orders (
    id       INTEGER PRIMARY KEY,
    user_id  INTEGER NOT NULL REFERENCES users(id),
    amount   REAL NOT NULL,
    status   TEXT NOT NULL,
    placed_at TEXT NOT NULL
  );
`);

const insertUser = db.prepare(
  'INSERT INTO users (name, email, active, created_at) VALUES (?, ?, ?, ?)',
);
const insertOrder = db.prepare(
  'INSERT INTO orders (user_id, amount, status, placed_at) VALUES (?, ?, ?, ?)',
);

const FIRST = ['Alice', 'Bob', 'Carol', 'Dan', 'Eve', 'Frank', 'Grace', 'Heidi'];
const STATUS = ['pending', 'paid', 'shipped', 'refunded'];

const day = (n: number) =>
  `2026-${String(1 + (n % 12)).padStart(2, '0')}-${String(1 + (n % 27)).padStart(2, '0')}`;

const tx = db.transaction(() => {
  for (let i = 1; i <= 120; i++) {
    const name = `${FIRST[i % FIRST.length]} ${String.fromCharCode(65 + (i % 26))}.`;
    insertUser.run(name, `user${i}@example.com`, i % 5 === 0 ? 0 : 1, day(i));
  }
  for (let i = 1; i <= 300; i++) {
    insertOrder.run(
      1 + (i % 120),
      Math.round((10 + (i * 7.3) % 500) * 100) / 100,
      STATUS[i % STATUS.length]!,
      day(i),
    );
  }
});
tx();

const users = db.query('SELECT COUNT(*) AS n FROM users').get() as { n: number };
const orders = db.query('SELECT COUNT(*) AS n FROM orders').get() as { n: number };
db.close();

console.log(`✓ seeded ${DB_PATH}: ${users.n} users, ${orders.n} orders`);
