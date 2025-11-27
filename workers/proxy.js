const UPSTREAM_BASE = 'https://archipelago.gg';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*', // TODO: 
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname; // e.g., /api/static_tracker/XYZ or /api/tracker/...
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // Map incoming path directly to upstream path.
    // If you want a prefix (e.g., /proxy/...), adjust this mapping accordingly.
    const upstreamUrl = UPSTREAM_BASE + path + url.search;

    // Build a cache key
    const cacheKey = new Request(upstreamUrl, { method: 'GET' });

    // Decide whether to cache this path
    const shouldCacheStatic =
      path.startsWith('/api/static_tracker') ||
      path.startsWith('/api/datapackage') ||
      path.startsWith('/api/room_status');

    // Try the edge cache first for static endpoints
    if (shouldCacheStatic) {
      const cached = await caches.default.match(cacheKey);
      if (cached) {
        const cachedClone = cached.clone();
        for (const [k, v] of Object.entries(corsHeaders())) cachedClone.headers.set(k, v);
        return cachedClone;
      }
    }

    // Forward the request to the upstream
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual',
    });

    // Clone response so we can both return and possibly cache it.
    const respClone = upstreamResponse.clone();

    // Build response to return with CORS headers
    const headers = new Headers(upstreamResponse.headers);
    for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);

    const body = await respClone.arrayBuffer();
    const response = new Response(body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });

    // Cache static responses in the edge cache for 24 hours asynchronously
    if (shouldCacheStatic && upstreamResponse.ok) {
      const cacheResponse = new Response(body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: new Headers(upstreamResponse.headers),
      });
      cacheResponse.headers.set('Cache-Control', 'public, max-age=86400'); // hint
      ctx.waitUntil(caches.default.put(cacheKey, cacheResponse.clone()));
    }

    return response;
  }
};