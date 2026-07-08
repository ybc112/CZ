const DEFAULT_RPC_URLS = [
  'https://bsc.publicnode.com',
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.binance.org/',
  'https://bsc-dataseed2.binance.org/',
  'https://bsc.blockpi.network/v1/rpc/public',
  'https://rpc.ankr.com/bsc',
];

const CACHE_TTL_MS = Number(process.env.RPC_CACHE_TTL_MS || 5000);
const WRITE_METHODS = new Set(['eth_sendRawTransaction', 'eth_sendTransaction']);

const cacheStore = globalThis.__czRpcProxyCache || {
  responses: new Map(),
};
globalThis.__czRpcProxyCache = cacheStore;

const rpcUrls = () => {
  const configured = process.env.BSC_RPC_URLS || process.env.RPC_URLS || '';
  const urls = configured
    ? configured.split(',').map((url) => url.trim()).filter(Boolean)
    : DEFAULT_RPC_URLS;
  return [...new Set(urls)];
};

const parseBody = (req) => {
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return req.body;
};

const fetchWithTimeout = async (url, body) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.RPC_TIMEOUT_MS || 8000));
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`RPC HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const methodNames = (payload) => {
  if (Array.isArray(payload)) return payload.map((item) => item?.method).filter(Boolean);
  return payload?.method ? [payload.method] : [];
};

const isWritePayload = (payload) => methodNames(payload).some((method) => WRITE_METHODS.has(method));

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let payload;
  try {
    payload = parseBody(req);
  } catch {
    res.status(400).json({ error: 'Invalid JSON-RPC body' });
    return;
  }

  if (!payload || methodNames(payload).length === 0) {
    res.status(400).json({ error: 'Invalid JSON-RPC payload' });
    return;
  }

  const canCache = !isWritePayload(payload);
  const key = canCache ? JSON.stringify(payload) : '';
  const now = Date.now();
  const cached = canCache ? cacheStore.responses.get(key) : null;
  if (cached && now - cached.timestamp <= CACHE_TTL_MS) {
    res.setHeader('X-CZ-RPC-Cache', 'hit');
    res.status(200).json(cached.data);
    return;
  }

  let lastError = null;
  for (const url of rpcUrls()) {
    try {
      const data = await fetchWithTimeout(url, payload);
      if (canCache && !data?.error) {
        cacheStore.responses.set(key, { timestamp: now, data });
      }
      res.setHeader('X-CZ-RPC-Url', url);
      res.status(200).json(data);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`rpc proxy failed: ${url}`, error?.message || error);
    }
  }

  if (cached) {
    res.setHeader('X-CZ-RPC-Cache', 'stale');
    res.status(200).json(cached.data);
    return;
  }

  res.status(502).json({
    error: 'All BSC RPC nodes failed',
    message: lastError?.message || String(lastError),
  });
};
