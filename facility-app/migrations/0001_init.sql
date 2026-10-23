-- ============================================================
-- Facility Maintenance App — Cloudflare D1 (SQLite) schema
-- Consolidates the former Supabase scripts:
--   schema.sql, admin_schema_additions.sql, pin_login_setup.sql,
--   security_hardening.sql, fe_module_schema.sql, fe_add_*.sql,
--   tasks_module.sql, backdate_audit.sql, 20260907_reliable_inspections.sql
--
-- Applied with:  npx wrangler d1 migrations apply facility-db --remote
--
-- Conventions (the Worker relies on these):
--   * ids are TEXT UUIDs (generated here or by the Worker)
--   * timestamps are TEXT ISO-8601 UTC: 2026-10-23T04:05:06.789Z
--   * dates are TEXT YYYY-MM-DD
--   * booleans are INTEGER 0/1 (the API converts to true/false)
--   * JSON columns are TEXT holding JSON (the API parses them)
-- Row-level security from Supabase is enforced by the Worker
-- (worker/schema.js) instead of database policies.
-- ============================================================

-- ---------- master data ----------
CREATE TABLE plants (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  plant_id TEXT UNIQUE NOT NULL,
  plant_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active'
);

CREATE TABLE areas (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  area_id TEXT UNIQUE NOT NULL,
  area_name TEXT NOT NULL,
  plant_id TEXT NOT NULL REFERENCES plants(id),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'Active'
);
CREATE INDEX idx_areas_plant ON areas(plant_id);

CREATE TABLE equipment (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  equip_id TEXT UNIQUE NOT NULL,
  equipment_name TEXT NOT NULL,
  area_id TEXT NOT NULL REFERENCES areas(id),
  qr_code TEXT UNIQUE NOT NULL,
  asset_tag TEXT,
  inspection_cycle TEXT NOT NULL DEFAULT 'Daily',
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  document_links TEXT NOT NULL DEFAULT '[]',
  next_maintenance_date TEXT
);
CREATE INDEX idx_equipment_area ON equipment(area_id);

-- Login accounts (replaces Supabase auth.users).
-- Technicians sign in with a PIN (technicians.pin_hash); email/password is
-- optional and only used for accounts given a password_hash.
CREATE TABLE auth_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_sign_in_at TEXT
);

CREATE TABLE technicians (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  tech_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Tech',          -- Admin | Supervisor | Tech
  auth_uid TEXT UNIQUE,                       -- auth_users.id
  status TEXT NOT NULL DEFAULT 'Active',
  pin_hash TEXT                               -- HMAC-SHA256(PIN_PEPPER, pin); never returned by the API
);
-- PINs must be unique among active staff so a PIN identifies one person.
CREATE UNIQUE INDEX technicians_active_pin ON technicians(pin_hash) WHERE status = 'Active' AND pin_hash IS NOT NULL;

CREATE TABLE checklist_templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  template_id TEXT UNIQUE NOT NULL,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  parameter_name TEXT NOT NULL,
  unit TEXT,
  min_value REAL,
  max_value REAL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,                         -- numeric | multichoice
  options TEXT,
  pass_value TEXT,
  fail_value TEXT,
  required INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_templates_equipment ON checklist_templates(equipment_id);

-- ---------- equipment inspections ----------
CREATE TABLE inspection_headers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  inspection_id TEXT UNIQUE NOT NULL,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  technician_id TEXT NOT NULL REFERENCES technicians(id),
  inspection_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status TEXT NOT NULL DEFAULT 'Draft',
  notes TEXT,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  is_backdated INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  template_snapshot TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_header_equipment ON inspection_headers(equipment_id);
CREATE INDEX idx_header_date ON inspection_headers(inspection_date);
CREATE INDEX idx_header_technician ON inspection_headers(technician_id);
CREATE INDEX idx_header_status ON inspection_headers(status);

CREATE TABLE inspection_details (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  inspection_id TEXT NOT NULL REFERENCES inspection_headers(id),
  parameter_name TEXT NOT NULL,
  value TEXT NOT NULL,
  computed_status TEXT NOT NULL,
  comment TEXT,
  evidence TEXT
);
CREATE INDEX idx_details_inspection ON inspection_details(inspection_id);

CREATE TABLE photos (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  inspection_id TEXT REFERENCES inspection_headers(id),
  equipment_id TEXT REFERENCES equipment(id),
  storage_path TEXT NOT NULL
);

CREATE TABLE signatures (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  inspection_id TEXT NOT NULL REFERENCES inspection_headers(id),
  storage_path TEXT NOT NULL,
  signed_by TEXT NOT NULL,
  role TEXT NOT NULL,
  signed_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE issues (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  issue_id TEXT UNIQUE NOT NULL,
  plant_id TEXT REFERENCES plants(id),
  system TEXT,
  location TEXT,
  issue TEXT NOT NULL,
  date_reported TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status TEXT NOT NULL DEFAULT 'Open',
  root_cause TEXT,
  correction TEXT,
  target_date TEXT,
  completed_date TEXT,
  preventive_action TEXT,
  pic TEXT,
  comment TEXT,
  source_kind TEXT,
  source_inspection_id TEXT,
  source_parameter TEXT,
  correction_review_required INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX issues_inspection_parameter ON issues(source_kind, source_inspection_id, source_parameter);

CREATE TABLE alert_settings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  category TEXT NOT NULL,
  email TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- ---------- fire extinguisher module ----------
CREATE TABLE fe_floors (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  building TEXT NOT NULL,
  floor_name TEXT NOT NULL,
  image_path TEXT,                            -- key in the R2 bucket under floorplans/
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ref_width REAL,
  ref_height REAL,
  UNIQUE (building, floor_name)
);

CREATE TABLE fire_extinguishers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  fe_code TEXT UNIQUE NOT NULL,
  fe_type TEXT NOT NULL,
  location_desc TEXT,
  floor_id TEXT REFERENCES fe_floors(id) ON DELETE SET NULL,
  map_x REAL,
  map_y REAL,
  qr_code TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  serial_no TEXT,
  expiry_date TEXT,
  document_links TEXT NOT NULL DEFAULT '[]',
  next_maintenance_date TEXT
);
CREATE INDEX idx_fe_floor ON fire_extinguishers(floor_id);
CREATE INDEX idx_fe_expiry ON fire_extinguishers(expiry_date);

CREATE TABLE fe_checklist_templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  fe_type TEXT NOT NULL,
  parameter_name TEXT NOT NULL,
  options TEXT NOT NULL,
  fail_values TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_fe_tpl_type ON fe_checklist_templates(fe_type);

CREATE TABLE fe_inspections (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  fe_id TEXT NOT NULL REFERENCES fire_extinguishers(id) ON DELETE CASCADE,
  technician_id TEXT REFERENCES technicians(id),
  inspection_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status TEXT NOT NULL DEFAULT 'Completed',
  remarks TEXT,
  observed_expiry_date TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  template_snapshot TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_fe_insp_fe ON fe_inspections(fe_id);
CREATE INDEX idx_fe_insp_date ON fe_inspections(inspection_date);

CREATE TABLE fe_inspection_details (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  inspection_id TEXT NOT NULL REFERENCES fe_inspections(id) ON DELETE CASCADE,
  parameter_name TEXT NOT NULL,
  value TEXT NOT NULL,
  computed_status TEXT NOT NULL,
  comment TEXT,
  evidence TEXT
);
CREATE INDEX idx_fe_det_insp ON fe_inspection_details(inspection_id);

-- ---------- tasks module ----------
CREATE TABLE task_stages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#94a3b8',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  title TEXT NOT NULL,
  description TEXT,
  parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  stage_id TEXT REFERENCES task_stages(id) ON DELETE SET NULL,
  assigned_to TEXT REFERENCES technicians(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'Medium',
  start_date TEXT,
  due_date TEXT,
  duration_days INTEGER,
  completed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES technicians(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_tasks_parent ON tasks(parent_id);
CREATE INDEX idx_tasks_stage ON tasks(stage_id);
CREATE INDEX idx_tasks_assignee ON tasks(assigned_to);

-- ---------- reliable inspections (receipts, versions, corrections, reviews) ----------
CREATE TABLE facility_receipts (
  request_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE inspection_versions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  kind TEXT NOT NULL,
  inspection_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  reason TEXT,
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (kind, inspection_id, revision)
);

CREATE TABLE inspection_corrections (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  kind TEXT NOT NULL,
  inspection_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT
);
CREATE UNIQUE INDEX one_pending_correction ON inspection_corrections(kind, inspection_id) WHERE status = 'Pending';

CREATE TABLE inspection_reviews (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  kind TEXT NOT NULL,
  inspection_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  signature TEXT,
  reviewer_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_reviews_inspection ON inspection_reviews(kind, inspection_id);
CREATE INDEX idx_versions_inspection ON inspection_versions(kind, inspection_id);

-- ---------- internal ----------
-- Login throttling (per IP) for the PIN pad.
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

-- D1 has no interactive transactions; the Worker sends each save as one
-- atomic batch. Inserting a 0 into one of these columns aborts the whole
-- batch, which is how "row changed since you read it" races are rejected.
CREATE TABLE _guard (
  id INTEGER PRIMARY KEY,
  stale_revision INTEGER CONSTRAINT stale_revision CHECK (stale_revision IS NULL OR stale_revision = 1),
  expiry_changed INTEGER CONSTRAINT expiry_changed CHECK (expiry_changed IS NULL OR expiry_changed = 1),
  already_reviewed INTEGER CONSTRAINT already_reviewed CHECK (already_reviewed IS NULL OR already_reviewed = 1)
);

-- ---------- default data ----------
INSERT INTO task_stages (name, color, sort_order, is_done) VALUES
  ('Reported',    '#94a3b8', 1, 0),
  ('Assigned',    '#6366f1', 2, 0),
  ('In progress', '#1a56db', 3, 0),
  ('Done',        '#16a34a', 4, 1),
  ('Verified',    '#15803d', 5, 1);

INSERT INTO fe_checklist_templates (fe_type, parameter_name, options, fail_values, sort_order) VALUES
('CO2','Physical Condition','Good,Not Good','Not Good',1),
('CO2','Rivet Pin','Present,Missing','Missing',2),
('CO2','Pressure Gauge','N/A (CO2)',NULL,3),
('CO2','Discharge Hose / Nozzle','Good,Damaged,Missing','Damaged,Missing',4),
('CO2','Handle','Good,Damaged','Damaged',5),
('CO2','Label','Clear,Faded,Missing','Faded,Missing',6),
('CO2','Visibility','Visible,Obstructed','Obstructed',7),
('ABC','Physical Condition','Good,Not Good','Not Good',1),
('ABC','Rivet Pin','Present,Missing','Missing',2),
('ABC','Pressure Gauge','Normal,Low,High','Low,High',3),
('ABC','Discharge Hose / Nozzle','Good,Damaged,Missing','Damaged,Missing',4),
('ABC','Handle','Good,Damaged','Damaged',5),
('ABC','Label','Clear,Faded,Missing','Faded,Missing',6),
('ABC','Visibility','Visible,Obstructed','Obstructed',7),
('Water','Physical Condition','Good,Not Good','Not Good',1),
('Water','Rivet Pin','Present,Missing','Missing',2),
('Water','Pressure Gauge','Normal,Low,High','Low,High',3),
('Water','Discharge Hose / Nozzle','Good,Damaged,Missing','Damaged,Missing',4),
('Water','Handle','Good,Damaged','Damaged',5),
('Water','Label','Clear,Faded,Missing','Faded,Missing',6),
('Water','Visibility','Visible,Obstructed','Obstructed',7);
