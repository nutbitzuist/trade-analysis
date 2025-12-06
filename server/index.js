import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        ticket INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        type TEXT NOT NULL,
        lots REAL NOT NULL,
        open_price REAL NOT NULL,
        close_price REAL,
        stop_loss REAL,
        take_profit REAL,
        open_time TIMESTAMP NOT NULL,
        close_time TIMESTAMP,
        commission REAL DEFAULT 0,
        swap REAL DEFAULT 0,
        profit REAL DEFAULT 0,
        magic_number INTEGER DEFAULT 0,
        comment TEXT,
        status TEXT DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_id, ticket)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        trade_id TEXT REFERENCES trades(id),
        account_id TEXT REFERENCES accounts(id),
        title TEXT,
        content TEXT,
        tags TEXT,
        emotion TEXT,
        rating INTEGER,
        lessons_learned TEXT,
        mistakes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_trades_open_time ON trades(open_time)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_journal_trade ON journal_entries(trade_id)`);
    
    console.log('Database initialized');
  } finally {
    client.release();
  }
}

// CORS configuration
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

app.get('/api/accounts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM accounts ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/accounts', async (req, res) => {
  try {
    const { account_number, broker, name, currency, leverage, server, platform } = req.body;
    const id = uuidv4();
    const api_key = uuidv4().replace(/-/g, '');
    
    const result = await pool.query(
      `INSERT INTO accounts (id, account_number, broker, name, currency, leverage, server, platform, api_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [id, account_number, broker, name, currency || 'USD', leverage, server, platform || 'MT4', api_key]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      res.status(400).json({ error: 'Account number already exists' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM journal_entries WHERE account_id = $1', [id]);
    await pool.query('DELETE FROM trades WHERE account_id = $1', [id]);
    await pool.query('DELETE FROM accounts WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ EA DATA SYNC ENDPOINT ============

app.post('/api/sync', async (req, res) => {
  try {
    const { api_key, account_info, trades } = req.body;
    
    if (!api_key) {
      return res.status(401).json({ error: 'API key required' });
    }
    
    const accountResult = await pool.query('SELECT * FROM accounts WHERE api_key = $1', [api_key]);
    if (accountResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    
    const account = accountResult.rows[0];
    
    if (account_info) {
      await pool.query(
        `UPDATE accounts SET balance = $1, equity = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [account_info.balance || 0, account_info.equity || 0, account.id]
      );
    }
    
    let synced = 0;
    if (trades && Array.isArray(trades)) {
      for (const trade of trades) {
        const existing = await pool.query(
          'SELECT id FROM trades WHERE account_id = $1 AND ticket = $2',
          [account.id, trade.ticket]
        );
        
        if (existing.rows.length > 0) {
          await pool.query(
            `UPDATE trades SET 
              close_price = $1, stop_loss = $2, take_profit = $3, close_time = $4,
              commission = $5, swap = $6, profit = $7, status = $8, updated_at = CURRENT_TIMESTAMP
             WHERE id = $9`,
            [
              trade.close_price || null,
              trade.stop_loss || null,
              trade.take_profit || null,
              trade.close_time || null,
              trade.commission || 0,
              trade.swap || 0,
              trade.profit || 0,
              trade.close_time ? 'closed' : 'open',
              existing.rows[0].id
            ]
          );
        } else {
          const id = uuidv4();
          await pool.query(
            `INSERT INTO trades (id, account_id, ticket, symbol, type, lots, open_price, close_price,
              stop_loss, take_profit, open_time, close_time, commission, swap, profit, magic_number, comment, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
            [
              id, account.id, trade.ticket, trade.symbol, trade.type, trade.lots, trade.open_price,
              trade.close_price || null, trade.stop_loss || null, trade.take_profit || null,
              trade.open_time, trade.close_time || null, trade.commission || 0, trade.swap || 0,
              trade.profit || 0, trade.magic_number || 0, trade.comment || '',
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

app.get('/api/trades', async (req, res) => {
  try {
    const { account_id, symbol, status, from, to, limit = 100, offset = 0 } = req.query;
    
    let query = 'SELECT t.*, a.account_number, a.broker FROM trades t JOIN accounts a ON t.account_id = a.id WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (account_id) {
      query += ` AND t.account_id = $${paramIndex++}`;
      params.push(account_id);
    }
    if (symbol) {
      query += ` AND t.symbol = $${paramIndex++}`;
      params.push(symbol);
    }
    if (status) {
      query += ` AND t.status = $${paramIndex++}`;
      params.push(status);
    }
    if (from) {
      query += ` AND t.open_time >= $${paramIndex++}`;
      params.push(from);
    }
    if (to) {
      query += ` AND t.open_time <= $${paramIndex++}`;
      params.push(to);
    }
    
    query += ` ORDER BY t.open_time DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/trades/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, a.account_number, a.broker FROM trades t JOIN accounts a ON t.account_id = a.id WHERE t.id = $1`,
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ JOURNAL ENDPOINTS ============

app.get('/api/journal', async (req, res) => {
  try {
    const { trade_id, account_id, limit = 50, offset = 0 } = req.query;
    
    let query = 'SELECT * FROM journal_entries WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (trade_id) {
      query += ` AND trade_id = $${paramIndex++}`;
      params.push(trade_id);
    }
    if (account_id) {
      query += ` AND account_id = $${paramIndex++}`;
      params.push(account_id);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/journal', async (req, res) => {
  try {
    const { trade_id, account_id, title, content, tags, emotion, rating, lessons_learned, mistakes } = req.body;
    const id = uuidv4();
    
    const result = await pool.query(
      `INSERT INTO journal_entries (id, trade_id, account_id, title, content, tags, emotion, rating, lessons_learned, mistakes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, trade_id || null, account_id || null, title, content, 
       tags ? JSON.stringify(tags) : null, emotion, rating, lessons_learned, mistakes]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/journal/:id', async (req, res) => {
  try {
    const { title, content, tags, emotion, rating, lessons_learned, mistakes } = req.body;
    
    const result = await pool.query(
      `UPDATE journal_entries 
       SET title = $1, content = $2, tags = $3, emotion = $4, rating = $5, lessons_learned = $6, mistakes = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 RETURNING *`,
      [title, content, tags ? JSON.stringify(tags) : null, emotion, rating, lessons_learned, mistakes, req.params.id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/journal/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM journal_entries WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ANALYTICS ENDPOINTS ============

app.get('/api/analytics/portfolio', async (req, res) => {
  try {
    const { account_id, from, to } = req.query;
    
    let query = `
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
      FROM trades WHERE status = 'closed'
    `;
    const params = [];
    let paramIndex = 1;
    
    if (account_id) {
      query += ` AND account_id = $${paramIndex++}`;
      params.push(account_id);
    }
    if (from) {
      query += ` AND close_time >= $${paramIndex++}`;
      params.push(from);
    }
    if (to) {
      query += ` AND close_time <= $${paramIndex++}`;
      params.push(to);
    }
    
    const result = await pool.query(query, params);
    const stats = result.rows[0] || {};
    
    stats.win_rate = stats.total_trades > 0 ? (stats.winning_trades / stats.total_trades * 100).toFixed(2) : 0;
    stats.profit_factor = stats.gross_loss && stats.gross_loss !== 0 ? Math.abs(stats.gross_profit / stats.gross_loss).toFixed(2) : 0;
    stats.risk_reward = stats.avg_loss && stats.avg_loss !== 0 ? Math.abs(stats.avg_win / stats.avg_loss).toFixed(2) : 0;
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/by-symbol', async (req, res) => {
  try {
    const { account_id } = req.query;
    
    let query = `
      SELECT 
        symbol,
        COUNT(*) as total_trades,
        SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN profit < 0 THEN 1 ELSE 0 END) as losses,
        SUM(profit) as total_profit,
        AVG(profit) as avg_profit
      FROM trades WHERE status = 'closed'
    `;
    const params = [];
    
    if (account_id) {
      query += ' AND account_id = $1';
      params.push(account_id);
    }
    
    query += ' GROUP BY symbol ORDER BY total_profit DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/equity-curve', async (req, res) => {
  try {
    const { account_id } = req.query;
    
    let query = 'SELECT close_time, profit FROM trades WHERE status = $1';
    const params = ['closed'];
    
    if (account_id) {
      query += ' AND account_id = $2';
      params.push(account_id);
    }
    
    query += ' ORDER BY close_time ASC';
    
    const result = await pool.query(query, params);
    
    let cumulative = 0;
    const curve = result.rows.map(t => {
      cumulative += parseFloat(t.profit);
      return {
        date: t.close_time,
        profit: parseFloat(t.profit),
        cumulative
      };
    });
    
    res.json(curve);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/daily', async (req, res) => {
  try {
    const { account_id, days = 30 } = req.query;
    
    let query = `
      SELECT 
        DATE(close_time) as date,
        COUNT(*) as trades,
        SUM(profit) as profit,
        SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN profit < 0 THEN 1 ELSE 0 END) as losses
      FROM trades WHERE status = 'closed'
    `;
    const params = [];
    let paramIndex = 1;
    
    if (account_id) {
      query += ` AND account_id = $${paramIndex++}`;
      params.push(account_id);
    }
    
    query += ` GROUP BY DATE(close_time) ORDER BY date DESC LIMIT $${paramIndex++}`;
    params.push(parseInt(days));
    
    const result = await pool.query(query, params);
    res.json(result.rows.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/symbols', async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT symbol FROM trades ORDER BY symbol');
    res.json(result.rows.map(s => s.symbol));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ADVANCED ANALYTICS ============

app.get('/api/analytics/advanced', async (req, res) => {
  try {
    const { account_id } = req.query;
    
    let query = 'SELECT * FROM trades WHERE status = $1';
    const params = ['closed'];
    
    if (account_id) {
      query += ' AND account_id = $2';
      params.push(account_id);
    }
    
    query += ' ORDER BY close_time ASC';
    
    const result = await pool.query(query, params);
    const trades = result.rows;
    
    if (trades.length === 0) {
      return res.json({ total_trades: 0, message: 'No closed trades to analyze' });
    }
    
    const profits = trades.map(t => parseFloat(t.profit));
    const wins = trades.filter(t => parseFloat(t.profit) > 0);
    const losses = trades.filter(t => parseFloat(t.profit) < 0);
    
    // Consecutive wins/losses
    let maxConsecWins = 0, maxConsecLosses = 0;
    let currentConsecWins = 0, currentConsecLosses = 0;
    
    trades.forEach(t => {
      if (parseFloat(t.profit) > 0) {
        currentConsecWins++;
        currentConsecLosses = 0;
        maxConsecWins = Math.max(maxConsecWins, currentConsecWins);
      } else if (parseFloat(t.profit) < 0) {
        currentConsecLosses++;
        currentConsecWins = 0;
        maxConsecLosses = Math.max(maxConsecLosses, currentConsecLosses);
      }
    });
    
    // Drawdown calculation
    let peak = 0, maxDrawdown = 0, cumulative = 0;
    const drawdownData = [];
    
    trades.forEach(t => {
      cumulative += parseFloat(t.profit);
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      drawdownData.push({
        date: t.close_time,
        cumulative,
        drawdown: peak > 0 ? (drawdown / peak * 100) : 0
      });
    });
    
    // Hourly stats
    const hourlyStats = {};
    trades.forEach(t => {
      if (t.open_time) {
        const hour = new Date(t.open_time).getHours();
        if (!hourlyStats[hour]) hourlyStats[hour] = { trades: 0, profit: 0, wins: 0 };
        hourlyStats[hour].trades++;
        hourlyStats[hour].profit += parseFloat(t.profit);
        if (parseFloat(t.profit) > 0) hourlyStats[hour].wins++;
      }
    });
    
    // Daily stats
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dailyStats = {};
    dayNames.forEach(d => dailyStats[d] = { trades: 0, profit: 0, wins: 0 });
    
    trades.forEach(t => {
      if (t.open_time) {
        const day = dayNames[new Date(t.open_time).getDay()];
        dailyStats[day].trades++;
        dailyStats[day].profit += parseFloat(t.profit);
        if (parseFloat(t.profit) > 0) dailyStats[day].wins++;
      }
    });
    
    // Holding time
    const holdingTimes = trades.map(t => {
      if (t.open_time && t.close_time) {
        return (new Date(t.close_time) - new Date(t.open_time)) / (1000 * 60);
      }
      return 0;
    }).filter(t => t > 0);
    
    const avgHoldingTime = holdingTimes.length > 0 ? holdingTimes.reduce((a, b) => a + b, 0) / holdingTimes.length : 0;
    
    // Short vs Long trades
    const shortTrades = trades.filter(t => {
      if (t.open_time && t.close_time) {
        return (new Date(t.close_time) - new Date(t.open_time)) / (1000 * 60) < 60;
      }
      return false;
    });
    
    const longTrades = trades.filter(t => {
      if (t.open_time && t.close_time) {
        return (new Date(t.close_time) - new Date(t.open_time)) / (1000 * 60) >= 60;
      }
      return false;
    });
    
    // Risk metrics
    const avgReturn = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
    const stdDev = profits.length > 0 
      ? Math.sqrt(profits.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / profits.length)
      : 0;
    const sharpeRatio = stdDev !== 0 ? (avgReturn / stdDev) : 0;
    
    // Lot sizes
    const lotSizes = trades.map(t => parseFloat(t.lots));
    const avgLotSize = lotSizes.reduce((a, b) => a + b, 0) / lotSizes.length;
    
    // Buy vs Sell
    const buyTrades = trades.filter(t => t.type === 'BUY');
    const sellTrades = trades.filter(t => t.type === 'SELL');
    
    const formatDuration = (minutes) => {
      if (minutes < 60) return `${Math.round(minutes)}m`;
      if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
      return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
    };
    
    res.json({
      total_trades: trades.length,
      winning_trades: wins.length,
      losing_trades: losses.length,
      win_rate: ((wins.length / trades.length) * 100).toFixed(2),
      total_profit: profits.reduce((a, b) => a + b, 0),
      gross_profit: wins.reduce((sum, t) => sum + parseFloat(t.profit), 0),
      gross_loss: losses.reduce((sum, t) => sum + parseFloat(t.profit), 0),
      avg_win: wins.length > 0 ? wins.reduce((sum, t) => sum + parseFloat(t.profit), 0) / wins.length : 0,
      avg_loss: losses.length > 0 ? losses.reduce((sum, t) => sum + parseFloat(t.profit), 0) / losses.length : 0,
      largest_win: wins.length > 0 ? Math.max(...wins.map(t => parseFloat(t.profit))) : 0,
      largest_loss: losses.length > 0 ? Math.min(...losses.map(t => parseFloat(t.profit))) : 0,
      profit_factor: losses.reduce((sum, t) => sum + parseFloat(t.profit), 0) !== 0 
        ? Math.abs(wins.reduce((sum, t) => sum + parseFloat(t.profit), 0) / losses.reduce((sum, t) => sum + parseFloat(t.profit), 0))
        : 0,
      max_drawdown: maxDrawdown,
      max_drawdown_pct: peak > 0 ? ((maxDrawdown / peak) * 100).toFixed(2) : 0,
      sharpe_ratio: sharpeRatio.toFixed(2),
      std_deviation: stdDev.toFixed(2),
      max_consecutive_wins: maxConsecWins,
      max_consecutive_losses: maxConsecLosses,
      avg_holding_time_minutes: avgHoldingTime.toFixed(0),
      avg_holding_time_formatted: formatDuration(avgHoldingTime),
      short_trades: {
        count: shortTrades.length,
        profit: shortTrades.reduce((sum, t) => sum + parseFloat(t.profit), 0),
        win_rate: shortTrades.length > 0 ? ((shortTrades.filter(t => parseFloat(t.profit) > 0).length / shortTrades.length) * 100).toFixed(2) : 0
      },
      long_trades: {
        count: longTrades.length,
        profit: longTrades.reduce((sum, t) => sum + parseFloat(t.profit), 0),
        win_rate: longTrades.length > 0 ? ((longTrades.filter(t => parseFloat(t.profit) > 0).length / longTrades.length) * 100).toFixed(2) : 0
      },
      buy_trades: {
        count: buyTrades.length,
        profit: buyTrades.reduce((sum, t) => sum + parseFloat(t.profit), 0),
        win_rate: buyTrades.length > 0 ? ((buyTrades.filter(t => parseFloat(t.profit) > 0).length / buyTrades.length) * 100).toFixed(2) : 0
      },
      sell_trades: {
        count: sellTrades.length,
        profit: sellTrades.reduce((sum, t) => sum + parseFloat(t.profit), 0),
        win_rate: sellTrades.length > 0 ? ((sellTrades.filter(t => parseFloat(t.profit) > 0).length / sellTrades.length) * 100).toFixed(2) : 0
      },
      avg_lot_size: avgLotSize.toFixed(2),
      min_lot_size: Math.min(...lotSizes).toFixed(2),
      max_lot_size: Math.max(...lotSizes).toFixed(2),
      hourly_performance: Object.entries(hourlyStats).map(([hour, data]) => ({
        hour: parseInt(hour),
        ...data,
        win_rate: data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(2) : 0
      })).sort((a, b) => a.hour - b.hour),
      daily_performance: Object.entries(dailyStats).map(([day, data]) => ({
        day,
        ...data,
        win_rate: data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(2) : 0
      })),
      drawdown_curve: drawdownData
    });
  } catch (error) {
    console.error('Advanced analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/monthly', async (req, res) => {
  try {
    const { account_id } = req.query;
    
    let query = `
      SELECT 
        TO_CHAR(close_time, 'YYYY-MM') as month,
        COUNT(*) as trades,
        SUM(profit) as profit,
        SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN profit < 0 THEN 1 ELSE 0 END) as losses
      FROM trades WHERE status = 'closed'
    `;
    const params = [];
    
    if (account_id) {
      query += ' AND account_id = $1';
      params.push(account_id);
    }
    
    query += " GROUP BY TO_CHAR(close_time, 'YYYY-MM') ORDER BY month ASC";
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Catch-all for SPA
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// Start server
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Trade Analysis API running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
