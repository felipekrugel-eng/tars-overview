# FACACHAT — deployment guide

**Status: already deployed.** The Worker is live at
`https://facachat-worker.loyverse-felipe.workers.dev`, the `ANTHROPIC_API_KEY` secret is set on it,
and all six dashboard pages already point at that URL. The only thing left is Step 6 below —
publishing the dashboard files the normal way.

FACACHAT is the "ask a question" box now embedded on every FACADASH page (`daily.html`,
`index.html`, `report.html`, `retention.html`) and every Payments dashboard page
(`activated-payments/index.html`, `activated-payments/report.html`). It lets you type things like
*"TPV growth over the last 6 months"* or *"new registrations in the US, last 6 months"* and get
back a chart, a number, a ranking, or a table — computed entirely from the real numbers already on
the page. The only thing that leaves your browser is your question text plus a schema of what's
queryable (metric names, units, date ranges — never actual figures). That goes to the Cloudflare
Worker, which asks Claude to translate the question into a structured query plan; your browser then
runs that plan against the real data itself.

## Step 6 — Deploy the dashboards as usual (the only remaining step)

Commit and push/deploy the changed HTML files (and the new `facachat-widget.js`,
`facachat-catalog.js`, `facachat-engine.js` files sitting alongside them) exactly the way you
normally publish updates to facadash.pages.dev and activated-payments.pages.dev — nothing about
your existing Cloudflare Pages deploy process changes.

## Step 7 — Try it

Open any dashboard page, click the blue "Ask FACACHAT" button in the bottom-right corner, and try
one of the suggested example questions, or type your own — e.g. "MRR trend this year" or "top 10
countries by active merchants".

If you ask a question from a Payments page that needs POS data (or vice versa), FACACHAT will try
to quietly pull that data from the other dashboard's domain in the background — this only works if
you're already logged into that other dashboard's Cloudflare Access session in the same browser. If
you aren't, FACACHAT will say so plainly rather than fail silently.

## Troubleshooting

**"Origin not allowed" error** — the Worker only accepts requests from
`facadash.pages.dev` and `activated-payments.pages.dev`. If you ever deploy to a different domain
(a custom domain, for example), open `facachat-worker/src/index.js`, find the `ALLOWED_ORIGINS`
array near the top, add your domain there, then redeploy with `npx wrangler deploy` from inside
the `facachat-worker` folder (after `npx wrangler login` or with `CLOUDFLARE_API_TOKEN` set).

**A question about a metric FACACHAT says isn't available** — that's expected and correct behavior
if that data genuinely isn't part of the catalog (e.g. something not tracked in the dashboards).
It's designed to say so rather than guess.

**Checking the Worker is healthy** — visit
`https://facachat-worker.loyverse-felipe.workers.dev/health` in a browser; it should return
`{"ok":true,...}`.

**Watching live requests while testing** — run `npx wrangler tail` in the `facachat-worker` folder
(after logging in) while you use FACACHAT in the browser; it streams each request/response as it
happens.

**If you ever need to rotate the Anthropic API key** — run
`npx wrangler secret put ANTHROPIC_API_KEY` from inside `facachat-worker`, paste the new key when
prompted, then `npx wrangler deploy`.

## Cost

Each question makes one Claude API call (model: `claude-sonnet-5`, capped at 1024 output tokens) —
this is a very small, fast, cheap call since the model only ever outputs a short structured query
plan, never the answer itself. Cloudflare Workers' free tier (100,000 requests/day) comfortably
covers normal usage.

## How it works, in short

Your question and a compact, figure-free schema of the dashboards' metrics go to the Worker. The
Worker asks Claude to pick which metric(s), date range, and transform answer the question, and
Claude replies with a small structured object — never a number, never prose with the answer in it.
Your browser then runs that structured plan against the real data already loaded on the page and
draws the chart/number/table locally. No dashboard figures are ever sent to Anthropic or to the
Worker.
