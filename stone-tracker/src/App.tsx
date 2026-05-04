import { useEffect, useState } from "react";
import AgonyTracker from "./AgonyTracker";
import "./AgonyTracker.css";
import agonyImg from './assets/Stone_of_Agony_OoT.webp';
import { getAgony, getGreg, getTotalChecksAvailable, getTotalChecksDone } from './lib/archipelago';

function parseFlag(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function App() {
  const [agony, setAgony] = useState(0);
  const [agonyTotal, setAgonyTotal] = useState(0);
  const [greg, setGreg] = useState(0);
  const [gregTotal, setGregTotal] = useState(0);
  const [checks, setChecks] = useState(0);
  const [checksTotal, setChecksTotal] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [roomId, setRoomId] = useState<string | null>(() => {
    try {
      const url = new URL(window.location.href);
      // 1) Query param ?room=
      const q = url.searchParams.get("room");
      if (q) return q;
      // 2) Hash param #room=
      if (url.hash) {
        const h = new URLSearchParams(url.hash.slice(1));
        const hr = h.get("room");
        if (hr) return hr;
      }

      // Do not accept pretty-paths (last path segment) because GitHub Pages
      // cannot serve arbitrary paths for single-page assets. Only accept
      // explicit `?room=` or `#room=` parameters.
      return null;
    } catch (e) {
      return null;
    }
  });
  const [showGreg] = useState<boolean>(() => {
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams.get("greg");
      if (parseFlag(q)) return true;
      if (url.hash) {
        const h = new URLSearchParams(url.hash.slice(1));
        const hg = h.get("greg");
        if (parseFlag(hg)) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  });
  const percent = checksTotal > 0 ? ((checks / checksTotal) * 100).toFixed(2) : "0.00";


  useEffect(() => {
    if (!roomId) return;

    let mounted = true;

    const fetchInitialAndSchedule = async () => {
      try {
        // Fetch total checks (only once)
        const totalJson = await getTotalChecksAvailable(roomId);
        if (!mounted) return;
        setChecksTotal(totalJson.total_checks_available ?? 0);

        // Fetch dynamic values (agony + checks done) in parallel for initial load
        setInitialLoading(true);
        const gregPromise = showGreg
          ? getGreg(roomId)
          : Promise.resolve({ collected: 0, total: 0 });
        const [agonyJson, doneJson, gregJson] = await Promise.all([
          getAgony(roomId),
          getTotalChecksDone(roomId),
          gregPromise,
        ]);
        if (!mounted) return;
        setAgony(agonyJson.collected);
        setAgonyTotal(agonyJson.total);
        setGreg(gregJson.collected);
        setGregTotal(gregJson.total);
        setChecks(doneJson.checks_done ?? 0);
        setInitialLoading(false);

        // Schedule periodic refresh for dynamic values only (every 1 minute)
        const interval = setInterval(async () => {
          try {
            const gPromise = showGreg
              ? getGreg(roomId)
              : Promise.resolve({ collected: 0, total: 0 });
            const [aJson, cJson, gJson] = await Promise.all([
              getAgony(roomId),
              getTotalChecksDone(roomId),
              gPromise,
            ]);
            if (!mounted) return;
            setAgony(aJson.collected);
            setAgonyTotal(aJson.total);
            setGreg(gJson.collected);
            setGregTotal(gJson.total);
            setChecks(cJson.checks_done ?? 0);
          } catch (err) {
            // ignore periodic errors for now
            console.error('Periodic fetch error', err);
          }
        }, 60000);

        // cleanup interval on unmount
        return () => clearInterval(interval);
      } catch (err) {
        console.error('Initial fetch error', err);
        if (mounted) setInitialLoading(false);
      }
    };

    const cleanupPromise = fetchInitialAndSchedule();
    return () => {
      mounted = false;
      // If fetchInitialAndSchedule returned a cleanup function (interval clearer), call it
      Promise.resolve(cleanupPromise).then((maybeCleanup) => {
        if (typeof maybeCleanup === 'function') maybeCleanup();
      });
    };
  }, [roomId, showGreg]);

  const [inputValue, setInputValue] = useState("");

  const submitRoom = (value?: string) => {
    const v = (value ?? inputValue).trim();
    if (!v) return;
    // update URL to include ?room= without changing the path (avoids GH Pages 404s)
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('room', v);
      // keep pathname unchanged to avoid pretty-paths that GitHub Pages can't serve
      window.history.pushState({}, '', u.toString());
    } catch (e) {
      // fallback: replace location.search directly
      const loc = window.location;
      const base = loc.pathname || '/';
      const newUrl = `${loc.origin}${base}?room=${encodeURIComponent(v)}`;
      window.history.pushState({}, '', newUrl);
    }
    setRoomId(v);
  };

  if (!roomId) {
    return (
      <div style={{ margin: "0px", height: "100vh", width: "100vw", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="tracker-card room-fallback" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={agonyImg} alt="Agony" style={{ width: 64, height: 64, objectFit: 'contain' }} />
          <div style={{ flex: 1, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="room-input"
              aria-label="room-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitRoom(); }}
              placeholder="Enter Room ID"
              style={{ flex: 1 }}
            />
            <button className="room-go" onClick={() => submitRoom()}>Go</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ margin: "0px", height: "100vh", width: "100vw", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <AgonyTracker
        agony={initialLoading ? `...` : agony}
        agonyTotal={initialLoading ? `...` : agonyTotal}
        greg={initialLoading ? `...` : greg}
        gregTotal={initialLoading ? `...` : gregTotal}
        showGreg={showGreg}
        checks={initialLoading ? `...` : checks}
        checksTotal={initialLoading ? `...` : checksTotal}
        percent={initialLoading ? `...` : percent}
      />
    </div>
  );
}

export default App;
