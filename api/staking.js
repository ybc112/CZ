// Vercel Serverless 代理：转发 /api/staking 到 Cloudflare 隧道后端
// 目标 cz-api.kimi-vault.com 经 Cloudflare Tunnel 直达服务器 127.0.0.1:18090
const UPSTREAM = 'https://cz-api.kimi-vault.com';

export default async function handler(req, res) {
  const url = new URL(req.url, UPSTREAM);
  try {
    const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: 'upstream failed',
      message: String(err?.message || err),
    });
  }
}
