// Health Auto Export v2 — Workout sync endpoint
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
    const workouts = payload.workouts || payload.data?.workouts || [];

    if (!workouts.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, received: 0 }) };
    }

    // Sort by date descending, take most recent
    const sorted = [...workouts].sort((a, b) => new Date(b.start) - new Date(a.start));
    const latest = sorted[0];

    // Parse workout type from Apple Health name
    const typeMap = {
      'Strength Training': 'Strength',
      'High Intensity Interval Training': 'HIIT',
      'Running': 'Run',
      'Walking': 'Walk',
      'Cycling': 'Cycling',
      'Swimming': 'Swim',
      'Yoga': 'Yoga',
      'Functional Strength Training': 'Strength',
      'Cross Training': 'Cross',
      'Elliptical': 'Cardio',
      'Stair Climbing': 'Cardio',
      'Rowing': 'Row',
    };

    const workoutType = typeMap[latest.name] || latest.name || 'Workout';
    const date = latest.start?.split('T')[0] || latest.start?.split(' ')[0] || new Date().toISOString().split('T')[0];
    const durationMin = latest.duration != null ? Math.round(latest.duration / 60) : null;
    const activeKcal = latest.activeEnergyBurned?.qty || latest.activeEnergy?.qty || null;
    const avgHR = latest.heartRateData?.average || latest.averageHeartRate || null;

    // Build exercise summary string
    let exerciseSummary = workoutType;
    if (durationMin) exerciseSummary += ` ${durationMin}min`;
    if (activeKcal) exerciseSummary += ` · ${Math.round(activeKcal)} kcal`;
    if (avgHR) exerciseSummary += ` · avg HR ${Math.round(avgHR)} bpm`;

    // Build recent workouts list (last 10)
    const recentWorkouts = sorted.slice(0, 10).map(w => ({
      date: w.start?.split('T')[0] || w.start?.split(' ')[0],
      type: typeMap[w.name] || w.name || 'Workout',
      ex: w.name + (w.duration ? ` ${Math.round(w.duration/60)}min` : ''),
      kcal: w.activeEnergyBurned?.qty || w.activeEnergy?.qty || null,
    }));

    const workoutUpdate = {
      lastDate: date,
      lastType: workoutType,
      lastExercises: exerciseSummary,
      lastDuration: durationMin,
      lastActiveKcal: activeKcal ? Math.round(activeKcal) : null,
      lastAvgHR: avgHR ? Math.round(avgHR) : null,
      recentWorkouts,
      syncSource: 'health-auto-export',
      lastSynced: new Date().toISOString().split('T')[0],
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        received: workouts.length,
        latestWorkout: {
          date,
          type: workoutType,
          duration: durationMin ? `${durationMin} min` : null,
          activeKcal: activeKcal ? Math.round(activeKcal) : null,
          avgHR: avgHR ? Math.round(avgHR) : null,
        },
        timestamp: new Date().toISOString().split('T')[0],
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
