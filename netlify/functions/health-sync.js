// Health Auto Export v2 — parses and returns data, no storage dependency
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // GET — health check
  if (event.httpMethod === 'GET') {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, status: 'health-sync ready' }) };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

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

    const update = { body: {}, recovery: {}, meta: { lastSync: today, metricsReceived: metrics.length } };

    const weight = latest('weight_body_mass');
    if (weight?.qty) { update.body.weight = Math.round(weight.qty * 10) / 10; update.body.weightDate = today; }

    const bf = latest('body_fat_percentage');
    if (bf?.qty) update.body.bf = Math.round(bf.qty * 10) / 10;

    const lean = latest('lean_body_mass');
    if (lean?.qty) update.body.ffm = Math.round(lean.qty * 10) / 10;

    const rhr = latest('resting_heart_rate');
    if (rhr?.qty) update.recovery.rhr = Math.round(rhr.qty);

    const vo2 = latest('cardio_fitness');
    if (vo2?.qty) update.recovery.vo2 = Math.round(vo2.qty * 10) / 10;

    const steps = latest('step_count');
    if (steps?.qty) update.recovery.steps = Math.round(steps.qty);

    const active = latest('active_energy');
    const basal = latest('basal_energy_burned');
    if (active?.qty) update.recovery.activeCalories = Math.round(active.qty);
    if (active?.qty && basal?.qty) update.recovery.tdee = Math.round(active.qty + basal.qty);

    const sleep = latest('sleep_analysis');
    if (sleep) {
      if (sleep.totalSleep) update.recovery.sleep = Math.round(sleep.totalSleep * 10) / 10;
      if (sleep.deep) update.recovery.deepSleep = Math.round(sleep.deep * 10) / 10;
      if (sleep.rem) update.recovery.remSleep = Math.round(sleep.rem * 10) / 10;
      if (sleep.core) update.recovery.coreSleep = Math.round(sleep.core * 10) / 10;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, received: metrics.length, update, syncedAt: today }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
