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

    -- Body measurements
    CREATE TABLE IF NOT EXISTS body_measurements (
      id SERIAL PRIMARY KEY,
      logged_date DATE NOT NULL,
      weight_kg NUMERIC(5,2),
      waist_cm NUMERIC(5,1),
      chest_cm NUMERIC(5,1),
      left_arm_cm NUMERIC(5,1),
      right_arm_cm NUMERIC(5,1),
      shoulders_cm NUMERIC(5,1),
      body_fat_pct NUMERIC(4,1),
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Exercise notes
    CREATE TABLE IF NOT EXISTS exercise_notes (
      key VARCHAR(20) PRIMARY KEY,
      note TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Custom programs
    CREATE TABLE IF NOT EXISTS programs (
      id SERIAL PRIMARY KEY,
      day CHAR(1) NOT NULL,
      position INTEGER NOT NULL,
      section TEXT NOT NULL,
      name TEXT NOT NULL,
      sets INTEGER DEFAULT 3,
      reps TEXT DEFAULT '10',
      rest TEXT DEFAULT '60s',
      cues TEXT DEFAULT '',
      icon TEXT DEFAULT '💪'
    );
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

// POST /api/food/reanalyze — re-analyze with user-provided dish name
app.post('/api/food/reanalyze', async (req, res) => {
  const { id, dish_name, image_base64, mime_type } = req.body;
  if (!dish_name) return res.status(400).json({ error: 'dish_name required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const prompt = `You are a strict paleo diet analyzer and food critic. The user tells you this dish is: "${dish_name}". ${image_base64 ? 'Use the photo for additional context.' : ''} Analyze it and return ONLY a JSON object, no markdown, no explanation.

{
  "description": "${dish_name}",
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

Paleo rules: no grains, no legumes, no dairy (strict), no refined sugar, no seed oils, no artificial additives. Flag anything borderline as warn.`;

  try {
    const content = [];
    if (image_base64 && mime_type) {
      content.push({ type: 'image', source: { type: 'base64', media_type: mime_type, data: image_base64 } });
    }
    content.push({ type: 'text', text: prompt });

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
        messages: [{ role: 'user', content }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Claude API error:', response.status, errBody);
      return res.status(502).json({ error: 'Claude API error: ' + response.status });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const analysis = JSON.parse(jsonStr);

    // If id provided, update the food entry in DB
    if (id) {
      await pool.query(`
        UPDATE food_log SET description = $1, is_paleo = $2, verdict = $3, flags = $4,
          health_score = $5, health_reason = $6, culinary_score = $7, culinary_reason = $8,
          meal_time = $9, user_override = FALSE
        WHERE id = $10
      `, [analysis.description, analysis.is_paleo, analysis.verdict, JSON.stringify(analysis.flags || []),
          analysis.health_score, analysis.health_reason, analysis.culinary_score, analysis.culinary_reason,
          analysis.meal_time, id]);
    }

    res.json(analysis);
  } catch (e) {
    console.error('Re-analyze error:', e);
    res.status(500).json({ error: 'Re-analysis failed: ' + e.message });
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

// PATCH /api/food/:id — update a food entry
app.patch('/api/food/:id', async (req, res) => {
  const { is_paleo, verdict, notes, description, flags, health_score, health_reason, culinary_score, culinary_reason } = req.body;
  const sets = [];
  const vals = [];
  let i = 1;
  if (is_paleo !== undefined) { sets.push(`is_paleo = $${i++}`); vals.push(is_paleo); sets.push(`user_override = $${i++}`); vals.push(true); }
  if (verdict !== undefined) { sets.push(`verdict = $${i++}`); vals.push(verdict); }
  if (notes !== undefined) { sets.push(`notes = $${i++}`); vals.push(notes); }
  if (description !== undefined) { sets.push(`description = $${i++}`); vals.push(description); }
  if (flags !== undefined) { sets.push(`flags = $${i++}`); vals.push(JSON.stringify(flags)); }
  if (health_score !== undefined) { sets.push(`health_score = $${i++}`); vals.push(health_score); }
  if (health_reason !== undefined) { sets.push(`health_reason = $${i++}`); vals.push(health_reason); }
  if (culinary_score !== undefined) { sets.push(`culinary_score = $${i++}`); vals.push(culinary_score); }
  if (culinary_reason !== undefined) { sets.push(`culinary_reason = $${i++}`); vals.push(culinary_reason); }
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

// GET /api/exercise-notes — load all exercise notes
app.get('/api/exercise-notes', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, note FROM exercise_notes');
    const notes = {};
    for (const r of rows) notes[r.key] = r.note;
    res.json(notes);
  } catch (e) { res.json({}); }
});

// POST /api/exercise-notes — save a note for an exercise
app.post('/api/exercise-notes', async (req, res) => {
  const { key, note } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  try {
    await pool.query(`
      INSERT INTO exercise_notes (key, note, updated_at) VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET note = $2, updated_at = NOW()
    `, [key, note || '']);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/achievements — compute badges from data
app.get('/api/achievements', async (req, res) => {
  try {
    const badges = [];

    // Total workouts
    const { rows: [wc] } = await pool.query('SELECT COUNT(*) as c FROM workout_log');
    const totalWorkouts = parseInt(wc.c);
    if (totalWorkouts >= 1) badges.push({ id: 'first-workout', name: 'First Blood', desc: 'Complete your first workout', icon: '🎯', earned: true });
    else badges.push({ id: 'first-workout', name: 'First Blood', desc: 'Complete your first workout', icon: '🎯', earned: false });

    if (totalWorkouts >= 10) badges.push({ id: '10-workouts', name: 'Double Digits', desc: 'Complete 10 workouts', icon: '💪', earned: true });
    else badges.push({ id: '10-workouts', name: 'Double Digits', desc: 'Complete 10 workouts', icon: '💪', earned: false, progress: totalWorkouts, target: 10 });

    if (totalWorkouts >= 50) badges.push({ id: '50-workouts', name: 'Half Century', desc: 'Complete 50 workouts', icon: '🏆', earned: true });
    else badges.push({ id: '50-workouts', name: 'Half Century', desc: 'Complete 50 workouts', icon: '🏆', earned: false, progress: totalWorkouts, target: 50 });

    if (totalWorkouts >= 100) badges.push({ id: '100-workouts', name: 'Centurion', desc: 'Complete 100 workouts', icon: '👑', earned: true });
    else badges.push({ id: '100-workouts', name: 'Centurion', desc: 'Complete 100 workouts', icon: '👑', earned: false, progress: totalWorkouts, target: 100 });

    // Streak calculation
    const { rows: streakRows } = await pool.query(`
      SELECT DISTINCT logged_at::date as d FROM workout_log
      UNION SELECT DISTINCT entry_date as d FROM diary
      ORDER BY d DESC
    `);
    const daySet = new Set(streakRows.map(r => r.d.toISOString().substring(0, 10)));
    let streak = 0;
    const d = new Date();
    // Check today first, if not there check yesterday as start
    const todayCheck = d.toISOString().substring(0, 10);
    if (!daySet.has(todayCheck)) {
      d.setDate(d.getDate() - 1);
    }
    while (daySet.has(d.toISOString().substring(0, 10))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }

    if (streak >= 3) badges.push({ id: '3-streak', name: 'Hat Trick', desc: '3-day workout streak', icon: '🔥', earned: true });
    else badges.push({ id: '3-streak', name: 'Hat Trick', desc: '3-day workout streak', icon: '🔥', earned: false, progress: streak, target: 3 });

    if (streak >= 7) badges.push({ id: '7-streak', name: 'Week Warrior', desc: '7-day workout streak', icon: '⚡', earned: true });
    else badges.push({ id: '7-streak', name: 'Week Warrior', desc: '7-day workout streak', icon: '⚡', earned: false, progress: streak, target: 7 });

    if (streak >= 30) badges.push({ id: '30-streak', name: 'Iron Month', desc: '30-day workout streak', icon: '🦾', earned: true });
    else badges.push({ id: '30-streak', name: 'Iron Month', desc: '30-day workout streak', icon: '🦾', earned: false, progress: streak, target: 30 });

    // Paleo streak
    const { rows: foodRows } = await pool.query('SELECT is_paleo FROM food_log ORDER BY logged_at DESC');
    let paleoStreak = 0;
    for (const f of foodRows) {
      if (f.is_paleo) paleoStreak++;
      else break;
    }

    if (paleoStreak >= 5) badges.push({ id: '5-paleo', name: 'Clean Eater', desc: '5 paleo meals in a row', icon: '🥩', earned: true });
    else badges.push({ id: '5-paleo', name: 'Clean Eater', desc: '5 paleo meals in a row', icon: '🥩', earned: false, progress: paleoStreak, target: 5 });

    if (paleoStreak >= 10) badges.push({ id: '10-paleo', name: 'Paleo Pro', desc: '10 paleo meals in a row', icon: '🥇', earned: true });
    else badges.push({ id: '10-paleo', name: 'Paleo Pro', desc: '10 paleo meals in a row', icon: '🥇', earned: false, progress: paleoStreak, target: 10 });

    if (paleoStreak >= 25) badges.push({ id: '25-paleo', name: 'Caveman', desc: '25 paleo meals in a row', icon: '🦴', earned: true });
    else badges.push({ id: '25-paleo', name: 'Caveman', desc: '25 paleo meals in a row', icon: '🦴', earned: false, progress: paleoStreak, target: 25 });

    // All 4 program types completed at least once
    const { rows: dayTypes } = await pool.query('SELECT DISTINCT day FROM workout_log');
    const typesCompleted = new Set(dayTypes.map(r => r.day.toLowerCase()));
    const allFour = ['a','b','c','d'].every(d => typesCompleted.has(d));
    if (allFour) badges.push({ id: 'all-programs', name: 'Well Rounded', desc: 'Complete all 4 programs', icon: '🎪', earned: true });
    else badges.push({ id: 'all-programs', name: 'Well Rounded', desc: 'Complete all 4 programs', icon: '🎪', earned: false, progress: typesCompleted.size, target: 4 });

    res.json({ badges, stats: { totalWorkouts, streak, paleoStreak } });
  } catch (e) {
    console.error('Achievements error:', e);
    res.json({ badges: [], stats: {} });
  }
});

// GET /api/programs/:day — get exercises for a day
app.get('/api/programs/:day', async (req, res) => {
  const day = req.params.day.toLowerCase();
  try {
    const { rows } = await pool.query(
      'SELECT * FROM programs WHERE day = $1 ORDER BY position ASC',
      [day]
    );
    res.json(rows);
  } catch (e) { res.json([]); }
});

// PUT /api/programs/:day — replace all exercises for a day
app.put('/api/programs/:day', async (req, res) => {
  const day = req.params.day.toLowerCase();
  const { exercises } = req.body;
  if (!exercises || !Array.isArray(exercises)) return res.status(400).json({ error: 'exercises array required' });
  try {
    await pool.query('DELETE FROM programs WHERE day = $1', [day]);
    for (let i = 0; i < exercises.length; i++) {
      const ex = exercises[i];
      await pool.query(
        'INSERT INTO programs (day, position, section, name, sets, reps, rest, cues, icon) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [day, i, ex.section || '', ex.name, ex.sets || 3, ex.reps || '10', ex.rest || '60s', ex.cues || '', ex.icon || '💪']
      );
    }
    const { rows } = await pool.query('SELECT * FROM programs WHERE day = $1 ORDER BY position ASC', [day]);
    res.json(rows);
  } catch (e) {
    console.error('Programs save error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/programs/:day/reset — reset to defaults
app.post('/api/programs/:day/reset', async (req, res) => {
  const day = req.params.day.toLowerCase();
  try {
    await pool.query('DELETE FROM programs WHERE day = $1', [day]);
    res.json({ ok: true, message: 'Cleared. Client will use defaults.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/feed?days=N — merged feed of food + workouts, grouped by date
app.get('/api/feed', async (req, res) => {
  const days = parseInt(req.query.days) || 14;
  try {
    const { rows } = await pool.query(`
      SELECT 'food' AS type, id, logged_at, TO_CHAR(date, 'YYYY-MM-DD') as date,
             meal_time, description, is_paleo, verdict, flags, notes, image_data,
             user_override, health_score, health_reason, culinary_score, culinary_reason
      FROM food_log
      WHERE date >= CURRENT_DATE - $1::integer
      UNION ALL
      SELECT 'workout' AS type, wl.id, wl.logged_at, TO_CHAR(wl.logged_at::date, 'YYYY-MM-DD') as date,
             NULL as meal_time, wl.day AS description, NULL::boolean as is_paleo,
             wl.exercises_done || '/' || wl.total_exercises || ' exercises' AS verdict,
             NULL::jsonb as flags, NULL as notes, NULL as image_data,
             NULL::boolean as user_override, NULL::integer as health_score, NULL as health_reason,
             NULL::integer as culinary_score, NULL as culinary_reason
      FROM workout_log wl
      WHERE wl.logged_at >= CURRENT_DATE - $1::integer
      ORDER BY date DESC, logged_at DESC
    `, [days]);
    res.json(rows);
  } catch (e) {
    console.error('Feed error:', e);
    res.json([]);
  }
});

// ---- BODY MEASUREMENTS ----

// GET /api/measurements?limit=30
app.get('/api/measurements', async (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  try {
    const { rows } = await pool.query(
      `SELECT id, TO_CHAR(logged_date, 'YYYY-MM-DD') as logged_date, weight_kg, waist_cm, chest_cm, left_arm_cm, right_arm_cm, shoulders_cm, body_fat_pct, notes, created_at
       FROM body_measurements ORDER BY logged_date DESC, created_at DESC LIMIT $1`, [limit]
    );
    res.json(rows);
  } catch (e) {
    console.error('Measurements fetch error:', e);
    res.json([]);
  }
});

// POST /api/measurements
app.post('/api/measurements', async (req, res) => {
  const { logged_date, weight_kg, waist_cm, chest_cm, left_arm_cm, right_arm_cm, shoulders_cm, body_fat_pct, notes } = req.body;
  if (!logged_date) return res.status(400).json({ error: 'logged_date required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO body_measurements (logged_date, weight_kg, waist_cm, chest_cm, left_arm_cm, right_arm_cm, shoulders_cm, body_fat_pct, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, TO_CHAR(logged_date, 'YYYY-MM-DD') as logged_date, weight_kg, waist_cm, chest_cm, left_arm_cm, right_arm_cm, shoulders_cm, body_fat_pct, notes`,
      [logged_date, weight_kg || null, waist_cm || null, chest_cm || null, left_arm_cm || null, right_arm_cm || null, shoulders_cm || null, body_fat_pct || null, notes || '']
    );
    res.json(rows[0]);
  } catch (e) {
    console.error('Measurements save error:', e);
    res.status(500).json({ error: 'Save failed' });
  }
});

// DELETE /api/measurements/:id
app.delete('/api/measurements/:id', async (req, res) => {
  await pool.query('DELETE FROM body_measurements WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
initDB().then(() => app.listen(PORT, () => console.log(`Listening on ${PORT}`)));
