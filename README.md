# Stones of Agony Tracker

An [Archipelago](https://archipelago.gg) multiworld tracker for OBS overlays, focused on the **Stone of Agony** (Ocarina of Time / Ship of Harkinian) and **Greg the Green Rupee** (Ship of Harkinian).

**Live site:** https://keraion.github.io/stones-of-agony/

---

## Usage

Navigate to the site and enter your Archipelago Room ID, or pass it directly via URL:

```
https://keraion.github.io/stones-of-agony/?room=<ROOM_ID>
```

### URL Options

| Parameter | Values | Description |
|-----------|--------|-------------|
| `room` | Room ID string | **(Required)** Your Archipelago room ID |
| `greg` | `1` / `true` / `yes` / `on` | Show the Greg the Green Rupee tracker (Ship of Harkinian only) |
| `stacked` | `1` / `true` / `yes` / `on` | Use stacked overlay mode (Agony/Greg in a vertical icon list, with stacked Checks and %) |
| `direct` | `1` / `true` / `yes` / `on` | Bypass the Cloudflare worker proxy and hit archipelago.gg directly |

**Example — all options:**
```
https://keraion.github.io/stones-of-agony/?room=<ROOM_ID>&greg=1&stacked=1&direct=1
```

---

## Local Development

Two processes need to run in parallel.

**1. Cloudflare Worker proxy** (from the repo root):
```bash
npx wrangler dev --port 8787
```

**2. Vite dev server** (from `stone-tracker/`):
```bash
cd stone-tracker
npm install
npm run dev
```

Then open http://localhost:5173/?room=<ROOM_ID>.

### Build

```bash
cd stone-tracker
npm run build
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Override the API base URL (e.g. your deployed worker). Used in CI/production via GitHub Actions secret. |

---

## OBS Browser Source Setup

Add the tracker as a **Browser Source** in OBS. In the source properties, paste the following into the **Custom CSS** field to make the background transparent:

```css
:root { background-color: rgba(0, 0, 0, 0); }
body { background-color: rgba(0, 0, 0, 0); background: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }
```
