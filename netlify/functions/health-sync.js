exports.handler = async (event) => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      ok: true,
      method: event.httpMethod,
      bodyLength: event.body ? event.body.length : 0,
    }),
  };
};
