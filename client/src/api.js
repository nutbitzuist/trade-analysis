const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }
  
  return response.json();
}

// Accounts
export const getAccounts = () => request('/accounts');
export const createAccount = (data) => request('/accounts', { method: 'POST', body: JSON.stringify(data) });
export const deleteAccount = (id) => request(`/accounts/${id}`, { method: 'DELETE' });

// Trades
export const getTrades = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/trades${query ? `?${query}` : ''}`);
};
export const getTrade = (id) => request(`/trades/${id}`);

// Journal
export const getJournalEntries = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/journal${query ? `?${query}` : ''}`);
};
export const createJournalEntry = (data) => request('/journal', { method: 'POST', body: JSON.stringify(data) });
export const updateJournalEntry = (id, data) => request(`/journal/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteJournalEntry = (id) => request(`/journal/${id}`, { method: 'DELETE' });

// Analytics
export const getPortfolioStats = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/analytics/portfolio${query ? `?${query}` : ''}`);
};
export const getStatsBySymbol = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/analytics/by-symbol${query ? `?${query}` : ''}`);
};
export const getEquityCurve = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/analytics/equity-curve${query ? `?${query}` : ''}`);
};
export const getDailyStats = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/analytics/daily${query ? `?${query}` : ''}`);
};
export const getSymbols = () => request('/symbols');

// Advanced Analytics
export const getAdvancedAnalytics = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/analytics/advanced${query ? `?${query}` : ''}`);
};
export const getMonthlyStats = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/analytics/monthly${query ? `?${query}` : ''}`);
};
export const getTradeAnalysis = (id) => request(`/analytics/trade/${id}`);
