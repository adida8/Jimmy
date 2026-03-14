const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Railway sets DATABASE_URL automatically when you add a Postgres plugin
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Simple API key protection — set API_KEY env var in Railway
const API_KEY = process.env.API_KEY || 'dev-key';
function auth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// DB setup
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS progress (
      key VARCHAR(10) PRIMARY KEY,
      sets_done INTEGER DEFAULT 0,
      is_done BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS workout_log (
      id SERIAL PRIMARY KEY,
      day CHAR(1) NOT NULL,
      exercises_done INTEGER NOT NULL,
      total_exercises INTEGER NOT NULL,
      logged_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('DB ready');
}

// GET /api/progress — load all saved exercise state
app.get('/api/progress', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT key, sets_done, is_done FROM progress');
  const setsDone = {};
  const done = { a: [], b: [], c: [], d: [] };
  for (const row of rows) {
    setsDone[row.key] = row.sets_done;
    if (row.is_done) {
      const day = row.key.split('-')[0];
      const idx = parseInt(row.key.split('-')[1]);
      done[day].push(idx);
    }
  }
  res.json({ setsDone, done });
});

// POST /api/progress — save a single exercise state
app.post('/api/progress', auth, async (req, res) => {
  const { key, sets_done, is_done } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  await pool.query(`
    INSERT INTO progress (key, sets_done, is_done, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (key) DO UPDATE
      SET sets_done = $2, is_done = $3, updated_at = NOW()
  `, [key, sets_done, is_done]);
  res.json({ ok: true });
});

// POST /api/log — called when a full day is completed
app.post('/api/log', auth, async (req, res) => {
  const { day, exercises_done, total_exercises } = req.body;
  await pool.query(
    'INSERT INTO workout_log (day, exercises_done, total_exercises) VALUES ($1, $2, $3)',
    [day, exercises_done, total_exercises]
  );
  res.json({ ok: true });
});

// GET /api/history — last 30 workout sessions
app.get('/api/history', auth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT id, day, exercises_done, total_exercises, logged_at
    FROM workout_log
    ORDER BY logged_at DESC
    LIMIT 30
  `);
  res.json(rows);
});

// DELETE /api/progress/day/:day — reset a day (clear all exercises)
app.delete('/api/progress/day/:day', auth, async (req, res) => {
  const day = req.params.day;
  await pool.query("UPDATE progress SET sets_done = 0, is_done = FALSE WHERE key LIKE $1", [`${day}-%`]);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
initDB().then(() => app.listen(PORT, () => console.log(`Listening on ${PORT}`)));
