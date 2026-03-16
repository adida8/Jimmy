const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Railway sets DATABASE_URL automatically when you add a Postgres plugin
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

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

    CREATE TABLE IF NOT EXISTS diary (
      id SERIAL PRIMARY KEY,
      entry_date DATE NOT NULL,
      workout_type CHAR(1) NOT NULL,
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(entry_date, workout_type)
    );

    CREATE TABLE IF NOT EXISTS food_log (
      id SERIAL PRIMARY KEY,
      logged_at TIMESTAMPTZ DEFAULT NOW(),
      date DATE NOT NULL,
      meal_time TEXT,
      description TEXT,
      is_paleo BOOLEAN,
      verdict TEXT,
      flags JSONB,
      notes TEXT,
      image_data TEXT
    );

    -- Add columns if not exists
    DO $$ BEGIN
      ALTER TABLE food_log ADD COLUMN user_override BOOLEAN DEFAULT FALSE;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
    DO $$ BEGIN
      ALTER TABLE food_log ADD COLUMN health_score INTEGER;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
    DO $$ BEGIN
      ALTER TABLE food_log ADD COLUMN health_reason TEXT;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
    DO $$ BEGIN
      ALTER TABLE food_log ADD COLUMN culinary_score INTEGER;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
    DO $$ BEGIN
      ALTER TABLE food_log ADD COLUMN culinary_reason TEXT;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);
  console.log('DB ready');
}

// GET /api/progress — load all saved exercise state
app.get('/api/progress',async (req, res) => {
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
app.post('/api/progress',async (req, res) => {
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
app.post('/api/log',async (req, res) => {
  const { day, exercises_done, total_exercises } = req.body;
  await pool.query(
    'INSERT INTO workout_log (day, exercises_done, total_exercises) VALUES ($1, $2, $3)',
    [day, exercises_done, total_exercises]
  );
  res.json({ ok: true });
});

// GET /api/history — last 30 workout sessions
app.get('/api/history',async (req, res) => {
  const { rows } = await pool.query(`
    SELECT id, day, exercises_done, total_exercises, logged_at
    FROM workout_log
    ORDER BY logged_at DESC
    LIMIT 30
  `);
  res.json(rows);
});

// GET /api/history-all — merged workout_log + diary, sorted by date desc
app.get('/api/history-all',async (req, res) => {
  const { rows } = await pool.query(`
    SELECT id, day, exercises_done, total_exercises, logged_at, 'log' AS source, NULL AS notes
    FROM workout_log
    UNION ALL
    SELECT id, workout_type AS day, NULL AS exercises_done, NULL AS total_exercises,
           entry_date::timestamptz AS logged_at, 'diary' AS source, notes
    FROM diary
    ORDER BY logged_at DESC
    LIMIT 30
  `);
  res.json(rows);
});

// GET /api/diary?month=YYYY-MM — get diary entries for a month
app.get('/api/diary',async (req, res) => {
  const month = req.query.month; // e.g. "2026-03"
  if (!month) return res.status(400).json({ error: 'month query param required (YYYY-MM)' });
  const { rows } = await pool.query(`
    SELECT id, TO_CHAR(entry_date, 'YYYY-MM-DD') as entry_date, workout_type, notes
    FROM diary
    WHERE TO_CHAR(entry_date, 'YYYY-MM') = $1
    ORDER BY entry_date ASC
  `, [month]);
  res.json(rows);
});

// POST /api/diary — add a diary entry
app.post('/api/diary',async (req, res) => {
  const { entry_date, workout_type, notes } = req.body;
  if (!entry_date || !workout_type) return res.status(400).json({ error: 'entry_date and workout_type required' });
  const { rows } = await pool.query(`
    INSERT INTO diary (entry_date, workout_type, notes)
    VALUES ($1, $2, $3)
    ON CONFLICT (entry_date, workout_type) DO UPDATE
      SET notes = $3
    RETURNING id, TO_CHAR(entry_date, 'YYYY-MM-DD') as entry_date, workout_type, notes
  `, [entry_date, workout_type, notes || '']);
  res.json(rows[0]);
});

// DELETE /api/diary/:id — remove a diary entry
app.delete('/api/diary/:id',async (req, res) => {
  await pool.query('DELETE FROM diary WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// DELETE /api/progress/day/:day — reset a day (clear all exercises)
app.delete('/api/progress/day/:day',async (req, res) => {
  const day = req.params.day;
  await pool.query("UPDATE progress SET sets_done = 0, is_done = FALSE WHERE key LIKE $1", [`${day}-%`]);
  res.json({ ok: true });
});

// ---- FOOD PHOTO LOGGING ----

// POST /api/food/analyze — send image to Claude Vision for paleo analysis
app.post('/api/food/analyze', async (req, res) => {
  const { image_base64, mime_type } = req.body;
  if (!image_base64 || !mime_type) return res.status(400).json({ error: 'image_base64 and mime_type required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const prompt = `You are a strict paleo diet analyzer and food critic. Analyze this food photo and return ONLY a JSON object, no markdown, no explanation.

{
  "description": "brief name of the food/meal",
  "is_paleo": true/false,
  "verdict": "one sentence verdict, plain language",
  "meal_time": "breakfast" | "lunch" | "dinner" | "snack",
  "health_score": 1-10,
  "health_reason": "one sentence explaining the health score",
  "culinary_score": 1-10,
  "culinary_reason": "one sentence explaining the culinary score",
  "flags": [
    {
      "ingredient": "name",
      "status": "ok" | "warn" | "bad",
      "reason": "one short sentence"
    }
  ]
}

health_score: 1=very unhealthy, 10=extremely nutritious. Consider nutrient density, balance, whole foods, processing level.
culinary_score: 1=poorly made/presented, 10=restaurant quality. Consider presentation, cooking technique, flavor combinations, creativity.

Paleo rules: no grains, no legumes, no dairy (strict), no refined sugar, no seed oils, no artificial additives. Flag anything borderline as warn. If you cannot identify the food clearly, set is_paleo to false and explain in verdict.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mime_type,
                data: image_base64,
              },
            },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Claude API error:', response.status, errBody);
      return res.status(502).json({ error: 'Claude API error: ' + response.status });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Parse JSON from response (strip any accidental markdown fences)
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const analysis = JSON.parse(jsonStr);
    res.json(analysis);
  } catch (e) {
    console.error('Food analyze error:', e);
    res.status(500).json({ error: 'Analysis failed: ' + e.message });
  }
});

// POST /api/food — save a food entry
app.post('/api/food', async (req, res) => {
  const { date, meal_time, description, is_paleo, verdict, flags, notes, image_data, health_score, health_reason, culinary_score, culinary_reason } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    const { rows } = await pool.query(`
      INSERT INTO food_log (date, meal_time, description, is_paleo, verdict, flags, notes, image_data, health_score, health_reason, culinary_score, culinary_reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, logged_at, TO_CHAR(date, 'YYYY-MM-DD') as date, meal_time, description, is_paleo, verdict, flags, notes, health_score, health_reason, culinary_score, culinary_reason
    `, [date, meal_time || null, description || null, is_paleo, verdict || null, JSON.stringify(flags || []), notes || '', image_data || null, health_score || null, health_reason || null, culinary_score || null, culinary_reason || null]);
    res.json(rows[0]);
  } catch (e) {
    console.error('Food save error:', e);
    res.status(500).json({ error: 'Save failed: ' + e.message });
  }
});

// GET /api/food?date=YYYY-MM-DD — get food entries for a date
app.get('/api/food', async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });
  try {
    const { rows } = await pool.query(`
      SELECT id, logged_at, TO_CHAR(date, 'YYYY-MM-DD') as date, meal_time, description, is_paleo, verdict, flags, notes, image_data, user_override, health_score, health_reason, culinary_score, culinary_reason
      FROM food_log
      WHERE date = $1
      ORDER BY logged_at ASC
    `, [date]);
    res.json(rows);
  } catch (e) {
    console.error('Food fetch error:', e);
    res.json([]);
  }
});

// PATCH /api/food/:id — update a food entry (verdict override, notes, etc.)
app.patch('/api/food/:id', async (req, res) => {
  const { is_paleo, verdict, notes } = req.body;
  const sets = [];
  const vals = [];
  let i = 1;
  if (is_paleo !== undefined) { sets.push(`is_paleo = $${i++}`); vals.push(is_paleo); sets.push(`user_override = $${i++}`); vals.push(true); }
  if (verdict !== undefined) { sets.push(`verdict = $${i++}`); vals.push(verdict); }
  if (notes !== undefined) { sets.push(`notes = $${i++}`); vals.push(notes); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE food_log SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    res.json(rows[0]);
  } catch (e) {
    console.error('Food update error:', e);
    res.status(500).json({ error: 'Update failed' });
  }
});

// DELETE /api/food/:id — remove a food entry
app.delete('/api/food/:id', async (req, res) => {
  await pool.query('DELETE FROM food_log WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
initDB().then(() => app.listen(PORT, () => console.log(`Listening on ${PORT}`)));
