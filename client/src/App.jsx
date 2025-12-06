import { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  LineChart, 
  BookOpen, 
  Settings, 
  Plus,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Award,
  AlertCircle,
  X,
  Copy,
  Trash2,
  ChevronDown,
  Calendar,
  Filter
} from 'lucide-react';
import { 
  LineChart as RechartsLine, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { format } from 'date-fns';
import * as api from './api';

// Sidebar Navigation
function Sidebar({ activeTab, setActiveTab }) {
  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'trades', label: 'Trades', icon: LineChart },
    { id: 'journal', label: 'Journal', icon: BookOpen },
    { id: 'accounts', label: 'Accounts', icon: Settings },
  ];

  return (
    <div className="w-64 bg-slate-900 text-white min-h-screen p-4">
      <div className="mb-8">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-emerald-400" />
          Trade Analyzer
        </h1>
        <p className="text-slate-400 text-sm mt-1">MT4 Journal & Analytics</p>
      </div>
      
      <nav className="space-y-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              activeTab === tab.id 
                ? 'bg-emerald-600 text-white' 
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <tab.icon className="w-5 h-5" />
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// Stat Card Component
function StatCard({ title, value, subtitle, icon: Icon, trend, color = 'emerald' }) {
  const colorClasses = {
    emerald: 'bg-emerald-50 text-emerald-600',
    red: 'bg-red-50 text-red-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
  };

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-slate-500 text-sm font-medium">{title}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {subtitle && <p className="text-slate-400 text-sm mt-1">{subtitle}</p>}
        </div>
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
      {trend !== undefined && (
        <div className={`flex items-center gap-1 mt-3 text-sm ${trend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {trend >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          {Math.abs(trend).toFixed(2)}%
        </div>
      )}
    </div>
  );
}

// Dashboard Component
function Dashboard({ accounts }) {
  const [stats, setStats] = useState(null);
  const [equityCurve, setEquityCurve] = useState([]);
  const [symbolStats, setSymbolStats] = useState([]);
  const [dailyStats, setDailyStats] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');

  useEffect(() => {
    loadData();
  }, [selectedAccount]);

  const loadData = async () => {
    try {
      const params = selectedAccount ? { account_id: selectedAccount } : {};
      const [portfolioData, curveData, symbolData, dailyData] = await Promise.all([
        api.getPortfolioStats(params),
        api.getEquityCurve(params),
        api.getStatsBySymbol(params),
        api.getDailyStats(params),
      ]);
      setStats(portfolioData);
      setEquityCurve(curveData);
      setSymbolStats(symbolData);
      setDailyStats(dailyData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    }
  };

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">Dashboard</h2>
        <select
          value={selectedAccount}
          onChange={(e) => setSelectedAccount(e.target.value)}
          className="px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="">All Accounts</option>
          {accounts.map(acc => (
            <option key={acc.id} value={acc.id}>{acc.name || acc.account_number}</option>
          ))}
        </select>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Profit"
          value={`$${(stats?.total_profit || 0).toFixed(2)}`}
          subtitle={`${stats?.total_trades || 0} trades`}
          icon={DollarSign}
          color={stats?.total_profit >= 0 ? 'emerald' : 'red'}
        />
        <StatCard
          title="Win Rate"
          value={`${stats?.win_rate || 0}%`}
          subtitle={`${stats?.winning_trades || 0}W / ${stats?.losing_trades || 0}L`}
          icon={Target}
          color="blue"
        />
        <StatCard
          title="Profit Factor"
          value={stats?.profit_factor || '0.00'}
          subtitle="Gross profit / Gross loss"
          icon={Award}
          color="amber"
        />
        <StatCard
          title="Avg Trade"
          value={`$${(stats?.avg_profit || 0).toFixed(2)}`}
          subtitle={`Best: $${(stats?.best_trade || 0).toFixed(2)}`}
          icon={LineChart}
          color="emerald"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Equity Curve */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold mb-4">Equity Curve</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsLine data={equityCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(val) => val ? format(new Date(val), 'MM/dd') : ''}
                  stroke="#94a3b8"
                />
                <YAxis stroke="#94a3b8" />
                <Tooltip 
                  formatter={(value) => [`$${value.toFixed(2)}`, 'Cumulative P/L']}
                  labelFormatter={(label) => label ? format(new Date(label), 'MMM dd, yyyy') : ''}
                />
                <Line 
                  type="monotone" 
                  dataKey="cumulative" 
                  stroke="#10b981" 
                  strokeWidth={2}
                  dot={false}
                />
              </RechartsLine>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Daily Performance */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold mb-4">Daily Performance</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyStats}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(val) => val ? format(new Date(val), 'MM/dd') : ''}
                  stroke="#94a3b8"
                />
                <YAxis stroke="#94a3b8" />
                <Tooltip 
                  formatter={(value) => [`$${value.toFixed(2)}`, 'Profit']}
                  labelFormatter={(label) => label ? format(new Date(label), 'MMM dd, yyyy') : ''}
                />
                <Bar 
                  dataKey="profit" 
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Symbol Performance */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <h3 className="text-lg font-semibold mb-4">Performance by Symbol</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={symbolStats.filter(s => s.total_profit > 0)}
                  dataKey="total_trades"
                  nameKey="symbol"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ symbol }) => symbol}
                >
                  {symbolStats.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2 overflow-auto max-h-64">
            {symbolStats.map((symbol, index) => (
              <div key={symbol.symbol} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="font-medium">{symbol.symbol}</span>
                </div>
                <div className="text-right">
                  <p className={`font-semibold ${symbol.total_profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    ${symbol.total_profit.toFixed(2)}
                  </p>
                  <p className="text-sm text-slate-500">
                    {symbol.wins}W / {symbol.losses}L ({symbol.total_trades} trades)
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Trades Component
function Trades({ accounts }) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    account_id: '',
    status: '',
    symbol: '',
  });
  const [symbols, setSymbols] = useState([]);

  useEffect(() => {
    loadTrades();
    loadSymbols();
  }, [filters]);

  const loadTrades = async () => {
    try {
      setLoading(true);
      const data = await api.getTrades(filters);
      setTrades(data);
    } catch (error) {
      console.error('Failed to load trades:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSymbols = async () => {
    try {
      const data = await api.getSymbols();
      setSymbols(data);
    } catch (error) {
      console.error('Failed to load symbols:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">Trade History</h2>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-500">Filters:</span>
          </div>
          <select
            value={filters.account_id}
            onChange={(e) => setFilters({ ...filters, account_id: e.target.value })}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">All Accounts</option>
            {accounts.map(acc => (
              <option key={acc.id} value={acc.id}>{acc.name || acc.account_number}</option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">All Status</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
          <select
            value={filters.symbol}
            onChange={(e) => setFilters({ ...filters, symbol: e.target.value })}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">All Symbols</option>
            {symbols.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Trades Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">Ticket</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">Symbol</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">Type</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">Lots</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">Open Price</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">Close Price</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">Open Time</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">Profit</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="9" className="px-6 py-8 text-center text-slate-500">Loading...</td>
                </tr>
              ) : trades.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-6 py-8 text-center text-slate-500">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    No trades found. Connect your MT4 account to start syncing trades.
                  </td>
                </tr>
              ) : (
                trades.map(trade => (
                  <tr key={trade.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 text-sm font-medium">{trade.ticket}</td>
                    <td className="px-6 py-4 text-sm font-semibold">{trade.symbol}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        trade.type === 'BUY' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {trade.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">{trade.lots}</td>
                    <td className="px-6 py-4 text-sm">{trade.open_price}</td>
                    <td className="px-6 py-4 text-sm">{trade.close_price || '-'}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {trade.open_time ? format(new Date(trade.open_time), 'MMM dd, HH:mm') : '-'}
                    </td>
                    <td className={`px-6 py-4 text-sm font-semibold ${
                      trade.profit >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      ${trade.profit.toFixed(2)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        trade.status === 'open' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {trade.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Journal Component
function Journal({ accounts }) {
  const [entries, setEntries] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    emotion: '',
    rating: 3,
    lessons_learned: '',
    mistakes: '',
    account_id: '',
  });

  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = async () => {
    try {
      const data = await api.getJournalEntries();
      setEntries(data);
    } catch (error) {
      console.error('Failed to load journal entries:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingEntry) {
        await api.updateJournalEntry(editingEntry.id, formData);
      } else {
        await api.createJournalEntry(formData);
      }
      setShowForm(false);
      setEditingEntry(null);
      setFormData({ title: '', content: '', emotion: '', rating: 3, lessons_learned: '', mistakes: '', account_id: '' });
      loadEntries();
    } catch (error) {
      console.error('Failed to save journal entry:', error);
    }
  };

  const handleDelete = async (id) => {
    if (confirm('Are you sure you want to delete this entry?')) {
      try {
        await api.deleteJournalEntry(id);
        loadEntries();
      } catch (error) {
        console.error('Failed to delete journal entry:', error);
      }
    }
  };

  const emotions = ['Confident', 'Calm', 'Anxious', 'Fearful', 'Greedy', 'Frustrated', 'Excited', 'Neutral'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">Trading Journal</h2>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Entry
        </button>
      </div>

      {/* Journal Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="text-lg font-semibold">{editingEntry ? 'Edit Entry' : 'New Journal Entry'}</h3>
              <button onClick={() => { setShowForm(false); setEditingEntry(null); }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="e.g., EURUSD Trade Analysis"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Content</label>
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 h-32"
                  placeholder="Describe your trade setup, reasoning, and outcome..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Emotion</label>
                  <select
                    value={formData.emotion}
                    onChange={(e) => setFormData({ ...formData, emotion: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Select emotion</option>
                    {emotions.map(e => (
                      <option key={e} value={e}>{e}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Rating (1-5)</label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={formData.rating}
                    onChange={(e) => setFormData({ ...formData, rating: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Lessons Learned</label>
                <textarea
                  value={formData.lessons_learned}
                  onChange={(e) => setFormData({ ...formData, lessons_learned: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 h-24"
                  placeholder="What did you learn from this trade?"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Mistakes</label>
                <textarea
                  value={formData.mistakes}
                  onChange={(e) => setFormData({ ...formData, mistakes: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 h-24"
                  placeholder="What mistakes did you make?"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setEditingEntry(null); }}
                  className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                >
                  {editingEntry ? 'Update' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Journal Entries */}
      <div className="space-y-4">
        {entries.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center shadow-sm border border-slate-100">
            <BookOpen className="w-12 h-12 mx-auto mb-4 text-slate-300" />
            <p className="text-slate-500">No journal entries yet. Start documenting your trades!</p>
          </div>
        ) : (
          entries.map(entry => (
            <div key={entry.id} className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">{entry.title}</h3>
                  <p className="text-sm text-slate-500">
                    {entry.created_at ? format(new Date(entry.created_at), 'MMM dd, yyyy HH:mm') : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {entry.emotion && (
                    <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                      {entry.emotion}
                    </span>
                  )}
                  {entry.rating && (
                    <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm">
                      {entry.rating}/5
                    </span>
                  )}
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="p-2 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {entry.content && <p className="text-slate-600 mb-4">{entry.content}</p>}
              {entry.lessons_learned && (
                <div className="bg-emerald-50 rounded-lg p-4 mb-3">
                  <p className="text-sm font-medium text-emerald-800 mb-1">Lessons Learned</p>
                  <p className="text-sm text-emerald-700">{entry.lessons_learned}</p>
                </div>
              )}
              {entry.mistakes && (
                <div className="bg-red-50 rounded-lg p-4">
                  <p className="text-sm font-medium text-red-800 mb-1">Mistakes</p>
                  <p className="text-sm text-red-700">{entry.mistakes}</p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Accounts Component
function Accounts({ accounts, onAccountsChange }) {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    account_number: '',
    broker: '',
    name: '',
    currency: 'USD',
    leverage: '',
    server: '',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.createAccount(formData);
      setShowForm(false);
      setFormData({ account_number: '', broker: '', name: '', currency: 'USD', leverage: '', server: '' });
      onAccountsChange();
    } catch (error) {
      alert(error.message);
    }
  };

  const handleDelete = async (id) => {
    if (confirm('Are you sure? This will delete all trades and journal entries for this account.')) {
      try {
        await api.deleteAccount(id);
        onAccountsChange();
      } catch (error) {
        alert(error.message);
      }
    }
  };

  const copyApiKey = (key) => {
    navigator.clipboard.writeText(key);
    alert('API key copied to clipboard!');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">MT4 Accounts</h2>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Account
        </button>
      </div>

      {/* Add Account Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="text-lg font-semibold">Add MT4 Account</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Account Number *</label>
                <input
                  type="text"
                  value={formData.account_number}
                  onChange={(e) => setFormData({ ...formData, account_number: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Account Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="e.g., Main Trading Account"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Broker</label>
                <input
                  type="text"
                  value={formData.broker}
                  onChange={(e) => setFormData({ ...formData, broker: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="e.g., IC Markets"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Currency</label>
                  <select
                    value={formData.currency}
                    onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="JPY">JPY</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Leverage</label>
                  <input
                    type="text"
                    value={formData.leverage}
                    onChange={(e) => setFormData({ ...formData, leverage: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="e.g., 1:100"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Server</label>
                <input
                  type="text"
                  value={formData.server}
                  onChange={(e) => setFormData({ ...formData, server: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="e.g., ICMarkets-Demo"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                >
                  Add Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Accounts List */}
      <div className="space-y-4">
        {accounts.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center shadow-sm border border-slate-100">
            <Settings className="w-12 h-12 mx-auto mb-4 text-slate-300" />
            <p className="text-slate-500 mb-4">No accounts added yet. Add your MT4 account to get started.</p>
          </div>
        ) : (
          accounts.map(account => (
            <div key={account.id} className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">{account.name || `Account ${account.account_number}`}</h3>
                  <p className="text-sm text-slate-500">{account.broker || 'Unknown Broker'} • {account.server || 'Unknown Server'}</p>
                </div>
                <button
                  onClick={() => handleDelete(account.id)}
                  className="p-2 text-slate-400 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <p className="text-sm text-slate-500">Account Number</p>
                  <p className="font-medium">{account.account_number}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Balance</p>
                  <p className="font-medium">${(account.balance || 0).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Equity</p>
                  <p className="font-medium">${(account.equity || 0).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Leverage</p>
                  <p className="font-medium">{account.leverage || 'N/A'}</p>
                </div>
              </div>

              <div className="bg-slate-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-700">API Key (for MT4 EA)</p>
                    <p className="text-xs text-slate-500 mt-1 font-mono">{account.api_key}</p>
                  </div>
                  <button
                    onClick={() => copyApiKey(account.api_key)}
                    className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 text-sm"
                  >
                    <Copy className="w-4 h-4" />
                    Copy
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* EA Setup Instructions */}
      <div className="bg-blue-50 rounded-xl p-6 border border-blue-100">
        <h3 className="text-lg font-semibold text-blue-800 mb-3">MT4 Expert Advisor Setup</h3>
        <ol className="list-decimal list-inside space-y-2 text-blue-700 text-sm">
          <li>Download the <code className="bg-blue-100 px-1 rounded">TradeSync.mq4</code> file from the MT4_EA folder</li>
          <li>Copy it to your MT4 <code className="bg-blue-100 px-1 rounded">Experts</code> folder</li>
          <li>Compile the EA in MetaEditor</li>
          <li>Attach the EA to any chart</li>
          <li>Enter your API key and server URL in the EA settings</li>
          <li>Enable "Allow WebRequest" in MT4 Tools → Options → Expert Advisors</li>
          <li>Add your server URL to the allowed URLs list</li>
        </ol>
      </div>
    </div>
  );
}

// Main App
function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const data = await api.getAccounts();
      setAccounts(data);
    } catch (error) {
      console.error('Failed to load accounts:', error);
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard accounts={accounts} />;
      case 'trades':
        return <Trades accounts={accounts} />;
      case 'journal':
        return <Journal accounts={accounts} />;
      case 'accounts':
        return <Accounts accounts={accounts} onAccountsChange={loadAccounts} />;
      default:
        return <Dashboard accounts={accounts} />;
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 p-8">
        {renderContent()}
      </main>
    </div>
  );
}

export default App;
