import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize SQLite database
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../data/trades.db');
const db = new Database(dbPath);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    account_number TEXT UNIQUE NOT NULL,
    broker TEXT,
    name TEXT,
    balance REAL DEFAULT 0,
    equity REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    leverage TEXT,
    server TEXT,
    platform TEXT DEFAULT 'MT4',
    api_key TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    ticket INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL,
    lots REAL NOT NULL,
    open_price REAL NOT NULL,
    close_price REAL,
    stop_loss REAL,
    take_profit REAL,
    open_time DATETIME NOT NULL,
    close_time DATETIME,
    commission REAL DEFAULT 0,
    swap REAL DEFAULT 0,
    profit REAL DEFAULT 0,
    magic_number INTEGER DEFAULT 0,
    comment TEXT,
    status TEXT DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    UNIQUE(account_id, ticket)
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    trade_id TEXT,
    account_id TEXT,
    title TEXT,
    content TEXT,
    tags TEXT,
    emotion TEXT,
    rating INTEGER,
    lessons_learned TEXT,
    mistakes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trade_id) REFERENCES trades(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );

  CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id);
  CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
  CREATE INDEX IF NOT EXISTS idx_trades_open_time ON trades(open_time);
  CREATE INDEX IF NOT EXISTS idx_journal_trade ON journal_entries(trade_id);
`);

// CORS configuration for production
const corsOptions = {
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
}

// ============ ACCOUNT ENDPOINTS ============

// Get all accounts
app.get('/api/accounts', (req, res) => {
  try {
    const accounts = db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all();
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create account
app.post('/api/accounts', (req, res) => {
  try {
    const { account_number, broker, name, currency, leverage, server, platform } = req.body;
    const id = uuidv4();
    const api_key = uuidv4().replace(/-/g, '');
    
    const stmt = db.prepare(`
      INSERT INTO accounts (id, account_number, broker, name, currency, leverage, server, platform, api_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(id, account_number, broker, name, currency || 'USD', leverage, server, platform || 'MT4', api_key);
    
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    res.status(201).json(account);
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: 'Account number already exists' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Delete account
app.delete('/api/accounts/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM journal_entries WHERE account_id = ?').run(id);
    db.prepare('DELETE FROM trades WHERE account_id = ?').run(id);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ EA DATA SYNC ENDPOINT ============

// Receive trades from MT4 EA
app.post('/api/sync', (req, res) => {
  try {
    const { api_key, account_info, trades } = req.body;
    
    if (!api_key) {
      return res.status(401).json({ error: 'API key required' });
    }
    
    // Find account by API key
    const account = db.prepare('SELECT * FROM accounts WHERE api_key = ?').get(api_key);
    if (!account) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    
    // Update account info
    if (account_info) {
      db.prepare(`
        UPDATE accounts SET balance = ?, equity = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(account_info.balance || 0, account_info.equity || 0, account.id);
    }
    
    // Upsert trades
    const upsertTrade = db.prepare(`
      INSERT INTO trades (id, account_id, ticket, symbol, type, lots, open_price, close_price, 
        stop_loss, take_profit, open_time, close_time, commission, swap, profit, magic_number, comment, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, ticket) DO UPDATE SET
        close_price = excluded.close_price,
        stop_loss = excluded.stop_loss,
        take_profit = excluded.take_profit,
        close_time = excluded.close_time,
        commission = excluded.commission,
        swap = excluded.swap,
        profit = excluded.profit,
        status = excluded.status,
        updated_at = CURRENT_TIMESTAMP
    `);
    
    let synced = 0;
    if (trades && Array.isArray(trades)) {
      for (const trade of trades) {
        const id = uuidv4();
        upsertTrade.run(
          id,
          account.id,
          trade.ticket,
          trade.symbol,
          trade.type,
          trade.lots,
          trade.open_price,
          trade.close_price || null,
          trade.stop_loss || null,
          trade.take_profit || null,
          trade.open_time,
          trade.close_time || null,
          trade.commission || 0,
          trade.swap || 0,
          trade.profit || 0,
          trade.magic_number || 0,
          trade.comment || '',
          trade.close_time ? 'closed' : 'open'
        );
        synced++;
      }
    }
    
    res.json({ success: true, synced });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ TRADE ENDPOINTS ============

// Get all trades with filters
app.get('/api/trades', (req, res) => {
  try {
    const { account_id, symbol, status, from, to, limit = 100, offset = 0 } = req.query;
    
    let query = 'SELECT t.*, a.account_number, a.broker FROM trades t JOIN accounts a ON t.account_id = a.id WHERE 1=1';
    const params = [];
    
    if (account_id) {
      query += ' AND t.account_id = ?';
      params.push(account_id);
    }
    if (symbol) {
      query += ' AND t.symbol = ?';
      params.push(symbol);
    }
    if (status) {
      query += ' AND t.status = ?';
      params.push(status);
    }
    if (from) {
      query += ' AND t.open_time >= ?';
      params.push(from);
    }
    if (to) {
      query += ' AND t.open_time <= ?';
      params.push(to);
    }
    
    query += ' ORDER BY t.open_time DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const trades = db.prepare(query).all(...params);
    res.json(trades);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get trade by ID
app.get('/api/trades/:id', (req, res) => {
  try {
    const trade = db.prepare(`
      SELECT t.*, a.account_number, a.broker 
      FROM trades t 
      JOIN accounts a ON t.account_id = a.id 
      WHERE t.id = ?
    `).get(req.params.id);
    
    if (!trade) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    res.json(trade);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ JOURNAL ENDPOINTS ============

// Get journal entries
app.get('/api/journal', (req, res) => {
  try {
    const { trade_id, account_id, limit = 50, offset = 0 } = req.query;
    
    let query = 'SELECT * FROM journal_entries WHERE 1=1';
    const params = [];
    
    if (trade_id) {
      query += ' AND trade_id = ?';
      params.push(trade_id);
    }
    if (account_id) {
      query += ' AND account_id = ?';
      params.push(account_id);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const entries = db.prepare(query).all(...params);
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create journal entry
app.post('/api/journal', (req, res) => {
  try {
    const { trade_id, account_id, title, content, tags, emotion, rating, lessons_learned, mistakes } = req.body;
    const id = uuidv4();
    
    const stmt = db.prepare(`
      INSERT INTO journal_entries (id, trade_id, account_id, title, content, tags, emotion, rating, lessons_learned, mistakes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(id, trade_id || null, account_id || null, title, content, 
      tags ? JSON.stringify(tags) : null, emotion, rating, lessons_learned, mistakes);
    
    const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id);
    res.status(201).json(entry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update journal entry
app.put('/api/journal/:id', (req, res) => {
  try {
    const { title, content, tags, emotion, rating, lessons_learned, mistakes } = req.body;
    
    db.prepare(`
      UPDATE journal_entries 
      SET title = ?, content = ?, tags = ?, emotion = ?, rating = ?, lessons_learned = ?, mistakes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, content, tags ? JSON.stringify(tags) : null, emotion, rating, lessons_learned, mistakes, req.params.id);
    
    const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.id);
    res.json(entry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete journal entry
app.delete('/api/journal/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM journal_entries WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ANALYTICS ENDPOINTS ============

// Get portfolio statistics
app.get('/api/analytics/portfolio', (req, res) => {
  try {
    const { account_id, from, to } = req.query;
    
    let whereClause = 'WHERE status = ?';
    const params = ['closed'];
    
    if (account_id) {
      whereClause += ' AND account_id = ?';
      params.push(account_id);
    }
    if (from) {
      whereClause += ' AND close_time >= ?';
      params.push(from);
    }
    if (to) {
      whereClause += ' AND close_time <= ?';
      params.push(to);
    }
    
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_trades,
        SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as winning_trades,
        SUM(CASE WHEN profit < 0 THEN 1 ELSE 0 END) as losing_trades,
        SUM(CASE WHEN profit = 0 THEN 1 ELSE 0 END) as breakeven_trades,
        SUM(profit) as total_profit,
        SUM(commission) as total_commission,
        SUM(swap) as total_swap,
        AVG(profit) as avg_profit,
        MAX(profit) as best_trade,
        MIN(profit) as worst_trade,
        SUM(CASE WHEN profit > 0 THEN profit ELSE 0 END) as gross_profit,
        SUM(CASE WHEN profit < 0 THEN profit ELSE 0 END) as gross_loss,
        AVG(CASE WHEN profit > 0 THEN profit ELSE NULL END) as avg_win,
        AVG(CASE WHEN profit < 0 THEN profit ELSE NULL END) as avg_loss
      FROM trades ${whereClause}
    `).get(...params);
    
    // Calculate win rate and profit factor
    stats.win_rate = stats.total_trades > 0 ? (stats.winning_trades / stats.total_trades * 100).toFixed(2) : 0;
    stats.profit_factor = stats.gross_loss !== 0 ? Math.abs(stats.gross_profit / stats.gross_loss).toFixed(2) : 0;
    stats.risk_reward = stats.avg_loss !== 0 ? Math.abs(stats.avg_win / stats.avg_loss).toFixed(2) : 0;
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get performance by symbol
app.get('/api/analytics/by-symbol', (req, res) => {
  try {
    const { account_id } = req.query;
    
    let whereClause = 'WHERE status = ?';
    const params = ['closed'];
    
    if (account_id) {
      whereClause += ' AND account_id = ?';
      params.push(account_id);
    }
    
    const stats = db.prepare(`
      SELECT 
        symbol,
        COUNT(*) as total_trades,
        SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN profit < 0 THEN 1 ELSE 0 END) as losses,
        SUM(profit) as total_profit,
        AVG(profit) as avg_profit
      FROM trades ${whereClause}
      GROUP BY symbol
      ORDER BY total_profit DESC
    `).all(...params);
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get equity curve data
app.get('/api/analytics/equity-curve', (req, res) => {
  try {
    const { account_id } = req.query;
    
    let whereClause = 'WHERE status = ?';
    const params = ['closed'];
    
    if (account_id) {
      whereClause += ' AND account_id = ?';
      params.push(account_id);
    }
    
    const trades = db.prepare(`
      SELECT close_time, profit
      FROM trades ${whereClause}
      ORDER BY close_time ASC
    `).all(...params);
    
    let cumulative = 0;
    const curve = trades.map(t => {
      cumulative += t.profit;
      return {
        date: t.close_time,
        profit: t.profit,
        cumulative
      };
    });
    
    res.json(curve);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get daily performance
app.get('/api/analytics/daily', (req, res) => {
  try {
    const { account_id, days = 30 } = req.query;
    
    let whereClause = 'WHERE status = ?';
    const params = ['closed'];
    
    if (account_id) {
      whereClause += ' AND account_id = ?';
      params.push(account_id);
    }
    
    const stats = db.prepare(`
      SELECT 
        DATE(close_time) as date,
        COUNT(*) as trades,
        SUM(profit) as profit,
        SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN profit < 0 THEN 1 ELSE 0 END) as losses
      FROM trades ${whereClause}
      GROUP BY DATE(close_time)
      ORDER BY date DESC
      LIMIT ?
    `).all(...params, parseInt(days));
    
    res.json(stats.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get unique symbols
app.get('/api/symbols', (req, res) => {
  try {
    const symbols = db.prepare('SELECT DISTINCT symbol FROM trades ORDER BY symbol').all();
    res.json(symbols.map(s => s.symbol));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Catch-all route for SPA in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Trade Analysis API running on port ${PORT}`);
});
