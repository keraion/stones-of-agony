// Prefer local wrangler dev during development. In CI / production set
// `VITE_API_URL` as a repository secret to your deployed proxy URL.
// Add `?direct=1` (or `#direct=1`) to the URL to skip the worker and hit
// archipelago.gg directly (requires CORS to be enabled on the upstream).
const DEFAULT_WORKER = 'http://127.0.0.1:8787';
const UPSTREAM_DIRECT = 'https://archipelago.gg';

const API_BASE = (() => {
    try {
        // Runtime override: ?direct=1 skips the worker entirely
        const urlParams = new URLSearchParams(
            window.location.search ||
            (window.location.hash ? window.location.hash.slice(1) : '')
        );
        const direct = urlParams.get('direct');
        if (direct === '1' || direct === 'true' || direct === 'yes' || direct === 'on') {
            return UPSTREAM_DIRECT;
        }
    } catch (e) {
        // ignore (e.g. SSR / non-browser environment)
    }
    try {
        const v = (import.meta as any).env?.VITE_API_URL;
        if (v && typeof v === 'string' && v.length) return v.replace(/\/$/, '');
    } catch (e) {
        // ignore
    }
    return DEFAULT_WORKER;
})();

async function fetchJson(path: string, opts?: RequestInit) {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, opts);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText} ${text}`);
    }
    return res.json();
}

export async function getRoomStatus(roomId: string) {
    return withSessionCache(
        `room_status:${roomId}`,
        86400,
        () => fetchJson(`/api/room_status/${encodeURIComponent(roomId)}`)
    );
}

export async function getTracker(trackerId: string) {
    return withSessionCache(
        `tracker:${trackerId}`,
        60,
        () => fetchJson(`/api/tracker/${encodeURIComponent(trackerId)}`),
        { allowStaleOnError: true }
    );
}

export async function getStaticTracker(trackerId: string) {
    return withSessionCache(
        `static_tracker:${trackerId}`,
        86400,
        () => fetchJson(`/api/static_tracker/${encodeURIComponent(trackerId)}`)
    );
}

export async function getDatapackage(checksum: string) {
    return withSessionCache(
        `datapackage:${checksum}`,
        86400,
        () => fetchJson(`/api/datapackage/${encodeURIComponent(checksum)}`)
    );
}

const INFLIGHT_TTL_MS = 30000;

type InflightEntry<T> = {
    promise: Promise<T>;
    startedAt: number;
};

// In-flight promise map: prevents duplicate concurrent requests for the same key.
// Entries expire defensively so a hung request cannot pin the key forever.
const _inflight = new Map<string, InflightEntry<any>>();

// sessionStorage-based caching helper. Stores {ts: number, data: any}
// Also coalesces concurrent callers: if a fetch for `key` is already in flight,
// all callers share that single promise rather than issuing duplicate requests.
type SessionCacheOptions = {
    allowStaleOnError?: boolean;
    maxStaleAgeSeconds?: number;
};

function withSessionCache<T>(
    key: string,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
    options?: SessionCacheOptions
): Promise<T> {
    let staleData: T | null = null;
    let staleTimestamp: number | null = null;

    const allowStaleOnError = options?.allowStaleOnError ?? true;
    const maxStaleAgeMs = (options?.maxStaleAgeSeconds ?? Number.POSITIVE_INFINITY) * 1000;

    try {
        const raw = sessionStorage.getItem(key);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.ts === 'number') {
                    const age = Date.now() - parsed.ts;
                    if (age < ttlSeconds * 1000 && 'data' in parsed) {
                        return Promise.resolve(parsed.data as T);
                    }
                    if ('data' in parsed) {
                        staleData = parsed.data as T;
                        staleTimestamp = parsed.ts;
                    }
                }
            } catch (e) {
                // fall through to fetch
            }
        }
    } catch (e) {
        // sessionStorage not available (e.g., some privacy modes) - fallback to fetcher
        return fetcher();
    }

    // Return the existing in-flight promise if one is already running for this key.
    const now = Date.now();
    const existing = _inflight.get(key);
    if (existing) {
        if (now - existing.startedAt < INFLIGHT_TTL_MS) {
            return existing.promise as Promise<T>;
        }
        _inflight.delete(key);
    }

    const promise = fetcher()
        .then((data) => {
            _inflight.delete(key);
            try {
                const toStore = JSON.stringify({ ts: Date.now(), data });
                sessionStorage.setItem(key, toStore);
            } catch (e) {
                // ignore storage errors
            }
            return data;
        })
        .catch((err) => {
            _inflight.delete(key);
            if (allowStaleOnError && staleData !== null && staleTimestamp !== null) {
                const currentAge = Date.now() - staleTimestamp;
                if (currentAge <= maxStaleAgeMs) {
                    return staleData;
                }
            }
            throw err;
        });

    _inflight.set(key, { promise, startedAt: now });
    return promise;
}

// Helper to extract tracker id from room status
export async function resolveTrackerIdFromRoom(roomId: string) {
    const rs = await getRoomStatus(roomId);
    return rs?.tracker;
}

export async function getPlayerToGameMap(roomId: string): Promise<Record<number, string>> {
    const rs = await getRoomStatus(roomId);
    const players = rs?.players || [];
    const mapping: Record<number, string> = {};
    players.forEach((slot: any, idx: number) => {
        const game = slot && slot[1];
        mapping[idx + 1] = game;
    });
    return mapping;
}

export async function getTotalChecksAvailable(roomId: string): Promise<{ total_checks_available: number }> {
    const trackerId = await resolveTrackerIdFromRoom(roomId);
    if (!trackerId) return { total_checks_available: 0 };
    const staticTracker = await getStaticTracker(trackerId);
    const player_locations = staticTracker?.player_locations_total || [];
    let total = 0;
    for (const p of player_locations) {
        total += Number(p?.total_locations || 0);
    }
    return { total_checks_available: total };
}

const AGONY_GAMES = ["Ocarina of Time", "Ship of Harkinian"];
const GREG_GAMES = ["Ship of Harkinian"];

async function getSpecialItemProgress(
    roomId: string,
    itemName: string,
    supportedGames: string[]
): Promise<{ collected: number; total: number }> {
    // Resolve tracker and datapackages
    const trackerId = await resolveTrackerIdFromRoom(roomId);
    if (!trackerId) return { collected: 0, total: 0 };

    const [staticTracker, trackerData, roomStatus] = await Promise.all([
        getStaticTracker(trackerId),
        getTracker(trackerId),
        getRoomStatus(roomId),
    ]);

    // Build map of game -> item id via datapackage (fetched in parallel)
    const datapackage = staticTracker?.datapackage || {};
    const stoneIdByGame: Record<string, number | null> = Object.fromEntries(
        await Promise.all(
            supportedGames.map(async (game) => {
                const gameInfo = datapackage?.[game];
                if (!gameInfo?.checksum) return [game, null];
                try {
                    const dp = await getDatapackage(gameInfo.checksum);
                    const id = dp?.item_name_to_id?.[itemName];
                    return [game, typeof id === 'number' ? id : null];
                } catch (e) {
                    return [game, null];
                }
            })
        )
    );

    // Map players to game
    const players = roomStatus?.players || [];
    const playerStoneBySlot: Record<number, number | null> = {};
    players.forEach((slot: any, idx: number) => {
        const game = slot && slot[1];
        playerStoneBySlot[idx + 1] = stoneIdByGame[game] ?? null;
    });

    // Total players that should collect Stone of Agony
    const total = Object.values(playerStoneBySlot).filter((v) => v != null).length;

    // Count collected stones by inspecting trackerData.player_items_received
    const player_items_received = trackerData?.player_items_received || [];
    let collected = 0;
    for (let i = 0; i < player_items_received.length; i++) {
        const slotIndex = i + 1;
        const itemId = playerStoneBySlot[slotIndex];
        if (!itemId) continue;
        const entry = player_items_received[i] || {};
        const items = entry.items || [];
        for (const netitem of items) {
            if (Array.isArray(netitem) && netitem.length >= 1 && netitem[0] === itemId) {
                collected += 1;
                break; // count each player's stone once
            }
        }
    }

    return { collected, total };
}

export async function getAgony(roomId: string): Promise<{ collected: number; total: number }> {
    return getSpecialItemProgress(roomId, "Stone of Agony", AGONY_GAMES);
}

export async function getGreg(roomId: string): Promise<{ collected: number; total: number }> {
    return getSpecialItemProgress(roomId, "Greg the Green Rupee", GREG_GAMES);
}

export type RoomSummary = {
    agony: { collected: number; total: number };
    greg: { collected: number; total: number };
    checks_done: number | null;
    total_checks_available: number;
    completions: { completions: number; total: number };
};

// One small request that carries everything the tracker UI shows. The worker
// digests the multi-megabyte tracker payload server-side; in direct mode
// (?direct=1) there is no worker, so fall back to computing it client-side
// from the raw endpoints.
export async function getSummary(
    roomId: string,
    opts?: { includeGreg?: boolean; includeCompletions?: boolean }
): Promise<RoomSummary> {
    if (API_BASE !== UPSTREAM_DIRECT) {
        // Short TTL: the response is ~240 bytes and the worker's edge cache
        // absorbs the traffic. Polling often picks up a freshly revalidated
        // edge copy quickly instead of lagging a full cache cycle behind.
        return withSessionCache(
            `summary:${roomId}`,
            15,
            () => fetchJson(`/api/summary/${encodeURIComponent(roomId)}`),
            { allowStaleOnError: true }
        );
    }
    const [agony, done, total, greg, completions] = await Promise.all([
        getAgony(roomId),
        getTotalChecksDone(roomId),
        getTotalChecksAvailable(roomId),
        opts?.includeGreg ? getGreg(roomId) : Promise.resolve({ collected: 0, total: 0 }),
        opts?.includeCompletions
            ? getCompletionCount(roomId)
            : Promise.resolve({ completions: 0, total: 0 }),
    ]);
    return {
        agony,
        greg,
        checks_done: done.checks_done,
        total_checks_available: total.total_checks_available,
        completions,
    };
}

export async function getTotalChecksDone(roomId: string): Promise<{ checks_done: number | null }> {
    const trackerId = await resolveTrackerIdFromRoom(roomId);
    if (!trackerId) return { checks_done: null };
    const trackerData = await getTracker(trackerId);
    const arr = trackerData?.total_checks_done;
    if (Array.isArray(arr) && arr.length > 0) {
        const obj = arr[0];
        return { checks_done: obj?.checks_done ?? null };
    }
    return { checks_done: null };
}

export async function getCompletionCount(roomId: string): Promise<{ completions: number; total: number }> {
    const trackerId = await resolveTrackerIdFromRoom(roomId);
    if (!trackerId) return { completions: 0, total: 0 };

    const trackerData = await getTracker(trackerId);
    const statuses = trackerData?.player_status;
    if (!Array.isArray(statuses)) return { completions: 0, total: 0 };

    // In Archipelago tracker payloads, status 30 indicates goal completion.
    const completions = statuses.reduce((count: number, entry: any) => {
        return Number(entry?.status) === 30 ? count + 1 : count;
    }, 0);

    return { completions, total: statuses.length };
}

export default {
    API_BASE,
    getSummary,
    getRoomStatus,
    getTracker,
    getStaticTracker,
    getDatapackage,
    getPlayerToGameMap,
    getTotalChecksAvailable,
    getAgony,
    getGreg,
    getTotalChecksDone,
    getCompletionCount,
};
