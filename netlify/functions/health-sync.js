// Health Auto Export v2 — Official JSON format
// Payload structure: { "data": { "metrics": [], "workouts": [] } }
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  // No auth required for personal use

  try {
    const payload = JSON.parse(event.body);

    // Official format: payload.data.metrics
    const metrics = payload?.data?.metrics || [];

    if (!metrics.length) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, received: 0, message: 'No metrics in payload' }),
      };
    }

    // Helper: find metric by name, get most recent data point
    const getLatest = (name) => {
      const metric = metrics.find(m => m.name === name);
      if (!metric?.data?.length) return null;
      return [...metric.data].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    };

    const update = { body: {}, recovery: {} };
    const today = new Date().toISOString().split('T')[0];

    // ── Body composition ──
    const weight = getLatest('body_mass');
    if (weight?.qty) {
      update.body.weight = Math.round(weight.qty * 10) / 10;
      update.body.weightDate = weight.date?.split(' ')[0] || today;
    }

    const bf = getLatest('body_fat_percentage');
    if (bf?.qty) update.body.bf = Math.round(bf.qty * 10) / 10;

    const lean = getLatest('lean_body_mass');
    if (lean?.qty) update.body.ffm = Math.round(lean.qty * 10) / 10;

    // ── Recovery ──
    const rhr = getLatest('resting_heart_rate');
    if (rhr?.qty) update.recovery.rhr = Math.round(rhr.qty);

    const hrv = getLatest('heart_rate_variability_sdnn');
    if (hrv?.qty) update.recovery.hrv = Math.round(hrv.qty);

    const vo2 = getLatest('cardio_fitness');
    if (vo2?.qty) update.recovery.vo2 = Math.round(vo2.qty * 10) / 10;

    const steps = getLatest('step_count');
    if (steps?.qty) update.recovery.steps = Math.round(steps.qty);

    const active = getLatest('active_energy');
    if (active?.qty) update.recovery.activeCalories = Math.round(active.qty);

    const basal = getLatest('basal_energy_burned');
    if (basal?.qty && active?.qty) {
      update.recovery.tdee = Math.round(active.qty + basal.qty);
    }

    // ── Sleep (aggregated format) ──
    const sleep = getLatest('sleep_analysis');
    if (sleep) {
      if (sleep.asleep != null) update.recovery.sleep = Math.round(sleep.asleep * 10) / 10;
      if (sleep.deep != null) update.recovery.deepSleep = Math.round(sleep.deep * 10) / 10;
      if (sleep.rem != null) update.recovery.remSleep = Math.round(sleep.rem * 10) / 10;
      if (sleep.core != null) update.recovery.coreSleep = Math.round(sleep.core * 10) / 10;
      if (sleep.totalSleep != null) update.recovery.totalSleep = Math.round(sleep.totalSleep * 10) / 10;
    }

    // Build weight history entry
    const historyEntry = update.body.weight
      ? { date: update.body.weightDate, w: update.body.weight }
      : null;

    // Return parsed summary
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        received: metrics.length,
        extracted: {
          weight: update.body.weight || null,
          bodyFat: update.body.bf || null,
          rhr: update.recovery.rhr || null,
          hrv: update.recovery.hrv || null,
          vo2max: update.recovery.vo2 || null,
          steps: update.recovery.steps || null,
          sleep: update.recovery.sleep || null,
          deepSleep: update.recovery.deepSleep || null,
          tdee: update.recovery.tdee || null,
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
