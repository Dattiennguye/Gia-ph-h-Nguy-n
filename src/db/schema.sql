-- ===========================================================================
--  Vigo Match — lược đồ cơ sở dữ liệu
--  Nguyên tắc: User ≠ Profile ≠ Preference. Tách ba phần ngay từ đầu.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------ KHU VỰC
-- Cây địa giới: Quốc gia → Tỉnh/Thành → Quận/Huyện → Xã/Phường.
CREATE TABLE IF NOT EXISTS regions (
  id          INTEGER PRIMARY KEY,
  parent_id   INTEGER REFERENCES regions(id) ON DELETE CASCADE,
  level       TEXT    NOT NULL CHECK (level IN ('country','province','district','ward')),
  code        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  full_name   TEXT    NOT NULL,
  lat         REAL,
  lng         REAL,
  -- Khu vực có đang mở đăng ký hay không (giải bài toán mật độ người dùng).
  signup_open INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_regions_parent ON regions(parent_id);
CREATE INDEX IF NOT EXISTS idx_regions_level  ON regions(level);

-- --------------------------------------------------------------------- USER
-- Danh tính & truy cập. Không chứa thông tin hiển thị.
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT    UNIQUE COLLATE NOCASE,
  phone           TEXT    UNIQUE,
  password_hash   TEXT,
  oauth_provider  TEXT,             -- google | apple | null
  oauth_subject   TEXT,
  role            TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin')),
  status          TEXT    NOT NULL DEFAULT 'active'
                  CHECK (status IN ('pending','active','suspended','banned','deleted')),
  status_reason   TEXT,
  phone_verified  INTEGER NOT NULL DEFAULT 0,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  onboarding_step TEXT    NOT NULL DEFAULT 'goal',
  risk_score      INTEGER NOT NULL DEFAULT 0,
  last_active_at  INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (oauth_provider, oauth_subject)
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(last_active_at);

CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT    NOT NULL UNIQUE,
  user_agent   TEXT,
  ip           TEXT,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS otp_codes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  channel      TEXT    NOT NULL CHECK (channel IN ('phone','email')),
  destination  TEXT    NOT NULL,
  purpose      TEXT    NOT NULL,     -- signup | login | verify_phone | reset
  code_hash    TEXT    NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  consumed_at  INTEGER,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_dest ON otp_codes(destination, purpose);

-- ------------------------------------------------------------------ PROFILE
-- Con người: hiển thị cho người khác thấy.
CREATE TABLE IF NOT EXISTS profiles (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name       TEXT    NOT NULL,
  birth_date         TEXT,                        -- YYYY-MM-DD
  gender             TEXT    CHECK (gender IN ('male','female','other')),
  bio                TEXT    NOT NULL DEFAULT '',
  -- Vị trí: toạ độ thật dùng để tính khoảng cách, KHÔNG BAO GIỜ trả ra API.
  region_id          INTEGER REFERENCES regions(id),
  lat                REAL,
  lng                REAL,
  location_updated_at INTEGER,

  height_cm          INTEGER,
  body_type          TEXT,
  marital_status     TEXT,
  has_children       TEXT,
  occupation         TEXT,
  education          TEXT,
  income_range       TEXT,
  religion           TEXT,
  smoking            TEXT,
  drinking           TEXT,

  -- Quan điểm sống: trái tim của thuật toán ghép đôi.
  relationship_goal  TEXT,
  seriousness        INTEGER CHECK (seriousness BETWEEN 1 AND 5),
  marriage_timeline  TEXT,
  children_wish      TEXT,
  living_preference  TEXT,

  lifestyle_tags     TEXT NOT NULL DEFAULT '[]',   -- JSON array
  interest_tags      TEXT NOT NULL DEFAULT '[]',   -- JSON array

  completeness       INTEGER NOT NULL DEFAULT 0,   -- 0..100
  visibility         TEXT NOT NULL DEFAULT 'public'
                     CHECK (visibility IN ('public','hidden','paused')),
  boosted_until      INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_region ON profiles(region_id);
CREATE INDEX IF NOT EXISTS idx_profiles_goal   ON profiles(relationship_goal);

CREATE TABLE IF NOT EXISTS profile_photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url         TEXT    NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  status      TEXT    NOT NULL DEFAULT 'approved'
              CHECK (status IN ('pending','approved','rejected')),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_user ON profile_photos(user_id, position);

-- --------------------------------------------------------------- PREFERENCE
-- Nhu cầu: "tôi đang tìm ai".
CREATE TABLE IF NOT EXISTS preferences (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  interested_in      TEXT NOT NULL DEFAULT '[]',   -- JSON array giới tính
  age_min            INTEGER NOT NULL DEFAULT 18,
  age_max            INTEGER NOT NULL DEFAULT 45,
  max_distance_km    INTEGER NOT NULL DEFAULT 20,
  relationship_goals TEXT NOT NULL DEFAULT '[]',   -- JSON array
  updated_at         INTEGER NOT NULL
);

-- Tiêu chí bắt buộc / ưu tiên. Bảng riêng để người dùng tự thêm bớt.
CREATE TABLE IF NOT EXISTS preference_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('must','prefer')),
  field       TEXT    NOT NULL,
  operator    TEXT    NOT NULL CHECK (operator IN
              ('eq','neq','in','not_in','gte','lte','between','contains_any','contains_all')),
  value       TEXT    NOT NULL,           -- JSON
  weight      INTEGER NOT NULL DEFAULT 3 CHECK (weight BETWEEN 1 AND 5),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rules_user ON preference_rules(user_id, kind);

-- ----------------------------------------------------------- XÁC MINH / AN TOÀN
CREATE TABLE IF NOT EXISTS verifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT    NOT NULL CHECK (type IN ('phone','photo','identity')),
  status        TEXT    NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  -- Dữ liệu giấy tờ được mã hoá AES-256-GCM, không bao giờ lộ ra API người dùng.
  payload_enc   TEXT,
  document_hash TEXT,                     -- để phát hiện một CCCD dùng cho nhiều tài khoản
  reviewer_id   INTEGER REFERENCES users(id),
  review_note   TEXT,
  created_at    INTEGER NOT NULL,
  reviewed_at   INTEGER,
  UNIQUE (user_id, type)
);
CREATE INDEX IF NOT EXISTS idx_verif_status ON verifications(status);
CREATE INDEX IF NOT EXISTS idx_verif_doc    ON verifications(document_hash);

-- ------------------------------------------------------------------ TƯƠNG TÁC
CREATE TABLE IF NOT EXISTS likes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT    NOT NULL CHECK (action IN ('like','pass','superlike')),
  score       INTEGER,                    -- điểm phù hợp tại thời điểm tương tác
  created_at  INTEGER NOT NULL,
  UNIQUE (from_user, to_user)
);
CREATE INDEX IF NOT EXISTS idx_likes_to   ON likes(to_user, action);
CREATE INDEX IF NOT EXISTS idx_likes_from ON likes(from_user, created_at);

CREATE TABLE IF NOT EXISTS matches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER,
  highlights  TEXT NOT NULL DEFAULT '[]', -- JSON: điểm chung tại thời điểm match
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','unmatched','blocked')),
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER,
  CHECK (user_a < user_b),
  UNIQUE (user_a, user_b)
);
CREATE INDEX IF NOT EXISTS idx_matches_a ON matches(user_a, status);
CREATE INDEX IF NOT EXISTS idx_matches_b ON matches(user_b, status);

CREATE TABLE IF NOT EXISTS blocks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (user_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);

-- ----------------------------------------------------------------------- CHAT
CREATE TABLE IF NOT EXISTS conversations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id       INTEGER NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  icebreaker     TEXT,
  last_message_at INTEGER,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT    NOT NULL,
  -- Kết quả quét an toàn: clean | warned | blocked
  safety_state    TEXT    NOT NULL DEFAULT 'clean',
  safety_flags    TEXT    NOT NULL DEFAULT '[]',
  read_at         INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS message_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,
  url         TEXT    NOT NULL,
  meta        TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);

-- ------------------------------------------------------- BÁO CÁO & KIỂM DUYỆT
CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category     TEXT    NOT NULL,
  detail       TEXT,
  evidence     TEXT NOT NULL DEFAULT '{}',   -- JSON: id tin nhắn, ảnh...
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','reviewing','resolved','dismissed')),
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_id);

CREATE TABLE IF NOT EXISTS moderation_cases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id    INTEGER REFERENCES reports(id) ON DELETE SET NULL,
  source       TEXT NOT NULL,                -- report | auto_scan | admin
  risk         TEXT NOT NULL CHECK (risk IN ('low','medium','high')),
  signals      TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','reviewing','actioned','dismissed')),
  assignee_id  INTEGER REFERENCES users(id),
  resolution   TEXT,
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cases_status ON moderation_cases(status, risk);

CREATE TABLE IF NOT EXISTS safety_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,
  severity    INTEGER NOT NULL DEFAULT 1,
  detail      TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_safety_user ON safety_events(user_id, created_at);

-- ---------------------------------------------------------- GÓI & THANH TOÁN
CREATE TABLE IF NOT EXISTS subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan        TEXT    NOT NULL CHECK (plan IN ('free','premium')),
  status      TEXT    NOT NULL CHECK (status IN ('active','expired','cancelled','pending')),
  started_at  INTEGER NOT NULL,
  expires_at  INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id, status);

CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product       TEXT    NOT NULL,           -- premium_1m | premium_3m | boost | verify_plus
  amount_vnd    INTEGER NOT NULL,
  provider      TEXT    NOT NULL,
  provider_ref  TEXT    UNIQUE,
  status        TEXT    NOT NULL CHECK (status IN ('pending','paid','failed','refunded')),
  created_at    INTEGER NOT NULL,
  paid_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, status);

CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id  INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,             -- charge | refund | grant
  amount_vnd  INTEGER NOT NULL,
  note        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS boosts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  payment_id  INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);

-- ------------------------------------------------------------------ HỆ THỐNG
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL DEFAULT '',
  data        TEXT    NOT NULL DEFAULT '{}',
  read_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at, id);

-- Gợi ý hằng ngày đã chốt: giữ nguyên trong ngày để trải nghiệm ổn định.
CREATE TABLE IF NOT EXISTS recommendations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_date    TEXT    NOT NULL,           -- YYYY-MM-DD
  rank          INTEGER NOT NULL,
  score         INTEGER NOT NULL,
  explanation   TEXT    NOT NULL DEFAULT '{}',
  seen_at       INTEGER,
  created_at    INTEGER NOT NULL,
  UNIQUE (user_id, target_id, batch_date)
);
CREATE INDEX IF NOT EXISTS idx_recs_batch ON recommendations(user_id, batch_date, rank);

CREATE TABLE IF NOT EXISTS compatibility_scores (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  breakdown   TEXT NOT NULL DEFAULT '{}',
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role  TEXT,
  action      TEXT    NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail      TEXT    NOT NULL DEFAULT '{}',
  ip          TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_logs(actor_id);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket      TEXT    NOT NULL,
  window_start INTEGER NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
