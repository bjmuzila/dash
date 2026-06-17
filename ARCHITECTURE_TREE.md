# SPX GEX Dashboard Architecture Tree

```text
spx-gex-dashboard-tt-fixed/
|-- App shell
|   |-- app/
|   |   |-- pages and routes for the Next.js dashboard
|   |   |-- api/ routes for data, snapshots, quotes, GEX, flow, calendars, Discord
|   |   `-- layout.tsx + globals.css for the main app wrapper and styling
|   |
|   |-- components/
|   |   |-- shared/ app frame, sidebar, top bar, quote panel, buttons
|   |   |-- dashboard/ charts, GEX table, heatmap, flow tape, stats panels
|   |   `-- insights/ specialized insight widgets
|   |
|   `-- hooks/
|       |-- live Tastytrade/dxLink stream handling
|       |-- SPX flow state
|       `-- refresh button behavior
|
|-- Backend/runtime layer
|   |-- server-with-proxy.js
|   |   |-- starts the Next.js server
|   |   |-- starts or reuses the local market-data proxy
|   |   `-- bridges /ws/dxlink WebSocket traffic
|   |
|   |-- proxy-tastytrade.js
|   |   |-- talks to Tastytrade and dxLink
|   |   |-- handles tokens/session state
|   |   `-- feeds quotes, chains, candles, and live data back to the app
|   |
|   `-- Discord tools
|       |-- discord-bot.js
|       `-- register-commands.js
|
|-- Shared logic
|   |-- lib/
|   |   |-- API helpers
|   |   |-- database and snapshot helpers
|   |   |-- proxy auth/config helpers
|   |   `-- math for GEX, flow, calculations, estimated moves
|   |
|   `-- data/
|       |-- cached estimated-move data
|       |-- previous closes
|       `-- local database/state files
|
|-- Legacy dashboard
|   |-- Vanilla/
|   |   |-- older HTML/CSS/JS version of the dashboard
|   |   |-- legacy pages and shared browser scripts
|   |   |-- older proxy/database/calculation scripts
|   |   `-- historical data, MVC spreadsheets, and assets
|   |
|   `-- app/legacy/
|       `-- bridge for viewing selected legacy pages inside the Next.js app
|
|-- Assets and outputs
|   |-- public/
|   |   `-- logos and static files
|   |
|   |-- outputs/
|   |   `-- generated SPX OHLC reports, raw data, previews, inspections
|   |
|   `-- logs
|       `-- local server/proxy/test logs
|
|-- Docs and setup
|   |-- md files/
|   |   `-- notes, migration docs, setup guides, feature logic
|   |
|   |-- package.json
|   |   `-- scripts: dev/start, build, Discord bot
|   |
|   |-- config files
|   |   `-- Next.js, Tailwind, TypeScript, deployment, npm config
|   |
|   `-- env/token files
|       `-- local secrets and Tastytrade session state
|
`-- Generated/installed folders
    |-- node_modules/
    |-- .next/
    `-- .git/
```

## Simple Data Flow

```text
Browser dashboard
    |
    v
Next.js app pages and React components
    |
    v
Next.js API routes
    |
    |-- local data, snapshots, cache, math helpers
    |
    `-- Tastytrade proxy
            |
            v
        Tastytrade / dxLink market data

Discord bot/share routes sit beside the dashboard and can publish snapshots or command results to Discord.
```

## Mental Model

```text
Frontend: app/ + components/ + hooks/
Backend: app/api/ + server-with-proxy.js + proxy-tastytrade.js
Logic: lib/
Storage: data/ + local token/env files + generated outputs
Legacy: Vanilla/
Docs: md files/ + setup markdown files
```
