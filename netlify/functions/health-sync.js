// Google Drive CSV reader — pulls latest health and workout data
const HEALTH_FOLDER = '19l4zh7T5mXrogmqR8_sI4F3HQrfWK6gP';
const WORKOUT_FOLDER = '1i4Y5ljxxbZzxwuCyMFsTz5uH77FTOPGK';

async function getServiceAccount() {
  return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
}

// ── JWT auth ──────────────────────────────────────────────────────────
async function getAccessToken() {
  const sa = await getServiceAccount();
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claim = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${claim}`);
  const sig = sign.sign(sa.private_key, 'base64url');
  const jwt = `${header}.${claim}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Auth failed: ' + JSON.stringify(data));
  return data.access_token;
}

// ── Drive helpers ─────────────────────────────────────────────────────
async function listFiles(token, folderId, limit = 30) {
  const q = encodeURIComponent(`'${folderId}' in parents and (mimeType='text/csv' or mimeType='application/vnd.google-apps.spreadsheet') and trashed=false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=name+desc&pageSize=${limit}&fields=files(id,name,mimeType)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.files || [];
}

async function downloadFile(token, fileId, mimeType) {
  const isSheet = mimeType === 'application/vnd.google-apps.spreadsheet';
  const url = isSheet
    ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`
    : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.text();
}

// ── CSV parser ────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const splitCSV = line => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(v => v.trim().replace(/^"|"$/g, ''));
  const headers = splitCSV(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitCSV(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] || ''; });
    return row;
  });
}

function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }

// Find column value by partial name match
const findCol = (row, ...terms) => {
  const keys = Object.keys(row);
  for (const term of terms) {
    const key = keys.find(k => k.toLowerCase().includes(term.toLowerCase()));
    if (key !== undefined && row[key] !== '') return row[key];
  }
  return '';
};

// ── Aggregate a single health file into daily summary ─────────────────
function aggregateHealthFile(rows) {
  let weightVal = null, bfVal = null, leanVal = null, viscFat = null;
  let rhrVal = null, vo2Val = null;
  let totalActive = 0, totalResting = 0;
  let sleep = {}, hrvVals = [], steps = 0;

  for (const r of rows) {
    const w = num(findCol(r, 'Weight (lb)'));
    if (w && w > 100) weightVal = w;

    const bf = num(findCol(r, 'Body Fat Percentage'));
    if (bf && bf < 100) bfVal = bf;

    const lean = num(findCol(r, 'Lean Body Mass'));
    if (lean && lean > 50) leanVal = lean;

    const rhr = num(findCol(r, 'Resting Heart Rate'));
    if (rhr && rhr > 30 && rhr < 120) rhrVal = rhr;

    const vo2 = num(findCol(r, 'VO2 Max'));
    if (vo2 && vo2 > 10) vo2Val = vo2;

    const hrv = num(findCol(r, 'Heart Rate Variability'));
    if (hrv && hrv > 0) hrvVals.push(hrv);

    const active = num(findCol(r, 'Active Energy'));
    if (active) totalActive += active;

    const resting = num(findCol(r, 'Resting Energy'));
    if (resting) totalResting += resting;

    const s = num(findCol(r, 'Step Count'));
    if (s) steps += s;

    if (!sleep.total) {
      const st = num(findCol(r, 'Sleep Analysis [Total]'));
      if (st && st > 0) {
        sleep.total = st;
        sleep.deep = num(findCol(r, 'Sleep Analysis [Deep]'));
        sleep.rem = num(findCol(r, 'Sleep Analysis [REM]'));
        sleep.core = num(findCol(r, 'Sleep Analysis [Core]'));
        sleep.awake = num(findCol(r, 'Sleep Analysis [Awake]'));
        sleep.inBed = num(findCol(r, 'Sleep Analysis [In Bed]'));
      }
    }
  }

  return {
    weight: weightVal ? Math.round(weightVal * 10) / 10 : null,
    bf: bfVal ? Math.round(bfVal * 10) / 10 : null,
    ffm: leanVal ? Math.round(leanVal * 10) / 10 : null,
    rhr: rhrVal ? Math.round(rhrVal) : null,
    vo2: vo2Val ? Math.round(vo2Val * 10) / 10 : null,
    hrv: hrvVals.length ? Math.round(hrvVals.reduce((a,b)=>a+b,0)/hrvVals.length) : null,
    activeCalories: totalActive ? Math.round(totalActive) : null,
    basalCalories: totalResting ? Math.round(totalResting) : null,
    tdee: totalActive && totalResting ? Math.round(totalActive + totalResting) : null,
    steps: steps || null,
    sleep: sleep.total ? Math.round(sleep.total * 10) / 10 : null,
    deepSleep: sleep.deep ? Math.round(sleep.deep * 10) / 10 : null,
    remSleep: sleep.rem ? Math.round(sleep.rem * 10) / 10 : null,
    coreSleep: sleep.core ? Math.round(sleep.core * 10) / 10 : null,
    awake: sleep.awake ? Math.round(sleep.awake * 10) / 10 : null,
  };
}

// ── Main handler ──────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'GET only' }) };

  try {
    const token = await getAccessToken();
    const today = new Date().toISOString().split('T')[0];

    // ── Get up to 10 health files (for multi-day lookback) ──
    const healthFiles = await listFiles(token, HEALTH_FOLDER, 10);
    const workoutFiles = await listFiles(token, WORKOUT_FOLDER, 10);

    if (!healthFiles.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, message: 'No health files found' }) };
    }

    // ── Download and parse all available health files ──
    const healthDays = [];
    for (const f of healthFiles.slice(0, 7)) {
      try {
        const csv = await downloadFile(token, f.id, f.mimeType);
        const rows = parseCSV(csv);
        const day = aggregateHealthFile(rows);
        // Extract date from filename e.g. HealthMetrics-2026-05-17
        const dateMatch = f.name.match(/(\d{4}-\d{2}-\d{2})/);
        day.date = dateMatch ? dateMatch[1] : f.name;
        healthDays.push(day);
      } catch(e) {
        console.log('Failed to parse', f.name, e.message);
      }
    }

    // healthDays[0] = most recent day
    const latest = healthDays[0] || {};

    // ── Body — most recent non-null value across all days ──
    const findLatest = (field) => {
      for (const d of healthDays) {
        if (d[field] != null) return d[field];
      }
      return null;
    };

    const body = {
      weight: findLatest('weight'),
      bf: findLatest('bf'),
      ffm: findLatest('ffm'),
      weightDate: healthDays.find(d => d.weight != null)?.date || null,
    };

    // ── Recovery — today's values, fall back to most recent ──
    const recovery = {
      sleep: latest.sleep || findLatest('sleep'),
      deepSleep: latest.deepSleep || findLatest('deepSleep'),
      remSleep: latest.remSleep || findLatest('remSleep'),
      coreSleep: latest.coreSleep || findLatest('coreSleep'),
      rhr: findLatest('rhr'),
      hrv: findLatest('hrv'),
      vo2: findLatest('vo2'),
      activeCalories: latest.activeCalories,
      basalCalories: latest.basalCalories,
      tdee: latest.tdee,
      steps: latest.steps,
      // 7-day sleep history for deficit calculation
      sleepHistory: healthDays
        .filter(d => d.sleep != null)
        .map(d => ({ date: d.date, sleep: d.sleep, deep: d.deepSleep })),
    };

    // ── Workouts — parse all files for last 7 days ──
    const workoutHistory = [];
    for (const f of workoutFiles.slice(0, 7)) {
      try {
        const csv = await downloadFile(token, f.id, f.mimeType);
        const rows = parseCSV(csv);
        for (const r of rows) {
          const startDate = findCol(r, 'Start')?.split(' ')[0];
          if (!startDate) continue;
          workoutHistory.push({
            date: startDate,
            type: findCol(r, 'Type'),
            duration: findCol(r, 'Duration'),
            kcal: num(findCol(r, 'Active Energy')),
            avgHR: num(findCol(r, 'Avg Heart Rate')),
            maxHR: num(findCol(r, 'Max Heart Rate')),
            distance: num(findCol(r, 'Distance')),
          });
        }
      } catch(e) {
        console.log('Failed to parse workout', f.name, e.message);
      }
    }

    // Sort workouts newest first
    workoutHistory.sort((a, b) => b.date.localeCompare(a.date));
    const latestWorkout = workoutHistory[0] || null;

    // Sessions in last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const recentSessions = workoutHistory.filter(w => w.date >= sevenDaysAgo).length;

    const workout = latestWorkout ? {
      lastDate: latestWorkout.date,
      lastType: latestWorkout.type,
      lastDuration: latestWorkout.duration,
      lastActiveKcal: latestWorkout.kcal,
      lastAvgHR: latestWorkout.avgHR,
      sessionsPerWeek: recentSessions,
      history: workoutHistory.slice(0, 10),
    } : null;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        body,
        recovery,
        workout,
        meta: {
          lastSync: today,
          healthFiles: healthFiles.slice(0, 3).map(f => f.name),
          daysLoaded: healthDays.length,
        }
      }),
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message, stack: err.stack }) };
  }
};
