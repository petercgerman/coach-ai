// Health Auto Export v2 — Health Metrics sync endpoint
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  // Auth check
  const token = process.env.HEALTH_SYNC_TOKEN;
  if (token) {
    const auth = event.headers['authorization'] || event.headers['Authorization'] || '';
    if (auth !== `Bearer ${token}`) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
  }

  try {
    const payload = JSON.parse(event.body);
    const metrics = payload.metrics || payload.data?.metrics || [];

    // Helper: get most recent value from a metric's data array
    const latest = (arr) => {
      if (!arr || !arr.length) return null;
      const sorted = [...arr].sort((a, b) => new Date(b.date) - new Date(a.date));
      return sorted[0];
    };

    const getMetric = (name) => {
      const m = metrics.find(m => m.name === name);
      return m ? latest(m.data) : null;
    };

    // Build update object from HealthKit fields
    const update = { body: {}, recovery: {}, meta: {} };
    const now = new Date().toISOString().split('T')[0];

    // ── Body Composition ──
    const weight = getMetric('body_mass');
    if (weight?.qty) {
      update.body.weight = Math.round(weight.qty * 10) / 10;
      update.body.weightDate = weight.date?.split(' ')[0] || now;
    }

    const bf = getMetric('body_fat_percentage');
    if (bf?.qty) update.body.bf = Math.round(bf.qty * 10) / 10;

    const leanMass = getMetric('lean_body_mass');
    if (leanMass?.qty) update.body.ffm = Math.round(leanMass.qty * 10) / 10;

    // ── Recovery & Fitness ──
    const rhr = getMetric('resting_heart_rate');
    if (rhr?.qty) update.recovery.rhr = Math.round(rhr.qty);

    const hrv = getMetric('heart_rate_variability_sdnn');
    if (hrv?.qty) update.recovery.hrv = Math.round(hrv.qty);

    const vo2 = getMetric('cardio_fitness');
    if (vo2?.qty) update.recovery.vo2 = Math.round(vo2.qty * 10) / 10;

    const steps = getMetric('step_count');
    if (steps?.qty) update.recovery.steps = Math.round(steps.qty);

    const activeEnergy = getMetric('active_energy');
    const basalEnergy = getMetric('basal_energy_burned');
    if (activeEnergy?.qty && basalEnergy?.qty) {
      update.recovery.tdee = Math.round(activeEnergy.qty + basalEnergy.qty);
    } else if (activeEnergy?.qty) {
      update.recovery.activeCalories = Math.round(activeEnergy.qty);
    }

    // ── Sleep ──
    const sleep = getMetric('sleep_analysis');
    if (sleep) {
      // v2 summarized sleep has asleep, inBed, and sometimes deep/rem/core
      if (sleep.asleep != null) update.recovery.sleep = Math.round(sleep.asleep * 10) / 10;
      if (sleep.deep != null) update.recovery.deepSleep = Math.round(sleep.deep * 10) / 10;
      if (sleep.rem != null) update.recovery.remSleep = Math.round(sleep.rem * 10) / 10;
      if (sleep.core != null) update.recovery.coreSleep = Math.round(sleep.core * 10) / 10;
    }

    // ── Respiratory / other ──
    const respRate = getMetric('respiratory_rate');
    if (respRate?.qty) update.recovery.respiratoryRate = Math.round(respRate.qty * 10) / 10;

    const oxygenSat = getMetric('oxygen_saturation');
    if (oxygenSat?.qty) update.recovery.oxygenSat = Math.round(oxygenSat.qty * 10) / 10;

    update.meta.lastHealthSync = now;
    update.meta.syncSource = 'health-auto-export';

    // Build weight history entry if we got a new weight
    const historyEntry = update.body.weight
      ? { date: update.body.weightDate || now, w: update.body.weight }
      : null;

    // Store in Netlify KV (using environment-based simple store via fetch to our own storage)
    // We write to a well-known key that the coach reads
    const storeKey = 'pete-health-sync';
    const storePayload = {
      update,
      historyEntry,
      receivedAt: new Date().toISOString(),
      metricsCount: metrics.length,
    };

    // Return the parsed update so we can see what was extracted
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        received: metrics.length,
        extracted: {
          weight: update.body.weight,
          bf: update.body.bf,
          rhr: update.recovery.rhr,
          hrv: update.recovery.hrv,
          vo2: update.recovery.vo2,
          steps: update.recovery.steps,
          sleep: update.recovery.sleep,
          deepSleep: update.recovery.deepSleep,
          tdee: update.recovery.tdee,
        },
        timestamp: now,
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
