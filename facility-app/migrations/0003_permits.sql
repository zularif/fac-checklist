-- Vendor work permit applications (submitted from /vendor-permit.html, no sign-in needed).
-- The uploaded documents are stored in the FILES store under permits/<ref>/.
CREATE TABLE permits (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'New',      -- New | Reviewing | Approved | Rejected | Closed
  requestor_name TEXT,
  requestor_position TEXT,
  requestor_company TEXT,
  requestor_contact TEXT,
  request_type TEXT,
  title TEXT,
  description TEXT,
  plant TEXT,
  po_number TEXT,
  total_workers INTEGER,
  start_date TEXT,
  target_date TEXT,
  work_category TEXT,
  work_location TEXT,
  permit_types TEXT,                       -- e.g. "GEN, WAH"
  data TEXT,                               -- full application as JSON
  files TEXT,                              -- uploaded documents as JSON
  ip_hash TEXT,                            -- used only to limit spam
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_permits_created ON permits(created_at);
CREATE INDEX idx_permits_ip ON permits(ip_hash, created_at);
