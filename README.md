# DMC Export Consolidation System

A web system for DMC Enterprise, which exports Philippine food and grocery
products to customers abroad. Customers ask for quotations, DMC prices them,
customers approve and pay, DMC orders the goods from its suppliers, receives
them into its warehouse, labels them for the destination country, and ships
them in consolidated containers. It also estimates ship dates and forecasts
demand from its own records, and has an order assistant for customers.

Each person signs in with one role, and sees only the pages of that role:
admin, management, sales, procurement, warehouse, or customer.


## What's in this repository

| Folder | What it is |
|---|---|
| `client/` | The web app (React and Vite): every screen. |
| `server/` | The server (Node.js and Express). It creates accounts, emails suppliers their purchase orders and payment proofs, runs the customer assistant and the customer's estimates, and every few minutes it applies payment deadlines, quotation expiry, the waiting-goods deadline of rush shipments, and the prediction alerts. Every 3 hours it fetches the day's exchange rate from the European Central Bank. |
| `db/migrations/` | The database scripts, `001` to `047`, run in number order on Supabase (PostgreSQL). Each one says at the top what it does, is safe to run again, and ends with a check query and the result to expect. |
| `db/demo/` | Tools for a made-up order history, for demos and testing. Everything made up is labelled "simulated" on the screens. |


## What you need

- Node.js 22 (or 20.19 and newer) and npm.
- The team's Supabase project, which already has the database set up (scripts 001 to 047 are run there).
- The keys below, from the team. Never put them in git or anywhere public.


## Keys

Copy `client/.env.example` to `client/.env`, and `server/.env.example` to
`server/.env`, then fill them in.

| File | Name | What it is |
|---|---|---|
| `client/.env` | `VITE_SUPABASE_URL` | The Supabase project's address. |
| `client/.env` | `VITE_SUPABASE_ANON_KEY` | The Supabase project's public (anon) key. |
| `client/.env` | `VITE_SERVER_URL` | The server's address, for example `http://localhost:5000`. |
| `server/.env` | `VITE_SUPABASE_URL` | The same Supabase project address. |
| `server/.env` | `SUPABASE_SERVICE_ROLE_KEY` | The Supabase service key. Secret: only the server uses it, never the client. |
| `server/.env` | `CLIENT_URL` | The web app's address, which may call the server. Default `http://localhost:5173`. |
| `server/.env` | `PORT` | Optional. The server's port. Default `5000`. |
| `server/.env` | `GMAIL_USER`, `GMAIL_APP_PASSWORD` | The Gmail account, and its app password, that emails suppliers. |
| `server/.env` | `GEMINI_API_KEY` | For the customer's order assistant. |
| `server/.env` | `GEMINI_MODEL` | Optional. Which Gemini model the assistant uses. |
| `server/.env` | `PREDICTION_ALERTS` | Optional. `off` stops the staff alerts about late orders and deliveries. |


## Run it

In one terminal, the server:

```
cd server
npm install
npm run dev
```

It runs at http://localhost:5000.

In another terminal, the web app:

```
cd client
npm install
npm run dev
```

Open http://localhost:5173 and sign in. Admin adds staff accounts (Staff), and
admin or sales add customers (Customers).

To build the web app for a server: `npm run build` in `client`, which writes
`client/dist`.


## Money

Customers are charged in US dollars; suppliers are paid in pesos. A product's
price for a customer is the supplier's peso price divided by the day's exchange
rate (pesos per US dollar), plus the country's markup. Container and shipping
costs are DMC's, in pesos, converted at the same rate. The rate is the European Central Bank's, fetched by
the server through the free Frankfurter service (no key needed); nobody types
it. Admin, management and sales are told when it changes, and each quotation
keeps the rate it was priced with.


## The database

The database is the team's Supabase project, with all 47 scripts already run.

To bring another copy up to date, run the scripts in `db/migrations` in number
order in Supabase's SQL editor, and compare each one's last result with what
its header says to expect. A brand-new, empty Supabase project also needs the
base tables those scripts build on, which aren't in this repository yet.

Most rules are enforced by the database itself, not only by the screens: who
can see and change what, prices, credit, payments, stock in the warehouse
slots, and every step's record of who did it and when.


## Made-up history (demo)

None of it comes from DMC's records.

- `node db/demo/generate-simulated-history.mjs` writes `db/demo/simulated_history.sql`
  (not kept in git): 16 months of made-up orders, deliveries, payments and
  labels for 12 made-up customers. Run that file in Supabase's SQL editor to
  load it.
- `db/demo/remove_simulated_history.sql` removes all of it.
- `db/demo/allow_simulated_sign_in.sql` lets the made-up customers sign in,
  with a password you choose.
