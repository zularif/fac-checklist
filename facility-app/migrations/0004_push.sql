-- Phone (web push) notifications for staff. A staff member turns notifications on from the
-- Vendor work permits page; each phone/browser they enable is one row in push_subscriptions.
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,               -- the push address the phone's browser gave us
  user_id TEXT,                            -- who turned it on
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- One row only: the server's own signing key pair (created automatically the first time it is needed).
CREATE TABLE push_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_jwk TEXT NOT NULL
);
