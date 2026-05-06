exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Step 1: can we read the body?
  const raw = event.body;
  if (!raw) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, step: 1, msg: 'no body received' }) };

  // Step 2: can we parse JSON?
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch(e) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, step: 2, error: 'JSON parse failed: ' + e.message, rawLength: raw.length }) };
  }

  // Step 3: return structure info
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      step: 3,
      topKeys: Object.keys(payload),
      metricsCount: payload?.data?.metrics?.length || 0,
      metricNames: (payload?.data?.metrics || []).map(m => m.name),
      bodyLength: raw.length,
    }),
  };
};
