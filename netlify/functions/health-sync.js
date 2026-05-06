// Health Auto Export v2 — persists to GitHub Gist for reliable cross-session storage
const GIST_ID = 'be3f00243628d1567b9523c333e4b9cb';
const GIST_FILE = 'health-data.json';

async function readGist(token) {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (!res.ok) throw new Error(`Gist read failed: ${res.status}`);
  const data = await res.json();
  const content = data.files?.[GIST_FILE]?.content;
  return content ? JSON.parse(content) : {};
}

async function writeGist(token, payload) {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      files: { [GIST_FILE]: { content: JSON.stringify(payload, null, 2) } }
    })
  });
  if (!res.ok) throw new Error(`Gist write failed: ${res.status}`);
  return true;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const token = process.env.GITHUB_GIST_TOKEN;

  // GET — return stored health data
  if (event.httpMethod === 'GET') {
    try {
      const data = await readGist(token);
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    } catch (err) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // POST — parse Health Auto Export data and persist to Gist
  try {
    const payload = JSON.parse(event.body);
    const metrics = payload?.data?.metrics || [];
    const today = new Date().toISOString().split('T')[0];

    const find = (name) => metrics.find(m => m.name === name);
    const latest = (name) => {
      const m = find(name);
      if (!m?.data?.length) return null;
      return [...m.data].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    };

    // Read existing data to merge with
    let existing = {};
    try { existing = await readGist(token); } catch(e) {}

    const update = {
      body: { ...(existing.body || {}) },
      recovery: { ...(existing.recovery || {}) },
      meta: { lastSync: today, metricsReceived: metrics.length }
    };

    // Body composition
    const weight = latest('weight_body_mass');
    if (weight?.qty) { update.body.weight = Math.round(weight.qty * 10) / 10; update.body.weightDate = today; }

    const bf = latest('body_fat_percentage');
    if (bf?.qty) update.body.bf = Math.round(bf.qty * 10) / 10;

    const lean = latest('lean_body_mass');
    if (lean?.qty) update.body.ffm = Math.round(lean.qty * 10) / 10;

    // Recovery
    const rhr = latest('resting_heart_rate');
    if (rhr?.qty) update.recovery.rhr = Math.round(rhr.qty);

    const hrv = latest('heart_rate_variability_sdnn');
    if (hrv?.qty) update.recovery.hrv = Math.round(hrv.qty);

    const vo2 = latest('cardio_fitness');
    if (vo2?.qty) update.recovery.vo2 = Math.round(vo2.qty * 10) / 10;

    const steps = latest('step_count');
    if (steps?.qty) update.recovery.steps = Math.round(steps.qty);

    const active = latest('active_energy');
    const basal = latest('basal_energy_burned');
    if (active?.qty) update.recovery.activeCalories = Math.round(active.qty);
    if (active?.qty && basal?.qty) update.recovery.tdee = Math.round(active.qty + basal.qty);

    // Sleep
    const sleep = latest('sleep_analysis');
    if (sleep) {
      if (sleep.totalSleep) update.recovery.sleep = Math.round(sleep.totalSleep * 10) / 10;
      if (sleep.deep) update.recovery.deepSleep = Math.round(sleep.deep * 10) / 10;
      if (sleep.rem) update.recovery.remSleep = Math.round(sleep.rem * 10) / 10;
      if (sleep.core) update.recovery.coreSleep = Math.round(sleep.core * 10) / 10;
    }

    // Weight history
    const history = existing.weightHistory || [];
    if (update.body.weight) {
      const exists = history.some(h => h.date === today);
      if (!exists) history.push({ date: today, w: update.body.weight });
    }
    update.weightHistory = history.slice(-365);

    // Persist to Gist
    await writeGist(token, update);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, received: metrics.length, syncedAt: today, update }),
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
