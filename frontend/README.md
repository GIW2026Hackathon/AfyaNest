# AfyaNest dashboard (React + Vite)

```bash
npm install
npm run dev          # http://localhost:5173, /api is proxied to http://127.0.0.1:8000
npm run build        # production files in dist/
```

Start the API first (see the main README), then sign in with the owner account you
created with `backend/tools/create_owner.py`. The top bar shows whether the server is live.

* `src/api.js` – cookie session + CSRF client
* `src/pages/` – sign-in / sign-up / two-step, farms overview, house analytics, security, team & audit log
* `src/charts/` – hand-built SVG charts on d3-scale/d3-shape: synced time series with
  thresholds and curtain lane, 6 h forecast fan chart, gauge, house floor map, zone×time
  heatmap, daily-rhythm profiles, temperature×humidity comfort map, exposure bars
* English / Kiswahili UI, dark (default) and light themes, respects reduced-motion
