const KV_KEY = 'usecase-decisions';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── API: /api/decisions ──
    if (url.pathname === '/api/decisions') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
      }

      if (request.method === 'GET') {
        const data = await env.DECISIONS.get(KV_KEY);
        return new Response(data || '{}', {
          headers: { 'Content-Type': 'application/json', ...CORS },
        });
      }

      if (request.method === 'PUT') {
        const body = await request.text();
        // Validate it's valid JSON before storing
        JSON.parse(body);
        await env.DECISIONS.put(KV_KEY, body);
        return new Response('{"ok":true}', {
          headers: { 'Content-Type': 'application/json', ...CORS },
        });
      }

      return new Response('Method not allowed', { status: 405, headers: CORS });
    }

    // ── Proxy everything else to Pages ──
    const pagesUrl = `https://tinypeople.pages.dev${url.pathname}${url.search}`;
    const response = await fetch(pagesUrl, { cf: { cacheTtl: 0 } });
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    return newResponse;
  }
};
