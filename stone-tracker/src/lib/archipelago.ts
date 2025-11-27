// Prefer local wrangler dev during development. In CI / production set
// `VITE_API_URL` as a repository secret to your deployed proxy URL.
const DEFAULT_WORKER = 'http://127.0.0.1:8787';

const API_BASE = (() => {
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
        45,
        () => fetchJson(`/api/tracker/${encodeURIComponent(trackerId)}`));
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

// sessionStorage-based caching helper. Stores {ts: number, data: any}
function withSessionCache<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
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
                }
            } catch (e) {
                // fall through to fetch
            }
        }
    } catch (e) {
        // sessionStorage not available (e.g., some privacy modes) - fallback to fetcher
        return fetcher();
    }

    return fetcher().then((data) => {
        try {
            const toStore = JSON.stringify({ ts: Date.now(), data });
            sessionStorage.setItem(key, toStore);
        } catch (e) {
            // ignore storage errors
        }
        return data;
    });
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


export async function getAgony(roomId: string): Promise<{ collected: number; total: number }> {
    // Resolve tracker and datapackages
    const trackerId = await resolveTrackerIdFromRoom(roomId);
    if (!trackerId) return { collected: 0, total: 0 };

    const [staticTracker, trackerData, roomStatus] = await Promise.all([
        getStaticTracker(trackerId),
        getTracker(trackerId),
        getRoomStatus(roomId),
    ]);

    // Build map of game -> Stone of Agony item id via datapackage
    const datapackage = staticTracker?.datapackage || {};
    const stoneIdByGame: Record<string, number | null> = {};
    for (const game of AGONY_GAMES) {
        const gameInfo = datapackage?.[game];
        if (!gameInfo || !gameInfo.checksum) {
            stoneIdByGame[game] = null;
            continue;
        }
        try {
            const dp = await getDatapackage(gameInfo.checksum);
            const id = dp?.item_name_to_id?.["Stone of Agony"];
            stoneIdByGame[game] = typeof id === 'number' ? id : null;
        } catch (e) {
            stoneIdByGame[game] = null;
        }
    }

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

export default {
    API_BASE,
    getRoomStatus,
    getTracker,
    getStaticTracker,
    getDatapackage,
    getPlayerToGameMap,
    getTotalChecksAvailable,
    getAgony,
    getTotalChecksDone,
};
