CREATE TABLE IF NOT EXISTS farmdata_user_farms (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  farm_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, farm_id)
);

CREATE INDEX IF NOT EXISTS farmdata_user_farms_farm_id_idx
  ON farmdata_user_farms(farm_id);
