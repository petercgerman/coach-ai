// Health Auto Export v2 — Workouts
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

    // Official format: payload.data.workouts
    const workouts = payload?.data?.workouts || [];

    if (!workouts.length) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, received: 0, message: 'No workouts in payload' }),
      };
    }

    // Sort newest first
    const sorted = [...workouts].sort((a, b) => new Date(b.start) - new Date(a.start));
    const latest = sorted[0];

    const date = latest.start?.split(' ')[0] || today;
    const durationMin = latest.duration ? Math.round(latest.duration / 60) : null;

    // v2 format: activeEnergyBurned: { qty, units }
    const activeKcal = latest.activeEnergyBurned?.qty || null;
    const avgHR = latest.avgHeartRate?.qty || latest.heartRate?.avg?.qty || null;
    const maxHR = latest.maxHeartRate?.qty || latest.heartRate?.max?.qty || null;

    // Build recent workout history (last 10)
    const history = sorted.slice(0, 10).map(w => ({
      date: w.start?.split(' ')[0],
      type: w.name,
      duration: w.duration ? Math.round(w.duration / 60) : null,
      kcal: w.activeEnergyBurned?.qty ? Math.round(w.activeEnergyBurned.qty) : null,
      avgHR: w.avgHeartRate?.qty ? Math.round(w.avgHeartRate.qty) : null,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        received: workouts.length,
        latest: {
          date,
          name: latest.name,
          duration: durationMin ? `${durationMin} min` : null,
          activeKcal: activeKcal ? Math.round(activeKcal) : null,
          avgHR: avgHR ? Math.round(avgHR) : null,
          maxHR: maxHR ? Math.round(maxHR) : null,
        },
        history,
        syncedAt: new Date().toISOString().split('T')[0],
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
