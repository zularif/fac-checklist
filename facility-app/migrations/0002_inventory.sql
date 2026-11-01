-- Spare parts inventory for the P1 and P2 stores.
-- Stock quantities only change through the Worker's stock_move / parts_import
-- functions, which also write a stock_movements row for every change.

CREATE TABLE parts (
  id TEXT PRIMARY KEY,
  part_code TEXT UNIQUE NOT NULL,
  part_name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  brand TEXT,
  model TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  photo_path TEXT,                     -- key in the FILES store under parts/
  qr_code TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'Active', -- Active | Retired
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_parts_category ON parts(category);

-- One row per part per store. CHECK makes it impossible to go below zero,
-- even when two people take the last item at the same moment.
CREATE TABLE part_stock (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  store TEXT NOT NULL CHECK (store IN ('P1','P2')),
  quantity INTEGER NOT NULL DEFAULT 0 CONSTRAINT not_enough_stock CHECK (quantity >= 0),
  min_qty INTEGER NOT NULL DEFAULT 0,
  location TEXT,                        -- shelf / bin in that store
  UNIQUE (part_id, store)
);
CREATE INDEX idx_part_stock_part ON part_stock(part_id);

-- Every stock change. change = signed effect on `store`; a transfer writes
-- two rows (out of one store, into the other) sharing group_id.
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                   -- in | out | transfer | adjust | opening
  store TEXT NOT NULL,
  other_store TEXT,                     -- the other side of a transfer
  change INTEGER NOT NULL,
  balance_after INTEGER,
  reason TEXT,
  equipment_id TEXT REFERENCES equipment(id) ON DELETE SET NULL,
  technician_id TEXT REFERENCES technicians(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_moves_part ON stock_movements(part_id, created_at);
CREATE INDEX idx_moves_date ON stock_movements(created_at);
CREATE INDEX idx_moves_equipment ON stock_movements(equipment_id);
