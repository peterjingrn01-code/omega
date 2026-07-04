# ΩPair v3 — Friends System Update

This package contains everything needed to add the friend request system
and post visibility (public / friends-only) to your existing ΩPair app.

## What's inside

```
index.html          ← new frontend, replaces the one on GitHub
worker/index.js      ← new backend, replaces the code in your Cloudflare Worker
worker/schema.sql     ← new database tables to run in D1
```

## Deploy in this order

### 1. Database (D1 Console)

Open Cloudflare → D1 → your `omega` database → **Console**, and run the
contents of `worker/schema.sql`. This only *adds* new tables and a new
column — it does not delete any existing data.

### 2. Backend (Cloudflare Worker)

Open Cloudflare → Workers & Pages → `omegapair-api` → **Edit code**.
Select all the existing code, delete it, and paste in the full contents
of `worker/index.js`. Then click **Deploy**.

### 3. Frontend (GitHub)

- Rename `index.html` in this package if needed (it should already be
  named `index.html`).
- On GitHub, open your repo → **Add file → Upload files** → select this
  `index.html` → confirm you want to replace the existing file →
  **Commit changes**.

GitHub Pages will redeploy automatically after the commit (usually within
a minute or two).

## What's new for users

- A **Friends** button next to Log out, opening a panel to:
  - search for someone by their handle and send a friend request
  - accept or decline incoming requests
  - see your current friends list
- A **Public / Friends** toggle on the post composer — friends-only posts
  are only visible to you and people you're mutually connected with.

## Notes

- Friend requests are matched by exact `handle` (the @name shown under
  each post). If two people happen to have the same handle, requests
  could go to either — this is a known limitation of the current design
  and can be tightened later (e.g. matching by full public key/email
  instead of handle) if it becomes a real problem.
