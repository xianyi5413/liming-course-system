CREATE TABLE backup_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_id TEXT NOT NULL UNIQUE,
  backup_type TEXT NOT NULL CHECK(backup_type IN ('daily', 'monthly', 'manual', 'pre_upgrade', 'pre_restore')),
  "trigger" TEXT NOT NULL CHECK("trigger" IN ('manual', 'scheduled', 'catch_up', 'retry', 'upgrade', 'restore')),
  scheduled_for TEXT,
  started_at TEXT,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'creating', 'available', 'verification_failed', 'failed', 'missing', 'quarantined', 'deleted')),
  verification_status TEXT NOT NULL DEFAULT 'not_verified'
    CHECK(verification_status IN ('not_verified', 'verifying', 'passed', 'failed')),
  snapshot_strategy TEXT,
  app_version TEXT,
  app_git_commit TEXT,
  schema_version INTEGER,
  manifest_version INTEGER,
  package_filename TEXT
    CHECK(package_filename IS NULL OR (
      length(package_filename) BETWEEN 1 AND 255
      AND package_filename NOT GLOB '*/*'
      AND package_filename NOT GLOB '*\*'
      AND package_filename NOT IN ('.', '..')
    )),
  package_size INTEGER CHECK(package_size IS NULL OR package_size >= 0),
  package_sha256 TEXT
    CHECK(package_sha256 IS NULL OR (length(package_sha256) = 64 AND package_sha256 NOT GLOB '*[^0-9a-f]*')),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1)),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 1000),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK(warning_count >= 0),
  error_code TEXT NOT NULL DEFAULT '' CHECK(length(error_code) <= 128),
  error_message_safe TEXT NOT NULL DEFAULT '' CHECK(length(error_message_safe) <= 500),
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_backup_sets_created_at ON backup_sets(created_at DESC, id DESC);
CREATE INDEX idx_backup_sets_status_created ON backup_sets(status, created_at DESC);
CREATE INDEX idx_backup_sets_verification_created ON backup_sets(verification_status, created_at DESC);
CREATE INDEX idx_backup_sets_type_created ON backup_sets(backup_type, created_at DESC);

CREATE TABLE backup_copies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_set_id INTEGER NOT NULL,
  storage_type TEXT NOT NULL CHECK(storage_type IN ('local', 'baidu_netdisk')),
  copy_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(copy_status IN ('pending', 'available', 'verifying', 'failed', 'missing', 'deleted')),
  managed_relative_path TEXT NOT NULL
    CHECK(
      length(managed_relative_path) BETWEEN 1 AND 1024
      AND substr(managed_relative_path, 1, 1) <> '/'
      AND managed_relative_path NOT GLOB '[A-Za-z]:*'
      AND managed_relative_path NOT GLOB '*\*'
      AND ('/' || managed_relative_path || '/') NOT LIKE '%/../%'
      AND ('/' || managed_relative_path || '/') NOT LIKE '%/./%'
    ),
  size INTEGER CHECK(size IS NULL OR size >= 0),
  sha256 TEXT CHECK(sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  verified_at TEXT,
  last_error_code TEXT NOT NULL DEFAULT '' CHECK(length(last_error_code) <= 128),
  last_error_message_safe TEXT NOT NULL DEFAULT '' CHECK(length(last_error_message_safe) <= 500),
  remote_file_id TEXT,
  remote_revision TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (backup_set_id) REFERENCES backup_sets(id) ON DELETE RESTRICT,
  UNIQUE (backup_set_id, storage_type, managed_relative_path)
);

CREATE INDEX idx_backup_copies_backup_set ON backup_copies(backup_set_id, id);
CREATE INDEX idx_backup_copies_storage_status ON backup_copies(storage_type, copy_status);

CREATE TABLE job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  job_type TEXT NOT NULL CHECK(job_type IN ('backup_create', 'backup_verify', 'retention', 'restore_test', 'remote_upload')),
  "trigger" TEXT NOT NULL CHECK("trigger" IN ('manual', 'scheduled', 'catch_up', 'retry', 'upgrade', 'restore')),
  scheduled_for TEXT,
  started_at TEXT,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued', 'running', 'success', 'failed', 'cancelled', 'skipped')),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK(attempt >= 1),
  max_attempts INTEGER NOT NULL DEFAULT 1 CHECK(max_attempts >= attempt),
  backup_set_id INTEGER,
  idempotency_key TEXT,
  error_code TEXT NOT NULL DEFAULT '' CHECK(length(error_code) <= 128),
  error_message_safe TEXT NOT NULL DEFAULT '' CHECK(length(error_message_safe) <= 500),
  duration_ms INTEGER CHECK(duration_ms IS NULL OR duration_ms >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (backup_set_id) REFERENCES backup_sets(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_job_runs_idempotency
  ON job_runs(job_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_job_runs_status_scheduled ON job_runs(status, scheduled_for, id);
CREATE INDEX idx_job_runs_backup_set ON job_runs(backup_set_id, created_at DESC);
CREATE INDEX idx_job_runs_created_at ON job_runs(created_at DESC, id DESC);
