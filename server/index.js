import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Database setup
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../data/trades.db');
const dbDir = path.dirname(dbPath);

// Ensure data directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize SQL.js
let db;

async function initDatabase() {
  const SQL = await initSqlJs();
  
  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  
  // Create tables
  db.run(`
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
    )
  `);

  db.run(`
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
    )
  `);

  db.run(`
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
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_trades_open_time ON trades(open_time)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_journal_trade ON journal_entries(trade_id)`);
  
  saveDatabase();
  console.log('Database initialized');
}

// Save database to file
function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Helper functions to match better-sqlite3 API
function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function dbGet(sql, params = []) {
  const results = dbAll(sql, params);
  return results[0] || null;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
}

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
    const accounts = dbAll('SELECT * FROM accounts ORDER BY created_at DESC');
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
    
    dbRun(
      `INSERT INTO accounts (id, account_number, broker, name, currency, leverage, server, platform, api_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, account_number, broker, name, currency || 'USD', leverage, server, platform || 'MT4', api_key]
    );
    
    const account = dbGet('SELECT * FROM accounts WHERE id = ?', [id]);
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
    dbRun('DELETE FROM journal_entries WHERE account_id = ?', [id]);
    dbRun('DELETE FROM trades WHERE account_id = ?', [id]);
    dbRun('DELETE FROM accounts WHERE id = ?', [id]);
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
    const account = dbGet('SELECT * FROM accounts WHERE api_key = ?', [api_key]);
    if (!account) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    
    // Update account info
    if (account_info) {
      dbRun(
        `UPDATE accounts SET balance = ?, equity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [account_info.balance || 0, account_info.equity || 0, account.id]
      );
    }
    
    // Upsert trades
    let synced = 0;
    if (trades && Array.isArray(trades)) {
      for (const trade of trades) {
        // Check if trade exists
        const existing = dbGet(
          'SELECT id FROM trades WHERE account_id = ? AND ticket = ?',
          [account.id, trade.ticket]
        );
        
        if (existing) {
          // Update existing trade
          dbRun(
            `UPDATE trades SET 
              close_price = ?, stop_loss = ?, take_profit = ?, close_time = ?,
              commission = ?, swap = ?, profit = ?, status = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
              trade.close_price || null,
              trade.stop_loss || null,
              trade.take_profit || null,
              trade.close_time || null,
              trade.commission || 0,
              trade.swap || 0,
              trade.profit || 0,
              trade.close_time ? 'closed' : 'open',
              existing.id
            ]
          );
        } else {
          // Insert new trade
          const id = uuidv4();
          dbRun(
            `INSERT INTO trades (id, account_id, ticket, symbol, type, lots, open_price, close_price,
              stop_loss, take_profit, open_time, close_time, commission, swap, profit, magic_number, comment, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
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
            ]
          );
        }
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
    
    const trades = dbAll(query, params);
    res.json(trades);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get trade by ID
app.get('/api/trades/:id', (req, res) => {
  try {
    const trade = dbGet(
      `SELECT t.*, a.account_number, a.broker 
       FROM trades t 
       JOIN accounts a ON t.account_id = a.id 
       WHERE t.id = ?`,
      [req.params.id]
    );
    
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
    
    const entries = dbAll(query, params);
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
    
    dbRun(
      `INSERT INTO journal_entries (id, trade_id, account_id, title, content, tags, emotion, rating, lessons_learned, mistakes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, trade_id || null, account_id || null, title, content, 
       tags ? JSON.stringify(tags) : null, emotion, rating, lessons_learned, mistakes]
    );
    
    const entry = dbGet('SELECT * FROM journal_entries WHERE id = ?', [id]);
    res.status(201).json(entry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update journal entry
app.put('/api/journal/:id', (req, res) => {
  try {
    const { title, content, tags, emotion, rating, lessons_learned, mistakes } = req.body;
    
    dbRun(
      `UPDATE journal_entries 
       SET title = ?, content = ?, tags = ?, emotion = ?, rating = ?, lessons_learned = ?, mistakes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [title, content, tags ? JSON.stringify(tags) : null, emotion, rating, lessons_learned, mistakes, req.params.id]
    );
    
    const entry = dbGet('SELECT * FROM journal_entries WHERE id = ?', [req.params.id]);
    res.json(entry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete journal entry
app.delete('/api/journal/:id', (req, res) => {
  try {
    dbRun('DELETE FROM journal_entries WHERE id = ?', [req.params.id]);
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
    
    const stats = dbGet(`
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
    `, params) || {};
    
    // Calculate win rate and profit factor
    stats.win_rate = stats.total_trades > 0 ? (stats.winning_trades / stats.total_trades * 100).toFixed(2) : 0;
    stats.profit_factor = stats.gross_loss !== 0 && stats.gross_loss !== null ? Math.abs(stats.gross_profit / stats.gross_loss).toFixed(2) : 0;
    stats.risk_reward = stats.avg_loss !== 0 && stats.avg_loss !== null ? Math.abs(stats.avg_win / stats.avg_loss).toFixed(2) : 0;
    
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
    
    const stats = dbAll(`
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
    `, params);
    
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
    
    const trades = dbAll(`
      SELECT close_time, profit
      FROM trades ${whereClause}
      ORDER BY close_time ASC
    `, params);
    
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
    
    const stats = dbAll(`
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
    `, [...params, parseInt(days)]);
    
    res.json(stats.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get unique symbols
app.get('/api/symbols', (req, res) => {
  try {
    const symbols = dbAll('SELECT DISTINCT symbol FROM trades ORDER BY symbol');
    res.json(symbols.map(s => s.symbol));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ADVANCED ANALYTICS ENDPOINTS ============

// Get detailed trade analysis
app.get('/api/analytics/advanced', (req, res) => {
  try {
    const { account_id } = req.query;
    
    let whereClause = 'WHERE status = ?';
    const params = ['closed'];
    
    if (account_id) {
      whereClause += ' AND account_id = ?';
      params.push(account_id);
    }
    
    // Get all closed trades for analysis
    const trades = dbAll(`
      SELECT * FROM trades ${whereClause} ORDER BY close_time ASC
    `, params);
    
    if (trades.length === 0) {
      return res.json({
        total_trades: 0,
        message: 'No closed trades to analyze'
      });
    }
    
    // Calculate advanced metrics
    const profits = trades.map(t => t.profit);
    const wins = trades.filter(t => t.profit > 0);
    const losses = trades.filter(t => t.profit < 0);
    
    // Consecutive wins/losses
    let maxConsecWins = 0, maxConsecLosses = 0;
    let currentConsecWins = 0, currentConsecLosses = 0;
    
    trades.forEach(t => {
      if (t.profit > 0) {
        currentConsecWins++;
        currentConsecLosses = 0;
        maxConsecWins = Math.max(maxConsecWins, currentConsecWins);
      } else if (t.profit < 0) {
        currentConsecLosses++;
        currentConsecWins = 0;
        maxConsecLosses = Math.max(maxConsecLosses, currentConsecLosses);
      }
    });
    
    // Drawdown calculation
    let peak = 0, maxDrawdown = 0, cumulative = 0;
    const drawdownData = [];
    
    trades.forEach(t => {
      cumulative += t.profit;
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      drawdownData.push({
        date: t.close_time,
        cumulative,
        drawdown: peak > 0 ? (drawdown / peak * 100) : 0
      });
    });
    
    // Trading by hour analysis
    const hourlyStats = {};
    trades.forEach(t => {
      if (t.open_time) {
        const hour = new Date(t.open_time).getHours();
        if (!hourlyStats[hour]) {
          hourlyStats[hour] = { trades: 0, profit: 0, wins: 0 };
        }
        hourlyStats[hour].trades++;
        hourlyStats[hour].profit += t.profit;
        if (t.profit > 0) hourlyStats[hour].wins++;
      }
    });
    
    // Trading by day of week
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dailyStats = {};
    dayNames.forEach(d => dailyStats[d] = { trades: 0, profit: 0, wins: 0 });
    
    trades.forEach(t => {
      if (t.open_time) {
        const day = dayNames[new Date(t.open_time).getDay()];
        dailyStats[day].trades++;
        dailyStats[day].profit += t.profit;
        if (t.profit > 0) dailyStats[day].wins++;
      }
    });
    
    // Holding time analysis
    const holdingTimes = trades.map(t => {
      if (t.open_time && t.close_time) {
        return (new Date(t.close_time) - new Date(t.open_time)) / (1000 * 60); // minutes
      }
      return 0;
    }).filter(t => t > 0);
    
    const avgHoldingTime = holdingTimes.length > 0 
      ? holdingTimes.reduce((a, b) => a + b, 0) / holdingTimes.length 
      : 0;
    
    // Win/Loss by holding time
    const shortTrades = trades.filter(t => {
      if (t.open_time && t.close_time) {
        const mins = (new Date(t.close_time) - new Date(t.open_time)) / (1000 * 60);
        return mins < 60; // Less than 1 hour
      }
      return false;
    });
    
    const longTrades = trades.filter(t => {
      if (t.open_time && t.close_time) {
        const mins = (new Date(t.close_time) - new Date(t.open_time)) / (1000 * 60);
        return mins >= 60;
      }
      return false;
    });
    
    // Risk metrics
    const returns = [];
    for (let i = 1; i < trades.length; i++) {
      returns.push(trades[i].profit);
    }
    
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 0 
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length)
      : 0;
    
    // Sharpe-like ratio (simplified)
    const sharpeRatio = stdDev !== 0 ? (avgReturn / stdDev) : 0;
    
    // Lot size analysis
    const lotSizes = trades.map(t => t.lots);
    const avgLotSize = lotSizes.reduce((a, b) => a + b, 0) / lotSizes.length;
    
    // Buy vs Sell analysis
    const buyTrades = trades.filter(t => t.type === 'BUY');
    const sellTrades = trades.filter(t => t.type === 'SELL');
    
    const response = {
      // Basic stats
      total_trades: trades.length,
      winning_trades: wins.length,
      losing_trades: losses.length,
      win_rate: ((wins.length / trades.length) * 100).toFixed(2),
      
      // Profit metrics
      total_profit: profits.reduce((a, b) => a + b, 0),
      gross_profit: wins.reduce((sum, t) => sum + t.profit, 0),
      gross_loss: losses.reduce((sum, t) => sum + t.profit, 0),
      avg_win: wins.length > 0 ? wins.reduce((sum, t) => sum + t.profit, 0) / wins.length : 0,
      avg_loss: losses.length > 0 ? losses.reduce((sum, t) => sum + t.profit, 0) / losses.length : 0,
      largest_win: wins.length > 0 ? Math.max(...wins.map(t => t.profit)) : 0,
      largest_loss: losses.length > 0 ? Math.min(...losses.map(t => t.profit)) : 0,
      
      // Risk metrics
      profit_factor: losses.reduce((sum, t) => sum + t.profit, 0) !== 0 
        ? Math.abs(wins.reduce((sum, t) => sum + t.profit, 0) / losses.reduce((sum, t) => sum + t.profit, 0))
        : 0,
      max_drawdown: maxDrawdown,
      max_drawdown_pct: peak > 0 ? ((maxDrawdown / peak) * 100).toFixed(2) : 0,
      sharpe_ratio: sharpeRatio.toFixed(2),
      std_deviation: stdDev.toFixed(2),
      
      // Streak analysis
      max_consecutive_wins: maxConsecWins,
      max_consecutive_losses: maxConsecLosses,
      
      // Time analysis
      avg_holding_time_minutes: avgHoldingTime.toFixed(0),
      avg_holding_time_formatted: formatDuration(avgHoldingTime),
      
      // Short vs Long trades
      short_trades: {
        count: shortTrades.length,
        profit: shortTrades.reduce((sum, t) => sum + t.profit, 0),
        win_rate: shortTrades.length > 0 
          ? ((shortTrades.filter(t => t.profit > 0).length / shortTrades.length) * 100).toFixed(2)
          : 0
      },
      long_trades: {
        count: longTrades.length,
        profit: longTrades.reduce((sum, t) => sum + t.profit, 0),
        win_rate: longTrades.length > 0 
          ? ((longTrades.filter(t => t.profit > 0).length / longTrades.length) * 100).toFixed(2)
          : 0
      },
      
      // Buy vs Sell
      buy_trades: {
        count: buyTrades.length,
        profit: buyTrades.reduce((sum, t) => sum + t.profit, 0),
        win_rate: buyTrades.length > 0 
          ? ((buyTrades.filter(t => t.profit > 0).length / buyTrades.length) * 100).toFixed(2)
          : 0
      },
      sell_trades: {
        count: sellTrades.length,
        profit: sellTrades.reduce((sum, t) => sum + t.profit, 0),
        win_rate: sellTrades.length > 0 
          ? ((sellTrades.filter(t => t.profit > 0).length / sellTrades.length) * 100).toFixed(2)
          : 0
      },
      
      // Position sizing
      avg_lot_size: avgLotSize.toFixed(2),
      min_lot_size: Math.min(...lotSizes).toFixed(2),
      max_lot_size: Math.max(...lotSizes).toFixed(2),
      
      // Hourly performance
      hourly_performance: Object.entries(hourlyStats).map(([hour, data]) => ({
        hour: parseInt(hour),
        ...data,
        win_rate: data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(2) : 0
      })).sort((a, b) => a.hour - b.hour),
      
      // Daily performance
      daily_performance: Object.entries(dailyStats).map(([day, data]) => ({
        day,
        ...data,
        win_rate: data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(2) : 0
      })),
      
      // Drawdown data for chart
      drawdown_curve: drawdownData
    };
    
    res.json(response);
  } catch (error) {
    console.error('Advanced analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to format duration
function formatDuration(minutes) {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}

// Get monthly performance
app.get('/api/analytics/monthly', (req, res) => {
  try {
    const { account_id } = req.query;
    
    let whereClause = 'WHERE status = ?';
    const params = ['closed'];
    
    if (account_id) {
      whereClause += ' AND account_id = ?';
      params.push(account_id);
    }
    
    const stats = dbAll(`
      SELECT 
        strftime('%Y-%m', close_time) as month,
        COUNT(*) as trades,
        SUM(profit) as profit,
        SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN profit < 0 THEN 1 ELSE 0 END) as losses
      FROM trades ${whereClause}
      GROUP BY strftime('%Y-%m', close_time)
      ORDER BY month ASC
    `, params);
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get trade analysis for a specific trade
app.get('/api/analytics/trade/:id', (req, res) => {
  try {
    const trade = dbGet('SELECT * FROM trades WHERE id = ?', [req.params.id]);
    
    if (!trade) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    
    // Get similar trades (same symbol)
    const similarTrades = dbAll(`
      SELECT * FROM trades 
      WHERE symbol = ? AND status = 'closed' AND id != ?
      ORDER BY close_time DESC
      LIMIT 10
    `, [trade.symbol, trade.id]);
    
    // Calculate stats for this symbol
    const symbolStats = dbGet(`
      SELECT 
        COUNT(*) as total_trades,
        SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as wins,
        SUM(profit) as total_profit,
        AVG(profit) as avg_profit
      FROM trades 
      WHERE symbol = ? AND status = 'closed'
    `, [trade.symbol]);
    
    // Holding time
    let holdingTime = null;
    if (trade.open_time && trade.close_time) {
      holdingTime = (new Date(trade.close_time) - new Date(trade.open_time)) / (1000 * 60);
    }
    
    // Risk/Reward if SL/TP were set
    let plannedRR = null;
    if (trade.stop_loss && trade.take_profit && trade.open_price) {
      const risk = Math.abs(trade.open_price - trade.stop_loss);
      const reward = Math.abs(trade.take_profit - trade.open_price);
      plannedRR = risk > 0 ? (reward / risk).toFixed(2) : null;
    }
    
    res.json({
      trade,
      holding_time_minutes: holdingTime,
      holding_time_formatted: holdingTime ? formatDuration(holdingTime) : null,
      planned_risk_reward: plannedRR,
      symbol_stats: symbolStats,
      similar_trades: similarTrades
    });
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

// Start server after database is initialized
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Trade Analysis API running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
