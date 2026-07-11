# ΩPair — OmegaPair Token (OPT) Ledger

Adds a genesis-minted token with a tamper-evident hash-chain ledger.

## What's inside

```
index.html        ← new frontend, replaces the one on GitHub
worker-index.js    ← new backend, replaces the code in your Cloudflare Worker
schema-v4.sql       ← new database columns/tables to run in D1 (run each statement separately if paste is troublesome — see below)
```

## Deploy in this order

### 1. Database (D1 Console)

Run each of these one at a time in the D1 Console (Console tab → paste one
statement → Execute → repeat):

```sql
ALTER TABLE identities ADD COLUMN profile_email TEXT;
```
```sql
ALTER TABLE identities ADD COLUMN profile_phone TEXT;
```
```sql
ALTER TABLE identities ADD COLUMN pair_hash TEXT;
```
```sql
CREATE TABLE IF NOT EXISTS balances (
  identity_id INTEGER PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (identity_id) REFERENCES identities(id)
);
```
```sql
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq INTEGER NOT NULL,
  prev_hash TEXT,
  entry_hash TEXT NOT NULL,
  from_identity_id INTEGER,
  to_identity_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  memo TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (from_identity_id) REFERENCES identities(id),
  FOREIGN KEY (to_identity_id) REFERENCES identities(id)
);
```
```sql
CREATE INDEX IF NOT EXISTS idx_ledger_seq ON ledger (seq);
```
```sql
CREATE INDEX IF NOT EXISTS idx_ledger_to ON ledger (to_identity_id);
```
```sql
CREATE INDEX IF NOT EXISTS idx_ledger_from ON ledger (from_identity_id);
```

### 2. Backend (Cloudflare Worker)

Workers & Pages → `omegapair-api` → **Edit code** → select all, delete,
paste in the full contents of `worker-index.js` → **Deploy**.

### 3. Frontend (GitHub)

Rename `index.html` if needed, then on GitHub: **Add file → Upload
files** → select it → confirm replacing the existing file → **Commit
changes**.

## How it works

- **Proof of pair (Ω₀)**: in the Wallet panel, enter an email + phone
  number. The phone number is NOT verified by SMS — it's only used as
  an input to the hash. This computes `Ω₀ = SHA-256(username|email|phone)`
  and stores it against your identity.
- **Genesis**: whoever clicks "Run Genesis" first becomes the treasury
  account and receives all 1,000,000,000 OPT. This can only happen once —
  if you click it again (or someone else does), it will be rejected.
- **Distribute**: only the treasury account sees this option. Enter a
  recipient's handle and an amount to send them OPT.
- **Ledger / hash chain**: every transaction (including genesis) is
  recorded as an entry that includes the hash of the previous entry.
  This means the entries form a chain — if any past entry were altered,
  every hash after it would stop matching, making tampering detectable.
  This is standard, well-understood technology (the same principle
  blockchains use to link blocks together), not dependent on any
  unproven math.
- **History**: each user can see their own send/receive history in the
  Wallet panel.

## Honest limitations, so nothing here is oversold

- This is an **internal ledger inside your own database** — not a public
  blockchain, not decentralized, and not verifiable by anyone outside
  your Cloudflare account. Anyone with database access (i.e., you) could
  technically edit past rows directly in D1; the hash chain would then
  fail to verify if someone checked it, but nothing currently
  *automatically* checks and alerts on that. A "verify chain integrity"
  endpoint could be added later if that matters to you.
- There's no peer-to-peer transfer between regular users yet — only the
  treasury account can send. Let me know if/when you want that added.
- Phone numbers are not verified. Anyone can type any phone number when
  setting up their "proof of pair." If you want that to mean something
  cryptographically, real SMS verification would need to be added later.
