// Health Auto Export v2 — field names verified from live payload
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const payload = JSON.parse(event.body);
    const metrics = payload?.data?.metrics || [];
    const today = new Date().toISOString().split('T')[0];

    // Find metric by name, get most recent data point
    const find = (name) => metrics.find(m => m.name === name);
    const latest = (name) => {
      const m = find(name);
      if (!m?.data?.length) return null;
      return [...m.data].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    };
    const sum = (name) => {
      const m = find(name);
      if (!m?.data?.length) return null;
      return m.data.reduce((acc, d) => acc + (d.qty || 0), 0);
    };

    const update = { body: {}, recovery: {} };

    // ── Body composition ──
    // Field name is weight_body_mass (not body_mass)
    const weight = latest('weight_body_mass');
    if (weight?.qty) {
      update.body.weight = Math.round(weight.qty * 10) / 10;
      update.body.weightDate = weight.date?.split(' ')[0] || today;
      // Track all-time low
    }

    const bf = latest('body_fat_percentage');
    if (bf?.qty) update.body.bf = Math.round(bf.qty * 10) / 10;

    const lean = latest('lean_body_mass');
    if (lean?.qty) update.body.ffm = Math.round(lean.qty * 10) / 10;

    // ── Recovery ──
    const rhr = latest('resting_heart_rate');
    if (rhr?.qty) update.recovery.rhr = Math.round(rhr.qty);

    // HRV uses heart_rate_variability_sdnn
    const hrv = latest('heart_rate_variability_sdnn');
    if (hrv?.qty) update.recovery.hrv = Math.round(hrv.qty);

    // VO2max
    const vo2 = latest('cardio_fitness');
    if (vo2?.qty) update.recovery.vo2 = Math.round(vo2.qty * 10) / 10;

    // Steps — sum all days or latest
    const stepsLatest = latest('step_count');
    if (stepsLatest?.qty) update.recovery.steps = Math.round(stepsLatest.qty);

    // Calories
    const activeLatest = latest('active_energy');
    if (activeLatest?.qty) update.recovery.activeCalories = Math.round(activeLatest.qty);

    const basalLatest = latest('basal_energy_burned');
    if (basalLatest?.qty) {
      update.recovery.basalCalories = Math.round(basalLatest.qty);
      if (activeLatest?.qty) {
        update.recovery.tdee = Math.round(activeLatest.qty + basalLatest.qty);
      }
    }

    // ── Sleep — fully summarized with deep/rem/core ──
    const sleepLatest = latest('sleep_analysis');
    if (sleepLatest) {
      if (sleepLatest.totalSleep) update.recovery.sleep = Math.round(sleepLatest.totalSleep * 10) / 10;
      if (sleepLatest.deep) update.recovery.deepSleep = Math.round(sleepLatest.deep * 10) / 10;
      if (sleepLatest.rem) update.recovery.remSleep = Math.round(sleepLatest.rem * 10) / 10;
      if (sleepLatest.core) update.recovery.coreSleep = Math.round(sleepLatest.core * 10) / 10;
      if (sleepLatest.awake) update.recovery.awake = Math.round(sleepLatest.awake * 10) / 10;
      if (sleepLatest.inBed) update.recovery.inBed = Math.round(sleepLatest.inBed * 10) / 10;
    }

    // ── Walking metrics (bonus) ──
    const walkDist = latest('walking_running_distance');
    if (walkDist?.qty) update.recovery.walkingKm = Math.round(walkDist.qty * 10) / 10;

    update.meta = {
      lastHealthSync: today,
      syncSource: 'health-auto-export',
      metricsReceived: metrics.length,
      metricNames: metrics.map(m => m.name),
    };

    // Build weight history entry
    const historyEntry = update.body.weight
      ? { date: update.body.weightDate, w: update.body.weight }
      : null;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        received: metrics.length,
        extracted: {
          weight: update.body.weight || null,
          bodyFat: update.body.bf || null,
          leanMass: update.body.ffm || null,
          rhr: update.recovery.rhr || null,
          hrv: update.recovery.hrv || null,
          vo2max: update.recovery.vo2 || null,
          steps: update.recovery.steps || null,
          activeCalories: update.recovery.activeCalories || null,
          tdee: update.recovery.tdee || null,
          sleep: update.recovery.sleep || null,
          deepSleep: update.recovery.deepSleep || null,
          remSleep: update.recovery.remSleep || null,
        },
        update,
        historyEntry,
        syncedAt: today,
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message, stack: err.stack }),
    };
  }
};
