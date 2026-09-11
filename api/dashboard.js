const ALLOWED_TABLES = new Set([
  'members',
  'branches',
  'deposit_accounts',
  'loans',
  'transactions',
  'bank_rates'
]);

function normalizeQuery(raw = 'select=*') {
  const input = new URLSearchParams(raw);
  const output = new URLSearchParams();

  for (const [key, value] of input.entries()) {
    if (key === 'select') {
      if (value !== '*') throw new Error('Unsupported select expression');
      output.set('select', '*');
      continue;
    }

    if (key === 'limit') {
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new Error('Invalid limit');
      }
      output.set('limit', String(limit));
      continue;
    }

    if (key === 'order') {
      if (!/^[A-Za-z_][A-Za-z0-9_]*\.(asc|desc)$/.test(value)) {
        throw new Error('Invalid order expression');
      }
      output.set('order', value);
      continue;
    }

    throw new Error('Unsupported query parameter');
  }

  if (!output.has('select')) output.set('select', '*');
  return output;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const table = Array.isArray(req.query.table) ? req.query.table[0] : req.query.table;
  const rawParams = Array.isArray(req.query.params) ? req.query.params[0] : req.query.params;

  if (!ALLOWED_TABLES.has(table)) {
    return res.status(400).json({ error: 'Invalid table' });
  }

  let query;
  try {
    query = normalizeQuery(rawParams || 'select=*');
  } catch (_) {
    return res.status(400).json({ error: 'Invalid query' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const target = new URL(`/rest/v1/${encodeURIComponent(table)}`, supabaseUrl);
    for (const [key, value] of query.entries()) target.searchParams.set(key, value);

    const upstream = await fetch(target, {
      headers: {
        apikey: publishableKey,
        Prefer: 'count=exact',
        Accept: 'application/json'
      }
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Database request failed' });
    }

    const rows = await upstream.json();
    const contentRange = upstream.headers.get('content-range') || '0/0';
    const total = Number(contentRange.split('/')[1]) || 0;
    return res.status(200).json({ rows, count: total });
  } catch (_) {
    return res.status(502).json({ error: 'Upstream service unavailable' });
  }
};
