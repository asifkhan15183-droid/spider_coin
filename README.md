# SPIDER COIN (SPC) Telegram Mini App

A starter Cloudflare Workers + D1 project with a branded single-page Mini App.

## Included
- Dark/neon-green SPC branding and tab navigation
- Telegram WebApp authentication (server-side initData validation)
- Telegram first/last name, username and ID display
- Referral link using `@SPC_Wallet_bot` (`startapp=ref_<telegram_id>`)
- Mining counter calculated in browser; server verifies claims
- Daily tasks with a 30-second minimum before claim
- Separate 21-day check-in tab; main admin can set all 21 rewards
- Bank-card-style SPC wallet and member-to-member transfer
- Minimum mining claim and wallet send amounts controlled by main admin
- Main Admin and restricted Sub Admin (ban/unban only)
- Task creation and reward settings for main admin

## Important limitations / production notes
1. This is a starter implementation, not a security-audited financial wallet. SPC is an in-app points balance; there is no blockchain or withdrawal system.
2. Task claim verifies the 30-second server timer, not that a user actually watched a video or joined a channel. For real channel verification, add a bot webhook and Telegram `getChatMember`, with the bot made an administrator of each channel.
3. The referral is credited when the invited user first opens the Mini App from the `startapp` link, not when they start mining.
4. The send endpoint currently accepts the recipient's numeric Telegram ID. Both users must have opened the Mini App before.
5. Daily dates use UTC. Adapt day boundaries if you want another timezone.
6. For higher integrity, implement D1 transactional/batch conditions and idempotency keys for wallet transfers and reward claims, then security-test before public launch.
7. The app makes one bootstrap request on opening and API requests only on user actions; the live mining counter is local. Browser refresh causes a new bootstrap request. Avoid polling.

## Setup

### 1. Create D1 database
In Cloudflare Dashboard -> Workers & Pages -> D1 -> Create database, name it `miniapp`.
Open the database console and run the full contents of `schema.sql`.

### 2. Configure Worker
Create a Worker and upload/push this project through GitHub, or use Wrangler.
Edit `wrangler.toml`:
- Replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with your D1 database ID.
- Keep D1 binding name exactly `DB`.
- Keep assets binding name exactly `ASSETS`.

### 3. Add Worker secrets
Worker -> Settings -> Variables and Secrets:
- `BOT_TOKEN` (Secret): token from BotFather. Never put this token in GitHub.
- `ADMIN_TELEGRAM_ID` (Variable or Secret): your numeric Telegram ID.

### 4. Telegram Mini App setup
In BotFather, configure `@SPC_Wallet_bot` as a Mini App / Main App and set the deployed Worker URL.
The referral URL uses:
`https://t.me/SPC_Wallet_bot?startapp=ref_TELEGRAM_ID`
The `startapp` deep link requires the bot's Mini App to be configured for direct opening. Test that Telegram supplies `tgWebAppStartParam` to the app.

### 5. Deploy
Install Wrangler locally and run:
```bash
npm install -g wrangler
wrangler login
wrangler deploy
```
If you use GitHub integration, connect the repository to Cloudflare Workers Builds and set the build/deploy command to `npx wrangler deploy`.

## First launch
- Open the Mini App from Telegram, not a normal browser.
- The first user with Telegram ID matching `ADMIN_TELEGRAM_ID` is Main Admin.
- Main Admin can add Sub Admin by numeric Telegram ID.
- Sub Admin only sees Ban/Unban controls.
- Main Admin sets minimum mining claim, minimum send, mining rate, referral reward, task reward, and 21 daily check-in rewards.

## Keep secrets safe
Do not commit `BOT_TOKEN` or any private credentials to GitHub.


## Referral system (real server-side qualification)
- Every user gets a unique link: `https://t.me/SPC_Wallet_bot?startapp=ref_TELEGRAM_ID`.
- The signed Telegram `start_param` is read from verified `initData`; the browser query string is not trusted.
- A referral is counted only after the invited member makes their first successful mining claim (not just opening the app).
- One invited account can reward one inviter only once. Self-referrals are rejected.
- Default rewards: 25 SPC per qualified referral; 10 referrals = Verified + 200 SPC; 200 = VIP + 1,000 SPC; 1,000 = VVIP + 10,000 SPC.
- Each milestone bonus is stored with a unique database key and can only be awarded once.
- The Profile tab displays the user's level, awarded milestones, and Top 10 referral leaderboard.
- Main Admin can change base and milestone rewards from Admin Control.

### Updating an existing D1 database
For an existing database created with the previous ZIP, run this migration once in the Cloudflare D1 Console before deploying the updated Worker:

```sql
ALTER TABLE users ADD COLUMN referral_rewarded_at INTEGER;
CREATE TABLE IF NOT EXISTS referral_milestones(
 telegram_id TEXT NOT NULL,
 milestone INTEGER NOT NULL,
 reward REAL NOT NULL,
 awarded_at INTEGER NOT NULL,
 PRIMARY KEY(telegram_id,milestone)
);
INSERT OR IGNORE INTO settings(key,value) VALUES
('referral_milestone_10','200'),
('referral_milestone_200','1000'),
('referral_milestone_1000','10000');
```

**Important:** This starter still does not prove that a person watched a full video or joined a Telegram channel. The 30-second task timer is server checked, but actual task verification requires Telegram membership checks or a trusted task provider. Referral qualification is tied to the first successful mining claim. Audit and load-test before handling valuable balances.
