# Card Tracker

A personal credit-card rewards tracker: pick which cards you own from a built-in
database of ~20 popular US cards, see which one earns the most in each spending
category (dining, groceries, gas, travel, etc.), and pull that data into other
tools via a JSON/CSV API, an outgoing webhook, or an MCP-compatible endpoint.

## Features

- **Browse Cards** — searchable database of cards with their reward categories.
- **My Wallet** — the cards you actually own, with a running total of combined annual fees.
- **Best Card by Category** — auto-computed recommendation per category from your wallet.
- **Password-gated** — simple session-cookie login, nothing public.
- **Data portability**:
  - `GET /api/export?token=API_TOKEN` — JSON of your wallet + recommendations.
  - `GET /api/export?format=csv&token=API_TOKEN` — CSV.
  - `POST /mcp` — simplified MCP-style JSON-RPC endpoint (`Authorization: Bearer API_TOKEN`) exposing tools: `list_my_cards`, `list_all_cards`, `best_card_for_category`, `best_card_by_all_categories`, `add_card_to_wallet`, `remove_card_from_wallet`.
  - Outgoing webhook — set a URL in the Connect tab; the app POSTs your wallet to it on every change.

## Stack

- Static frontend (`public/`) — no framework, vanilla JS.
- Netlify Functions (`netlify/functions/`) — TypeScript, Node runtime.
- Netlify Blobs — stores your wallet + settings (no external DB needed, free tier).

## Required environment variables (set in Netlify site settings)

| Variable | Purpose |
|---|---|
| `SITE_PASSWORD` | Password for the login page. |
| `SESSION_SECRET` | Random string used to sign session cookies. Falls back to `SITE_PASSWORD` if unset, but set your own. |
| `API_TOKEN` | Long random token for `/api/export` and `/mcp` — used by external tools, not the browser login. |

Generate random values with, e.g., `openssl rand -hex 32`.

## Local development

```bash
npm install
npm run dev
```

Requires the [Netlify CLI](https://docs.netlify.com/cli/get-started/) (`netlify link` first to connect Blobs locally).

## Keeping card data current

Reward categories — especially **rotating** ones (Discover it, Chase Freedom Flex,
Citi Custom Cash, Bank of America Customized Cash, U.S. Bank Cash+) — change
quarterly or let you pick your own category. Edit `public/data/cards-db.json`
and redeploy (or push to GitHub, which auto-deploys) whenever they change.
Each card also has an `annualFee` field (0 if there's none) — update it if an
issuer changes their fee. This app is a personal tool, not financial advice —
always confirm current terms with your card issuer.

## Security notes

- The password gate protects the UI and wallet-editing endpoints via an
  HTTP-only, signed session cookie.
- The API/MCP endpoints use a separate long-lived `API_TOKEN` so external
  services (dashboards, automations) don't need your login password and
  can't modify your wallet unless you explicitly build that into your
  integration (the `add_card_to_wallet` / `remove_card_from_wallet` MCP
  tools are token-authorized by design so an AI assistant can manage your
  wallet on your behalf — remove them from `netlify/functions/mcp.mts` if
  you'd rather keep the API read-only).
