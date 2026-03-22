-- ===========================================================
-- GRID: Student Innovator Matchmaker — Full Schema
-- ===========================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ===================== USERS =====================
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    github_id       INTEGER UNIQUE,
    github_handle   TEXT    UNIQUE,
    google_id       TEXT    UNIQUE,
    email           TEXT,
    auth_provider   TEXT    NOT NULL DEFAULT 'github' CHECK(auth_provider IN ('github','google')),
    display_name    TEXT,
    avatar_url      TEXT,
    bio             TEXT    DEFAULT '',
    timezone        TEXT    DEFAULT 'UTC',
    is_onboarded    INTEGER DEFAULT 0,
    created_at      TEXT    DEFAULT (datetime('now')),
    updated_at      TEXT    DEFAULT (datetime('now'))
);

-- ===================== SKILLS =====================
CREATE TABLE IF NOT EXISTS skills (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT UNIQUE NOT NULL COLLATE NOCASE
);

-- ===================== USER_SKILLS (many-to-many) =====================
CREATE TABLE IF NOT EXISTS user_skills (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_id  INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    level     TEXT    CHECK(level IN ('beginner','intermediate','advanced')) DEFAULT 'intermediate',
    PRIMARY KEY (user_id, skill_id)
);

-- ===================== AVAILABILITY (7 days x 24 hour-blocks) =====================
-- Each row = "user IS available at this day+hour." Absence = unavailable.
-- Max 168 rows per user (7 x 24).
CREATE TABLE IF NOT EXISTS availability (
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_of_week   INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),   -- 0=Mon .. 6=Sun
    hour_block    INTEGER NOT NULL CHECK(hour_block  BETWEEN 0 AND 23),  -- 0=midnight .. 23=11pm
    PRIMARY KEY (user_id, day_of_week, hour_block)
);

-- ===================== EVENTS (populated by Apify scraper) =====================
CREATE TABLE IF NOT EXISTS events (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    title                 TEXT    NOT NULL,
    url                   TEXT    UNIQUE NOT NULL,
    description           TEXT    DEFAULT '',
    organizer             TEXT,
    start_date            TEXT,
    end_date              TEXT,
    registration_deadline TEXT,
    location              TEXT,
    tags                  TEXT    DEFAULT '[]',          -- JSON array of topic strings
    image_url             TEXT,
    source_site           TEXT    NOT NULL DEFAULT 'unstop',
    is_active             INTEGER DEFAULT 1,
    created_at            TEXT    DEFAULT (datetime('now')),
    updated_at            TEXT    DEFAULT (datetime('now'))
);

-- ===================== EVENT_INTERESTS =====================
CREATE TABLE IF NOT EXISTS event_interests (
    user_id    INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    event_id   INTEGER NOT NULL REFERENCES events(id)  ON DELETE CASCADE,
    created_at TEXT    DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, event_id)
);

-- ===================== MESSAGES =====================
CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT    NOT NULL,
    is_read     INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(sender_id, receiver_id, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread
    ON messages(receiver_id, is_read, created_at);

-- ===================== TEAMS =====================
CREATE TABLE IF NOT EXISTS teams (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT    NOT NULL,
    event_id           INTEGER REFERENCES events(id) ON DELETE SET NULL,
    created_by         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    discord_invite_url TEXT,
    discord_channel_id TEXT,
    created_at         TEXT    DEFAULT (datetime('now'))
);

-- ===================== TEAM_MEMBERS =====================
CREATE TABLE IF NOT EXISTS team_members (
    team_id   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT    DEFAULT 'member' CHECK(role IN ('owner','member')),
    status    TEXT    DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
    joined_at TEXT    DEFAULT (datetime('now')),
    PRIMARY KEY (team_id, user_id)
);

-- ===================== USER_LIKES =====================
CREATE TABLE IF NOT EXISTS user_likes (
    liker_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    liked_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    context    TEXT    DEFAULT 'general' CHECK(context IN ('general','event')),
    event_id   INTEGER REFERENCES events(id) ON DELETE SET NULL,
    created_at TEXT    DEFAULT (datetime('now')),
    PRIMARY KEY (liker_id, liked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_likes_liked ON user_likes(liked_id, liker_id);

-- ===================== TEAM_INVITES =====================
CREATE TABLE IF NOT EXISTS team_invites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id     INTEGER NOT NULL REFERENCES teams(id)  ON DELETE CASCADE,
    inviter_id  INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    invitee_id  INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    status      TEXT    DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
    created_at  TEXT    DEFAULT (datetime('now')),
    UNIQUE(team_id, invitee_id)
);
