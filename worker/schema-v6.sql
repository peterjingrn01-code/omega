-- ΩPair schema v6: JOFP (JSL Omega Field Protocol) — direct peer-to-peer
-- file/photo sharing between paired friends.
--
-- IMPORTANT: this table does NOT store any file content. Files stay on the
-- sender's own device (browser IndexedDB) and are transferred directly
-- browser-to-browser over WebRTC when the recipient requests them.
--
-- This table only stores a small "grant" record — a private note saying
-- "X shared something with Y" — and is only ever readable by the
-- recipient (Y) looking at their own inbox. It is not a public directory
-- of who has what; the API enforces that only the addressee can query it.

CREATE TABLE IF NOT EXISTS jofp_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  omega_hash TEXT NOT NULL,          -- SHA-256 of the file, computed client-side
  from_identity_id INTEGER NOT NULL,
  to_identity_id INTEGER NOT NULL,
  file_name TEXT,
  file_type TEXT,
  file_size INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (from_identity_id) REFERENCES identities(id),
  FOREIGN KEY (to_identity_id) REFERENCES identities(id)
);
CREATE INDEX IF NOT EXISTS idx_jofp_grants_to ON jofp_grants (to_identity_id, created_at DESC);
