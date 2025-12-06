# MT4 Trade Analysis & Journal

A web-based application to analyze your MT4 trades and maintain a trading journal. The system automatically syncs trades from your MT4 terminal via an Expert Advisor and Python bridge.

## Features

- **Dashboard**: View portfolio statistics, equity curve, daily performance, and performance by symbol
- **Trade History**: Browse all synced trades with filtering by account, status, and symbol
- **Trading Journal**: Document your trades with emotions, lessons learned, and mistakes
- **Multi-Account Support**: Connect multiple MT4 accounts
- **Automatic Sync**: EA + Bridge automatically syncs trades every 30 seconds

## Architecture

```
┌─────────────────┐                    ┌─────────────────┐                    ┌─────────────────┐
│   MT4 Terminal  │   writes JSON      │  Python Bridge  │    HTTP POST       │   Backend API   │
│  (Expert Advisor)│ ───────────────>  │ (sync_bridge.py)│ ─────────────────> │  (Node/Express) │
└─────────────────┘   to file          └─────────────────┘                    └────────┬────────┘
                                                                                       │
                                       ┌─────────────────┐                    ┌────────▼────────┐
                                       │   Web Frontend  │ <───────────────── │    SQLite DB    │
                                       │     (React)     │                    └─────────────────┘
                                       └─────────────────┘
```

**Why a bridge?** MT4's WebRequest() cannot connect to localhost and has strict HTTPS requirements. The file-based bridge solves this reliably.

## Quick Start

### 1. Install Dependencies

```bash
# Install root dependencies
npm install

# Install client dependencies
cd client && npm install && cd ..
```

### 2. Start the Application

```bash
# Start both backend and frontend
npm run dev
```

Or run them separately:

```bash
# Terminal 1 - Backend API (port 3001)
npm run server

# Terminal 2 - Frontend (port 5173)
npm run client
```

### 3. Access the Web App

Open http://localhost:5173 in your browser.

### 4. Add Your MT4 Account

1. Go to **Accounts** tab
2. Click **Add Account**
3. Enter your MT4 account details
4. Copy the generated **API Key**

### 5. Setup MT4 Expert Advisor

1. Copy `MT4_EA/TradeSyncFile.mq4` to your MT4 `Experts` folder:
   - In MT4: `File` → `Open Data Folder` → `MQL4` → `Experts`
   - Copy the file there

2. Open MetaEditor and compile the EA (F7)

3. Attach the EA to any chart:
   - Drag `TradeSyncFile` from Navigator to a chart
   - Enter your **API Key** in the settings
   - Click OK

4. The EA will write trade data to: `MQL4/Files/TradeSync/`

### 6. Run the Python Bridge

The bridge reads files from MT4 and sends them to the dashboard.

```bash
# Install Python dependencies
cd bridge
pip install -r requirements.txt

# Find your MT4 data folder:
# In MT4: File -> Open Data Folder -> MQL4 -> Files -> TradeSync
# Copy that path

# Run the bridge
python sync_bridge.py --mt4-folder "C:/Users/YOU/AppData/Roaming/MetaQuotes/Terminal/XXXX/MQL4/Files/TradeSync"
```

The bridge will watch for new data and sync to the dashboard automatically.

## EA Settings

| Parameter | Default | Description |
|-----------|---------|-------------|
| ServerURL | http://localhost:3001/api/sync | Your backend API URL |
| ApiKey | (empty) | API key from the web app |
| SyncIntervalSeconds | 30 | How often to sync trades |
| SyncOpenTrades | true | Sync currently open trades |
| SyncClosedTrades | true | Sync trade history |
| HistoryDays | 30 | Days of history to sync |

## API Endpoints

### Accounts
- `GET /api/accounts` - List all accounts
- `POST /api/accounts` - Create account
- `DELETE /api/accounts/:id` - Delete account

### Trades
- `GET /api/trades` - List trades (with filters)
- `GET /api/trades/:id` - Get single trade

### Journal
- `GET /api/journal` - List journal entries
- `POST /api/journal` - Create entry
- `PUT /api/journal/:id` - Update entry
- `DELETE /api/journal/:id` - Delete entry

### Analytics
- `GET /api/analytics/portfolio` - Portfolio statistics
- `GET /api/analytics/by-symbol` - Performance by symbol
- `GET /api/analytics/equity-curve` - Equity curve data
- `GET /api/analytics/daily` - Daily performance

### Sync (for EA)
- `POST /api/sync` - Receive trades from MT4 EA

## Project Structure

```
Trade Analysis/
├── client/                 # React frontend
│   ├── src/
│   │   ├── App.jsx        # Main application
│   │   ├── api.js         # API client
│   │   └── index.css      # TailwindCSS
│   └── package.json
├── server/
│   └── index.js           # Express API server
├── data/
│   └── trades.db          # SQLite database (auto-created)
├── MT4_EA/
│   └── TradeSync.mq4      # MT4 Expert Advisor
├── package.json
└── README.md
```

## Deployment

For production deployment:

1. **Backend**: Deploy to any Node.js hosting (Railway, Render, DigitalOcean, etc.)
2. **Frontend**: Build with `npm run build` and deploy to Netlify, Vercel, etc.
3. **Update EA**: Change `ServerURL` to your production API URL
4. **HTTPS**: Use HTTPS for production (required for MT4 WebRequest)

## Troubleshooting

### EA not syncing?
1. Check if "Allow WebRequest" is enabled in MT4
2. Verify the server URL is in the allowed list
3. Check the MT4 Experts tab for error messages
4. Ensure the API key is correct

### Trades not appearing?
1. Wait for the sync interval (default 30 seconds)
2. Check the server console for errors
3. Verify the account exists in the web app

### WebRequest Error 4060?
Add your server URL to MT4's allowed URLs:
`Tools` → `Options` → `Expert Advisors` → Add URL

## License

MIT
