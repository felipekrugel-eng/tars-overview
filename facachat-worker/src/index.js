/* ============================================================================
   FACACHAT WORKER
   ----------------------------------------------------------------------------
   The only server-side piece of FACACHAT. It holds the Anthropic API key and
   does exactly one job: turn a natural-language question, together with the
   compact FACACHAT_CATALOG schema sent up by the browser, into a structured
   QuerySpec (see facachat-engine.js for the exact shape). It never computes a
   number itself and never sees the actual dashboard data — only the schema of
   what's queryable (metric ids, units, date ranges). The browser executes the
   returned QuerySpec locally against the real data already on the page.

   Endpoints:
     GET  /health            -> { ok: true }
     POST /query              body: { question, catalog, history? }
                              -> { ok: true, spec } | { ok: false, error }

   Required secret (see FACACHAT_DEPLOY_GUIDE.md):
     ANTHROPIC_API_KEY
   Optional var:
     ANTHROPIC_MODEL   (defaults to claude-sonnet-5)
   ========================================================================= */

const ALLOWED_ORIGINS = [
  // Real production dashboards (Netlify — this is what facadash.netlify.app and
  // activated-payments.netlify.app actually serve; this is the allowlist that matters):
  'https://facadash.netlify.app',
  'https://master--facadash.netlify.app',
  'https://activated-payments.netlify.app',
  'https://master--activated-payments.netlify.app',
  // Mirror deploys on Cloudflare Pages (also auto-deployed from the same repo):
  'https://facadash.pages.dev',
  'https://activated-payments.pages.dev'
  // Add any custom domains you point at either of these, e.g.:
  // 'https://dash.loyverse.com',
];

const QUERY_SPEC_TOOL = {
  name: 'emit_query_spec',
  description:
    'Emit a structured, validated query plan against the FACACHAT metric catalog. ' +
    'Only ever use metric ids that literally appear in the catalog you were given. ' +
    'Never invent a metric id, a country code, or a number. If the question cannot ' +
    'be answered from the catalog, use kind "unsupported" and explain briefly in notes. ' +
    'If the question is genuinely ambiguous (e.g. could mean two different metrics, or ' +
    'is missing a needed detail), use kind "clarify" with a short question and 2-4 options.',
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['series', 'value', 'ranking', 'table', 'clarify', 'unsupported'] },
      title: { type: 'string', description: 'Short human-readable title for the answer, or the clarifying question text when kind=clarify, or the explanation when kind=unsupported.' },
      grain: { type: 'string', enum: ['month', 'day'], description: 'Prefer month unless the user clearly wants daily detail or a short recent window.' },
      metrics: {
        type: 'array',
        description: 'Up to 6 metric references, required for kind=series/value.',
        items: {
          type: 'object',
          properties: {
            metric: { type: 'string', description: 'A metric id exactly as given in the catalog, e.g. "payments.tpv" or "pos.registrations".' },
            country: { type: 'string', description: 'ISO-2 country code or country name if the user asked to filter/break down by one country. Omit for global totals.' },
            label: { type: 'string', description: 'Optional display label override.' }
          },
          required: ['metric']
        }
      },
      range: {
        type: 'object',
        description: 'Time window. Use "last" for relative phrasing like "last 6 months", "all" for full history, or explicit from/to (YYYY-MM or YYYY-MM-DD).',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          last: { type: 'object', properties: { n: { type: 'number' }, unit: { type: 'string', enum: ['day', 'month', 'year'] } } },
          all: { type: 'boolean' }
        }
      },
      transform: {
        type: 'string',
        enum: ['none', 'cumulative', 'mom_pct', 'yoy_pct', 'index100', 'delta', 'rolling_avg'],
        description: '"none" for a plain growth line, mom_pct/yoy_pct for percentage growth, index100 to compare series on one scale, rolling_avg to smooth a noisy daily series.'
      },
      window: { type: 'number', description: 'Only used with transform=rolling_avg; number of periods to average.' },
      compare: { type: 'string', enum: ['prev_period', 'prev_year'], description: 'Omit unless the user explicitly asks to compare against a prior period or the same period last year.' },
      chart: { type: 'string', enum: ['line', 'bar', 'area', 'stacked_bar', 'none'] },
      agg: { type: 'string', enum: ['auto', 'sum', 'avg', 'last', 'min', 'max'], description: 'Only relevant for kind=value.' },
      ranking: {
        type: 'object',
        description: 'Required for kind=ranking, e.g. "top 10 countries by registrations".',
        properties: {
          extra: { type: 'string', description: 'One of the catalog\'s extras keys, usually "country_snapshot" or "country_alltime" for country rankings.' },
          field: { type: 'string', description: 'Field name to rank by, must exist in that extra\'s fields list.' },
          n: { type: 'number' },
          direction: { type: 'string', enum: ['asc', 'desc'] }
        }
      },
      table: {
        type: 'object',
        description: 'Required for kind=table, e.g. "show me the cohorts table" or "list payments merchants".',
        properties: {
          extra: { type: 'string' },
          fields: { type: 'array', items: { type: 'string' } },
          n: { type: 'number' },
          sortBy: { type: 'string' },
          direction: { type: 'string', enum: ['asc', 'desc'] }
        }
      },
      notes: { type: 'string', description: 'Any caveat worth surfacing to the user, or the unsupported/clarify explanation.' },
      options: { type: 'array', items: { type: 'string' }, description: 'Only used with kind=clarify — 2-4 short options the user can pick from.' }
    },
    required: ['kind']
  }
};

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(obj, headers, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
  });
}

function buildSystemPrompt(catalog) {
  const today = new Date().toISOString().slice(0, 10);
  const metricLines = (catalog.metrics || []).map(function (m) {
    var bits = [m.id, '(' + m.domain + ', ' + m.basis + ', unit=' + m.unit + ')'];
    if (m.unavailable) bits.push('— NOT AVAILABLE: ' + (m.desc || ''));
    else {
      bits.push(m.label);
      if (m.monthRange) bits.push('monthly ' + m.monthRange);
      if (m.dayRange) bits.push('daily ' + m.dayRange);
      if (m.countries) bits.push('countries: ' + m.countries);
      if (m.note) bits.push('NOTE: ' + m.note);
    }
    return '- ' + bits.join(' | ');
  }).join('\n');

  const extrasLines = (catalog.extras || []).join(', ');

  return [
    'You are the query-planning brain behind FACACHAT, an internal analytics assistant for Loyverse.',
    'Today\'s date is ' + today + '. Data freshness: ' + JSON.stringify(catalog.freshness || {}) + '.',
    '',
    'You NEVER answer with numbers or prose directly. You ONLY call the emit_query_spec tool exactly once per turn.',
    'A separate deterministic engine executes your spec against the real data — you are just choosing which',
    'series, country, date range, and transform answers the question. If you name a metric that isn\'t in the',
    'catalog below, the answer will fail, so only use ids that appear verbatim in this list.',
    '',
    'AVAILABLE METRICS:',
    metricLines,
    '',
    'AVAILABLE EXTRAS (non-time-series lookups, used with kind=ranking or kind=table): ' + extrasLines,
    '',
    'Guidance:',
    '- "growth of X" / "X over time" / "X trend" -> kind=series, chart=line, transform=none (unless the user asks for % growth, then mom_pct or yoy_pct).',
    '- "how many X" / "what is X" for a single figure -> kind=value.',
    '- "top N countries/merchants by X" -> kind=ranking using the right extra.',
    '- "show me the table of X" / "list X" -> kind=table.',
    '- "last N months/days" -> range.last = {n, unit}. "this year" -> range.from = "YYYY-01".',
    '- If a metric is marked NOT AVAILABLE, use kind=unsupported and explain why, pointing to the suggested alternative if one is mentioned.',
    '- If the country given doesn\'t clearly map to a code, or the question could mean two different metrics, use kind=clarify with 2-4 short options.',
    '- Prefer grain=month unless the user asks for daily detail or a very short recent window (e.g. "last 14 days").',
    '- Keep title short and human (e.g. "TPV — last 6 months").'
  ].join('\n');
}

async function interpret(question, catalog, history, env) {
  const system = buildSystemPrompt(catalog);
  const messages = (history || []).slice(-6).filter(function (h) {
    return h && typeof h.content === 'string' && (h.role === 'user' || h.role === 'assistant');
  }).map(function (h) { return { role: h.role, content: h.content }; });
  messages.push({ role: 'user', content: question });

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      max_tokens: 1024,
      system: system,
      messages: messages,
      tools: [QUERY_SPEC_TOOL],
      tool_choice: { type: 'tool', name: 'emit_query_spec' }
    })
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error('Anthropic API error ' + resp.status + ': ' + t.slice(0, 400));
  }
  const data = await resp.json();
  const toolUse = (data.content || []).find(function (c) { return c.type === 'tool_use'; });
  if (!toolUse) throw new Error('The model did not return a structured query.');
  return toolUse.input;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (url.pathname === '/health') {
      return json({ ok: true, service: 'facachat-worker', time: new Date().toISOString() }, cors);
    }
    if (url.pathname !== '/query' || request.method !== 'POST') {
      return json({ ok: false, error: 'Not found. POST a question to /query.' }, cors, 404);
    }
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return json({ ok: false, error: 'Origin not allowed.' }, cors, 403);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ ok: false, error: 'Worker is missing the ANTHROPIC_API_KEY secret. See FACACHAT_DEPLOY_GUIDE.md.' }, cors, 500);
    }

    let body;
    try { body = await request.json(); } catch (e) {
      return json({ ok: false, error: 'Invalid JSON body.' }, cors, 400);
    }
    const question = body && body.question;
    const catalog = body && body.catalog;
    if (!question || typeof question !== 'string' || !question.trim()) {
      return json({ ok: false, error: 'Missing "question".' }, cors, 400);
    }
    if (question.length > 600) {
      return json({ ok: false, error: 'Question is too long.' }, cors, 400);
    }
    if (!catalog || !Array.isArray(catalog.metrics)) {
      return json({ ok: false, error: 'Missing or invalid "catalog".' }, cors, 400);
    }

    try {
      const spec = await interpret(question.trim(), catalog, body.history, env);
      return json({ ok: true, spec: spec }, cors);
    } catch (err) {
      return json({ ok: false, error: String(err && err.message ? err.message : err) }, cors, 502);
    }
  }
};
