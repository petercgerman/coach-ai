// Google Drive CSV reader — pulls latest health and workout data
const HEALTH_FOLDER = '19l4zh7T5mXrogmqR8_sI4F3HQrfWK6gP';
const WORKOUT_FOLDER = '1i4Y5ljxxbZzxwuCyMFsTz5uH77FTOPGK';
const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

// ── JWT auth ──────────────────────────────────────────────────────────
async function getAccessToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claim = Buffer.from(JSON.stringify({
    iss: SERVICE_ACCOUNT.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${claim}`);
  const sig = sign.sign(SERVICE_ACCOUNT.private_key, 'base64url');
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
async function listFiles(token, folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and (mimeType='text/csv' or mimeType='application/vnd.google-apps.spreadsheet') and trashed=false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=name+desc&pageSize=10&fields=files(id,name,mimeType)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.files || [];
}

async function downloadFile(token, fileId, mimeType) {
  // Google Sheets need to be exported as CSV
  const isSheet = mimeType === 'application/vnd.google-apps.spreadsheet';
  const url = isSheet
    ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`
    : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${await res.text()}`);
  return res.text();
}

// ── CSV parser ────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i]?.trim() || ''; });
    return row;
  });
}

function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }

// ── Aggregate hourly health rows into daily summary ───────────────────
function aggregateHealth(rows) {
  if (!rows.length) return { body: {}, recovery: {} };

  // Debug: log first row keys to verify column names
  console.log('[Health] Column count:', Object.keys(rows[0]).length);
  console.log('[Health] First row keys:', JSON.stringify(Object.keys(rows[0])));
  console.log('[Health] Sample row:', JSON.stringify(rows[0]));

  let weightVal = null, bfVal = null, leanVal = null;
  let rhrVal = null, vo2Val = null;
  let totalActive = 0, totalResting = 0;
  let sleep = {}, hrvVals = [];

  // Helper: find value by partial column name match (handles encoding differences)
  const findCol = (row, ...terms) => {
    const keys = Object.keys(row);
    for (const term of terms) {
      const key = keys.find(k => k.toLowerCase().includes(term.toLowerCase()));
      if (key && row[key] !== '') return row[key];
    }
    return '';
  };

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

    if (!sleep.total) {
      const st = num(findCol(r, 'Sleep Analysis [Total]'));
      if (st && st > 0) {
        sleep.total = st;
        sleep.deep = num(findCol(r, 'Sleep Analysis [Deep]'));
        sleep.rem = num(findCol(r, 'Sleep Analysis [REM]'));
        sleep.core = num(findCol(r, 'Sleep Analysis [Core]'));
        sleep.awake = num(findCol(r, 'Sleep Analysis [Awake]'));
      }
    }
  }

  const avgHRV = hrvVals.length ? Math.round(hrvVals.reduce((a,b)=>a+b,0)/hrvVals.length) : null;

  return {
    body: {
      weight: weightVal ? Math.round(weightVal * 10) / 10 : null,
      bf: bfVal ? Math.round(bfVal * 10) / 10 : null,
      ffm: leanVal ? Math.round(leanVal * 10) / 10 : null,
    },
    recovery: {
      rhr: rhrVal ? Math.round(rhrVal) : null,
      vo2: vo2Val ? Math.round(vo2Val * 10) / 10 : null,
      hrv: avgHRV,
      activeCalories: totalActive ? Math.round(totalActive) : null,
      basalCalories: totalResting ? Math.round(totalResting) : null,
      tdee: totalActive && totalResting ? Math.round(totalActive + totalResting) : null,
      sleep: sleep.total ? Math.round(sleep.total * 10) / 10 : null,
      deepSleep: sleep.deep ? Math.round(sleep.deep * 10) / 10 : null,
      remSleep: sleep.rem ? Math.round(sleep.rem * 10) / 10 : null,
      coreSleep: sleep.core ? Math.round(sleep.core * 10) / 10 : null,
    }
  };
}

// ── Aggregate workout rows ─────────────────────────────────────────────
function aggregateWorkouts(rows) {
  if (!rows.length) return null;
  console.log('[Workout] Column count:', Object.keys(rows[0]).length);
  console.log('[Workout] Keys:', JSON.stringify(Object.keys(rows[0])));

  const findCol = (row, ...terms) => {
    const keys = Object.keys(row);
    for (const term of terms) {
      const key = keys.find(k => k.toLowerCase().includes(term.toLowerCase()));
      if (key && row[key] !== '') return row[key];
    }
    return '';
  };

  const latest = rows[rows.length - 1];
  return {
    lastDate: findCol(latest, 'Start')?.split(' ')[0] || findCol(latest, 'start')?.split('T')[0],
    lastType: findCol(latest, 'Type', 'type'),
    lastDuration: findCol(latest, 'Duration', 'duration'),
    lastActiveKcal: num(findCol(latest, 'Active Energy')),
    lastAvgHR: num(findCol(latest, 'Avg Heart Rate')),
    lastMaxHR: num(findCol(latest, 'Max Heart Rate')),
    history: rows.slice(-10).reverse().map(r => ({
      date: findCol(r, 'Start')?.split(' ')[0],
      type: findCol(r, 'Type', 'type'),
      duration: findCol(r, 'Duration'),
      kcal: num(findCol(r, 'Active Energy')),
      avgHR: num(findCol(r, 'Avg Heart Rate')),
    }))
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

    // Get latest health CSV
    const healthFiles = await listFiles(token, HEALTH_FOLDER);
    const workoutFiles = await listFiles(token, WORKOUT_FOLDER);

    if (!healthFiles.length) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, message: 'No files found' }) };

    // Use yesterday's health file (today's is incomplete)
    // Files are sorted desc by name, so [0]=today, [1]=yesterday
    const healthFile = healthFiles.length > 1 ? healthFiles[1] : healthFiles[0];
    const healthCSV = await downloadFile(token, healthFile.id, healthFile.mimeType);
    const healthRows = parseCSV(healthCSV);
    const { body, recovery } = aggregateHealth(healthRows);

    // Download and parse latest workout file
    let workout = null;
    if (workoutFiles.length) {
      const workoutCSV = await downloadFile(token, workoutFiles[0].id, workoutFiles[0].mimeType);
      const workoutRows = parseCSV(workoutCSV);
      workout = aggregateWorkouts(workoutRows);
    }

    const result = {
      ok: true,
      body,
      recovery,
      workout,
      meta: {
        lastSync: today,
        healthFile: healthFile.name,
        workoutFile: workoutFiles[0]?.name || null,
      }
    };

    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message, stack: err.stack }) };
  }
};
