// Vercel Serverless 代理：转发 JSON-RPC POST 到 Cloudflare 隧道后端
// 浏览器钱包通过 /api/rpc 访问 BSC 节点
const UPSTREAM = 'https://cz-api.kimi-vault.com/api/rpc';

export default async function handler(req, res) {
  let payload = '{}';
  try {
    if (req.body && typeof req.body === 'object') payload = JSON.stringify(req.body);
    else if (req.body) payload = String(req.body);
  } catch {
    payload = '{}';
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      cache: 'no-store',
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: 'rpc upstream failed',
      message: String(err?.message || err),
    });
  }
}
