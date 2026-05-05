// Health Auto Export v2 — Health Metrics sync endpoint — debug v2
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

  // DEBUG: return the raw payload so we can see exact structure
  try {
    const raw = event.body;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch(parseErr) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          debug: true,
          parseError: parseErr.message,
          rawLength: raw?.length,
          rawPreview: raw?.substring(0, 500),
        }),
      };
    }

    // Return the structure so we can see field names
    const topKeys = Object.keys(parsed);
    const firstMetric = parsed.metrics?.[0] || parsed.data?.metrics?.[0] || null;
    const firstMetricKeys = firstMetric ? Object.keys(firstMetric) : [];
    const firstDataItem = firstMetric?.data?.[0] || null;
    const firstDataKeys = firstDataItem ? Object.keys(firstDataItem) : [];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        debug: true,
        topLevelKeys: topKeys,
        metricsCount: parsed.metrics?.length || parsed.data?.metrics?.length || 0,
        firstMetricName: firstMetric?.name,
        firstMetricKeys,
        firstDataKeys,
        firstDataSample: firstDataItem,
        // Show all metric names so we know exact field names
        allMetricNames: (parsed.metrics || parsed.data?.metrics || []).map(m => m.name),
      }),
    };

  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        debug: true,
        error: err.message,
        stack: err.stack,
      }),
    };
  }
};
