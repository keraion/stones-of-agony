const UPSTREAM_BASE = 'https://archipelago.gg';

// Cache policy per allowed API prefix. Requests outside these prefixes (and
// /api/summary/ below) are rejected so the worker can't be used as an open
// proxy.
//
// `fresh`: served straight from cache, upstream not contacted at all.
// `stale`: after freshness expires, the cached copy is STILL served instantly
// for up to this many more seconds while the worker re-fetches from upstream
// in the background (stale-while-revalidate). Large rooms make the upstream
// slow, so once a room has been loaded once, no user ever waits on it again —
// they get the previous snapshot immediately and the next request gets the
// refreshed one.
const CACHE_POLICY = {
  '/api/tracker/': { fresh: 60, stale: 3600 },
  '/api/static_tracker/': { fresh: 86400, stale: 86400 },
  '/api/datapackage/': { fresh: 86400, stale: 86400 },
  '/api/room_status/': { fresh: 86400, stale: 86400 },
};

// /api/summary/<roomId>: worker-computed digest of everything the frontend
// shows. The multi-megabyte tracker payload is fetched, parsed, and reduced
// here, so clients transfer a few hundred bytes instead of the raw tracker.
const SUMMARY_ROUTE = '/api/summary/';
const SUMMARY_POLICY = { fresh: 60, stale: 3600 };
// Synthetic origin for cache keys of worker-computed responses (never fetched).
const SUMMARY_CACHE_ORIGIN = 'https://stones-proxy.internal';

// Items whose per-player collection progress the summary reports.
const TRACKED_ITEMS = [
  { key: 'agony', item: 'Stone of Agony', games: ['Ocarina of Time', 'Ship of Harkinian'] },
  { key: 'greg', item: 'Greg the Green Rupee', games: ['Ship of Harkinian'] },
];

const CACHED_AT_HEADER = 'X-Cached-At';

function upstreamBase(env) {
  // env.UPSTREAM_BASE lets tests point at a mock upstream (wrangler dev --var)
  return env.UPSTREAM_BASE || UPSTREAM_BASE;
}

function policyForPath(path) {
  for (const [prefix, policy] of Object.entries(CACHE_POLICY)) {
    if (path.startsWith(prefix)) return policy;
  }
  return null;
}

// Origins allowed to call this worker from a browser. Local dev (any
// localhost/127.0.0.1 port, for vite dev/preview) is also allowed.
const ALLOWED_ORIGINS = new Set(['https://keraion.github.io']);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch (e) {
    return false;
  }
}

// CORS headers for this request: echo the origin back only if it's allowed.
// Non-browser clients (no Origin header) get no CORS headers, which is fine —
// CORS only gates browsers. Vary: Origin keeps any intermediary caches from
// serving one origin's headers to another.
function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  if (!isAllowedOrigin(origin)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': '*',
    Vary: 'Origin',
  };
}

// Response returned to the browser. The long max-age stored in the edge cache
// must not leak to clients (the browser would hold data for the whole stale
// window); the frontend has its own sessionStorage cache, so disable browser
// HTTP caching entirely.
function clientResponse(request, response, cacheStatus) {
  const resp = new Response(response.body, response);
  // Upstream (archipelago.gg) sends Access-Control-Allow-Origin: * itself;
  // strip its CORS headers so our allowlist is authoritative.
  for (const h of [
    'Access-Control-Allow-Origin',
    'Access-Control-Allow-Methods',
    'Access-Control-Allow-Headers',
    'Access-Control-Expose-Headers',
    'Access-Control-Allow-Credentials',
  ]) {
    resp.headers.delete(h);
  }
  for (const [k, v] of Object.entries(corsHeaders(request))) resp.headers.set(k, v);
  resp.headers.set('Cache-Control', 'no-store');
  resp.headers.set('X-Cache', cacheStatus);
  return resp;
}

// `produced` is the plain result of a produce() function:
// { ok, status, statusText, headers, body } with body an ArrayBuffer|string.
function producedResponse(produced) {
  return new Response(produced.body, {
    status: produced.status,
    statusText: produced.statusText,
    headers: new Headers(produced.headers),
  });
}

function buildCacheResponse(produced, policy) {
  const headers = new Headers(produced.headers);
  // The edge cache evicts the entry only after the full fresh+stale window;
  // our own X-Cached-At header tells us when it stopped being fresh.
  headers.set('Cache-Control', `public, max-age=${policy.fresh + policy.stale}`);
  headers.set(CACHED_AT_HEADER, String(Date.now()));
  // The Cache API refuses to store responses carrying Set-Cookie, and
  // Expires from upstream could fight our max-age.
  headers.delete('Set-Cookie');
  headers.delete('Expires');
  return new Response(produced.body, {
    status: produced.status,
    statusText: produced.statusText,
    headers,
  });
}

// Coalesce concurrent produces (cold misses and background refreshes alike)
// for the same cache key within this isolate, so a burst of requests triggers
// one upstream fetch / one summary computation, not many.
const inflight = new Map();

function produceAndCache(cacheKeyUrl, cacheKey, policy, produce) {
  const existing = inflight.get(cacheKeyUrl);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const produced = await produce();
      if (produced.ok) {
        await caches.default.put(cacheKey, buildCacheResponse(produced, policy));
      }
      return produced;
    } finally {
      inflight.delete(cacheKeyUrl);
    }
  })();

  inflight.set(cacheKeyUrl, promise);
  return promise;
}

// Serve from cache with stale-while-revalidate; on a cold miss, block on
// produce() (the one case where a user has to wait).
async function serveWithCache(request, cacheKeyUrl, policy, ctx, produce) {
  const cacheKey = new Request(cacheKeyUrl, { method: 'GET' });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const cachedAt = Number(cached.headers.get(CACHED_AT_HEADER)) || 0;
    if ((Date.now() - cachedAt) / 1000 <= policy.fresh) {
      return clientResponse(request, cached, 'HIT');
    }
    // Stale: return it immediately, refresh in the background. On upstream
    // failure the stale copy just keeps serving until it ages out.
    ctx.waitUntil(produceAndCache(cacheKeyUrl, cacheKey, policy, produce).catch(() => {}));
    return clientResponse(request, cached, 'STALE');
  }

  try {
    const produced = await produceAndCache(cacheKeyUrl, cacheKey, policy, produce);
    return clientResponse(request, producedResponse(produced), 'MISS');
  } catch (e) {
    return clientResponse(
      request,
      new Response(JSON.stringify({ error: String((e && e.message) || e) }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
      'MISS'
    );
  }
}

async function produceUpstream(upstreamUrl) {
  // Deliberately not forwarding browser headers: identical upstream requests
  // keep the cached body consistent across users.
  const res = await fetch(upstreamUrl, { redirect: 'manual' });
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
    body: await res.arrayBuffer(),
  };
}

// Fetch an upstream API path as text, going through the same edge cache the
// passthrough endpoints use (so summary computation and passthrough clients
// share one upstream fetch per TTL).
async function getUpstreamText(env, path, opts) {
  const policy = policyForPath(path);
  const url = upstreamBase(env) + path;
  const cacheKey = new Request(url, { method: 'GET' });

  // forceFresh skips the cached copy (but still stores the new one): the
  // summary recomputes at most once per fresh-window anyway, so always using
  // a live tracker removes up to a full window of stacked staleness without
  // increasing the upstream request rate.
  if (!opts?.forceFresh) {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const cachedAt = Number(cached.headers.get(CACHED_AT_HEADER)) || 0;
      if ((Date.now() - cachedAt) / 1000 <= policy.fresh) {
        return cached.text();
      }
      // Stale is not good enough here: the summary itself is the thing being
      // (re)computed, so pull fresh data.
    }
  }

  const produced = await produceAndCache(url, cacheKey, policy, () => produceUpstream(url));
  if (!produced.ok) throw new Error(`upstream ${path} returned ${produced.status}`);
  return new TextDecoder().decode(produced.body);
}

async function getUpstreamJson(env, path) {
  return JSON.parse(await getUpstreamText(env, path));
}

// --- scan-based extraction ---------------------------------------------
// The tracker payload for a large room is multiple MB, and JSON.parse on it
// alone can blow the Workers free plan's 10ms CPU budget. The summary only
// needs three small pieces of it, so extract them with native string
// scanning (indexOf) instead of parsing the whole document (~6x less CPU).

// Item id for `itemName` from raw datapackage text: a key inside the flat
// "item_name_to_id" object (first `}` after the section opens closes it).
function scanItemId(text, itemName) {
  const sect = text.indexOf('"item_name_to_id"');
  if (sect === -1) return null;
  const sectEnd = text.indexOf('}', sect);
  const key = JSON.stringify(itemName) + ':';
  const k = text.indexOf(key, sect);
  if (k === -1 || k > sectEnd) return null;
  const m = /^\s*(-?\d+)/.exec(text.slice(k + key.length, k + key.length + 32));
  return m ? Number(m[1]) : null;
}

// From raw tracker text: player_status, total_checks_done (both tiny, sliced
// out and JSON.parsed), and which player slots received each wanted item id.
// Relies on the payload's alphabetical key order (player_items_received <
// player_status < total_checks_done); throws if the markers aren't found in
// that order, in which case the caller falls back to a full parse.
function scanTracker(text, wantedIds) {
  const pirKey = text.indexOf('"player_items_received"');
  const psKey = text.indexOf('"player_status"', pirKey);
  const tcdKey = text.indexOf('"total_checks_done"', psKey);
  if (pirKey === -1 || psKey === -1 || tcdKey === -1) throw new Error('unexpected tracker format');

  const parseSlice = (from, to) => {
    let s = text.slice(text.indexOf(':', from) + 1, to).trim();
    if (s.endsWith(',')) s = s.slice(0, -1);
    return JSON.parse(s);
  };
  const playerStatus = parseSlice(psKey + '"player_status"'.length, tcdKey);
  const totalChecksDone = parseSlice(tcdKey + '"total_checks_done"'.length, text.lastIndexOf('}'));

  // Position of each player's "items" array, in slot order. The
  // player_items_received region contains no strings, so these markers and
  // the netitem search below cannot false-positive.
  const itemsPos = [];
  let p = text.indexOf('"items"', pirKey);
  while (p !== -1 && p < psKey) {
    itemsPos.push(p);
    p = text.indexOf('"items"', p + 7);
  }

  // Inside the region, "[<n>," can only start a netitem, whose first element
  // is the item id. Attribute each match to a player slot by binary-searching
  // the items-array start positions.
  const received = new Map(wantedIds.map((id) => [id, new Set()]));
  for (const id of wantedIds) {
    const needle = `[${id},`;
    let q = text.indexOf(needle, pirKey);
    while (q !== -1 && q < psKey) {
      let lo = 0;
      let hi = itemsPos.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (itemsPos[mid] <= q) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (idx >= 0) received.get(id).add(idx);
      q = text.indexOf(needle, q + needle.length);
    }
  }
  return { playerStatus, totalChecksDone, received };
}

// Full-parse fallback for when the scan's format assumptions break.
function parseTracker(text, wantedIds) {
  const tracker = JSON.parse(text);
  const received = new Map(wantedIds.map((id) => [id, new Set()]));
  ((tracker && tracker.player_items_received) || []).forEach((entry, idx) => {
    for (const netitem of (entry && entry.items) || []) {
      if (Array.isArray(netitem) && received.has(netitem[0])) received.get(netitem[0]).add(idx);
    }
  });
  return {
    playerStatus: Array.isArray(tracker && tracker.player_status) ? tracker.player_status : [],
    totalChecksDone: (tracker && tracker.total_checks_done) || [],
    received,
  };
}

async function computeSummary(env, roomId) {
  const roomStatus = await getUpstreamJson(env, `/api/room_status/${encodeURIComponent(roomId)}`);
  const trackerId = roomStatus && roomStatus.tracker;
  if (!trackerId) throw new Error(`room ${roomId} has no tracker id`);

  // room_status and static_tracker are small; only the tracker stays as text.
  const [staticTracker, trackerText] = await Promise.all([
    getUpstreamJson(env, `/api/static_tracker/${encodeURIComponent(trackerId)}`),
    getUpstreamText(env, `/api/tracker/${encodeURIComponent(trackerId)}`, { forceFresh: true }),
  ]);

  let totalChecksAvailable = 0;
  for (const p of (staticTracker && staticTracker.player_locations_total) || []) {
    totalChecksAvailable += Number((p && p.total_locations) || 0);
  }

  // Resolve tracked item ids per game by scanning the datapackages.
  const datapackage = (staticTracker && staticTracker.datapackage) || {};
  const games = [...new Set(TRACKED_ITEMS.flatMap((t) => t.games))];
  const dpTextByGame = {};
  await Promise.all(
    games.map(async (game) => {
      const checksum = datapackage[game] && datapackage[game].checksum;
      if (!checksum) return;
      try {
        dpTextByGame[game] = await getUpstreamText(env, `/api/datapackage/${encodeURIComponent(checksum)}`);
      } catch (e) {
        // Game's datapackage unavailable: its players just don't count.
      }
    })
  );

  const idByItemByGame = {};
  const wantedIds = new Set();
  for (const trackedItem of TRACKED_ITEMS) {
    const idByGame = {};
    for (const game of trackedItem.games) {
      const dpText = dpTextByGame[game];
      const id = dpText ? scanItemId(dpText, trackedItem.item) : null;
      if (typeof id === 'number') {
        idByGame[game] = id;
        wantedIds.add(id);
      }
    }
    idByItemByGame[trackedItem.key] = idByGame;
  }

  let extracted;
  try {
    extracted = scanTracker(trackerText, [...wantedIds]);
  } catch (e) {
    extracted = parseTracker(trackerText, [...wantedIds]);
  }
  const { playerStatus, totalChecksDone, received } = extracted;

  const checksDone =
    Array.isArray(totalChecksDone) && totalChecksDone.length > 0
      ? (totalChecksDone[0]?.checks_done ?? null)
      : null;

  // In Archipelago tracker payloads, status 30 indicates goal completion.
  const completions = playerStatus.filter((s) => Number(s && s.status) === 30).length;

  const players = (roomStatus && roomStatus.players) || [];
  const summary = {
    room: roomId,
    tracker: trackerId,
    total_checks_available: totalChecksAvailable,
    checks_done: checksDone,
    completions: { completions, total: playerStatus.length },
  };

  for (const trackedItem of TRACKED_ITEMS) {
    const idByGame = idByItemByGame[trackedItem.key];
    let total = 0;
    let collected = 0;
    players.forEach((slot, idx) => {
      const itemId = idByGame[slot && slot[1]];
      if (itemId == null) return;
      total += 1;
      if (received.get(itemId).has(idx)) collected += 1;
    });
    summary[trackedItem.key] = { collected, total };
  }

  return summary;
}

async function produceSummary(env, roomId) {
  const summary = await computeSummary(env, roomId);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(summary),
  };
}

export default {
  async fetch(request, env, ctx) {
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Not found', { status: 404, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);

    if (url.pathname.startsWith(SUMMARY_ROUTE)) {
      const roomId = decodeURIComponent(url.pathname.slice(SUMMARY_ROUTE.length));
      if (!roomId || roomId.includes('/')) {
        return new Response('Not found', { status: 404, headers: corsHeaders(request) });
      }
      const cacheKeyUrl = `${SUMMARY_CACHE_ORIGIN}/summary/${encodeURIComponent(roomId)}`;
      return serveWithCache(request, cacheKeyUrl, SUMMARY_POLICY, ctx, () => produceSummary(env, roomId));
    }

    const policy = policyForPath(url.pathname);
    if (policy === null) {
      return new Response('Not found', { status: 404, headers: corsHeaders(request) });
    }
    const upstreamUrl = upstreamBase(env) + url.pathname + url.search;
    return serveWithCache(request, upstreamUrl, policy, ctx, () => produceUpstream(upstreamUrl));
  },
};
