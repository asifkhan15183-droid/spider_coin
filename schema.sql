PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(
 telegram_id TEXT PRIMARY KEY, username TEXT, first_name TEXT, last_name TEXT,
 balance REAL NOT NULL DEFAULT 0, mining_rate REAL NOT NULL DEFAULT 1,
 mining_started_at INTEGER, mining_claimed_at INTEGER, referred_by TEXT, referral_rewarded_at INTEGER,
 referrals INTEGER NOT NULL DEFAULT 0, tasks_completed INTEGER NOT NULL DEFAULT 0,
 is_banned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,url TEXT NOT NULL,reward REAL NOT NULL DEFAULT 13,active INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS task_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,telegram_id TEXT NOT NULL,task_id INTEGER NOT NULL,started_at INTEGER NOT NULL,claimed_at INTEGER,day_key TEXT NOT NULL,UNIQUE(telegram_id,task_id,day_key));
CREATE TABLE IF NOT EXISTS checkin_rewards(day_no INTEGER PRIMARY KEY,reward REAL NOT NULL);
CREATE TABLE IF NOT EXISTS checkins(id INTEGER PRIMARY KEY AUTOINCREMENT,telegram_id TEXT NOT NULL,day_no INTEGER NOT NULL,claimed_on TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS transfers(id INTEGER PRIMARY KEY AUTOINCREMENT,from_id TEXT NOT NULL,to_id TEXT NOT NULL,amount REAL NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,telegram_id TEXT NOT NULL,amount REAL NOT NULL,kind TEXT NOT NULL,note TEXT,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS referral_milestones(
 telegram_id TEXT NOT NULL,milestone INTEGER NOT NULL,reward REAL NOT NULL,awarded_at INTEGER NOT NULL,
 PRIMARY KEY(telegram_id,milestone)
);
CREATE TABLE IF NOT EXISTS admin_users(telegram_id TEXT PRIMARY KEY,role TEXT NOT NULL CHECK(role IN ('sub')),created_at INTEGER NOT NULL);
INSERT OR IGNORE INTO settings(key,value) VALUES
('mining_claim_min','10'),('wallet_send_min','100'),('daily_mining_rate','1'),
('referral_reward','25'),('referral_milestone_10','200'),('referral_milestone_200','1000'),('referral_milestone_1000','10000'),('task_reward','13'),('withdrawal_text','Withdrawal Start in 2027');
INSERT OR IGNORE INTO checkin_rewards(day_no,reward) VALUES
(1,100),(2,200),(3,500),(4,1000),(5,1500),(6,0),(7,0),(8,0),(9,0),(10,0),(11,0),(12,0),(13,0),(14,0),(15,0),(16,0),(17,0),(18,0),(19,0),(20,0),(21,0);
