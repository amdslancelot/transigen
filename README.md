# Transigen (YouTube-first MVP)

Two-page collaborative app:

- `transition`: users propose and vote the best transition for a directed pair A -> B.
- `room`: users chain songs A -> B -> C using best pair transitions, capped to 1 hour.

## Setup

1. Install Node.js 20+.
2. `npm install`
3. Copy `.env.example` to `.env.local` and fill Supabase vars.
4. In Supabase **Authentication → URL Configuration**, add your app origin and callback to **Redirect URLs** (e.g. `http://localhost:3000` and `http://localhost:3000/auth/callback` for local dev).
5. Apply SQL migrations in order: `0001_init.sql`, `0002_transition_presets_params.sql`, `0003_metadata_caches.sql`.
6. (Optional) Add `YOUTUBE_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` to `.env.local` to enable server-side metadata + Auto BPM lookup.
7. `npm run dev`

### External API setup (optional)

| Env var | Where to get it | Used for |
|---------|-----------------|----------|
| `YOUTUBE_API_KEY` | <https://console.cloud.google.com/apis/library/youtube.googleapis.com> → Enable → Credentials → API key. Free, 10k units/day. | Server-side YouTube `videos.list` (title, channel, duration). Cached in `youtube_video_cache`. |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | <https://developer.spotify.com/dashboard> → Create app. Free. | BPM lookup via Spotify search + `audio-features`. Cached in `spotify_track_cache` + `youtube_spotify_link`. |

Without these env vars, the **Create New Transition** form still works (the user can type duration/BPM manually); the **Auto BPM** button and the auto-filled metadata simply error gracefully.

## Auth flow switch

Set `NEXT_PUBLIC_AUTH_FLOW` in `.env.local` and **restart** `npm run dev` (value is read at startup).

| Value | Behavior |
|--------|----------|
| `magic_link` (default) | Send magic link; same as original flow. |
| `email_password` | Sign up + sign in with email and password. If Supabase **Confirm email** is on, the first sign-up still sends a confirmation link; after that, use **Sign in** with the same email and password. |
| `dev_email_only` | Email only, no mail sent. Requires `AUTH_DEV_EMAIL_BYPASS=1`, `SUPABASE_SERVICE_ROLE_KEY`, and `AUTH_DEV_SHARED_PASSWORD` (see `.env.example`). **Insecure — local/dev only.** |

## MVP behavior

- YouTube/Spotify transition proposals are timestamp-only:
  - `end_prev_sec` for song A
  - `start_next_sec` for song B
- Presets are labels only (real DSP FX reserved for mp3/wav phase).
- Waveform visuals are SoundCloud-like progress visuals, not audio-derived waveforms.

## 你還要在 Supabase 後台做的
Authentication → URL Configuration → Redirect URLs 加入（本機範例）：

http://localhost:3000
http://localhost:3000/auth/callback
若沒加 callback 這條，magic link 可能被 Supabase 擋下或導向失敗。

npm run build 已通過。若你之後用正式網域，記得在 Redirect URLs 一併加上對應的 https://你的網域/auth/callback。


## 以下是從零到「登入並開始用」的簡短流程（本機假設用 http://localhost:3000）。

### 事前準備（只做一次）
1. 環境變數
  專案根目錄有 .env.local，內含 NEXT_PUBLIC_SUPABASE_URL、NEXT_PUBLIC_SUPABASE_ANON_KEY（來自 Supabase 專案 Settings → API）。

2. Supabase 後台
  Authentication → URL Configuration → Redirect URLs 要包含：

- http://localhost:3000
- http://localhost:3000/auth/callback
  Site URL 建議設成 http://localhost:3000（本機開發時）。
3. 資料庫
  在 Supabase SQL Editor 執行 supabase/migrations/0001_init.sql（README 步驟 5）。

4.啟動專案

```shell
npm install
npm run dev
```

### 登入步驟
1. 瀏覽器打開 http://localhost:3000。
2. 點 Sign in，進 /login。
3. 輸入 email → Send magic link。
4. 到信箱點 登入連結（會先經過 /auth/callback，再導回首頁 /）。
5. 回到首頁後若已登入，會看到 Open transition page 和 Create room set，不再只有 Sign in。

### 開始用 App
- Open transition page → /transition：為歌曲對 A→B 提 transition、投票。
- Create room set → /room/new：建立 room，把多首歌串成 set。
注意： 寄信與點連結盡量都用同一個網址習慣（例如一律 localhost:3000，不要混用 127.0.0.1），否則 Cookie 可能對不上。若點連結後又回到登入頁並帶錯誤訊息，先檢查 Redirect URLs 是否已加上 /auth/callback。




### 設定檔
- src/config/authFlow.ts：集中讀取 NEXT_PUBLIC_AUTH_FLOW，並提供 isDevEmailBypassServerEnabled()（讀 AUTH_DEV_EMAIL_BYPASS）。

### 三種模式（重啟 npm run dev 後生效）
| Flow Type      | Behavior Description                                                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| magic_link     | The original Send magic link flow. All related code is still intact.                                                                                                                                                                                                                                         |
| email_password | Sign up (email + password) -> If Supabase has Confirm email enabled, a confirmation email will still be sent the first time (equivalent to verify). Afterwards, use Sign in (email + password) to log in instead of using a magic link. To save time on your local machine, you can disable Confirm email in Supabase. |
| dev_email_only | Enter email only, no emails will be sent. The backend uses the service role to create the account or update the password, and then logs in using a shared internal password via signInWithPassword. Limited to local/development environments only.                                                          |

### .env.local 範例
- 改用帳密（取代一直用 magic link）：
```shell
NEXT_PUBLIC_AUTH_FLOW=email_password
```

- 完全不要寄信（避開 rate limit，僅開發）：
```shell
NEXT_PUBLIC_AUTH_FLOW=dev_email_only
AUTH_DEV_EMAIL_BYPASS=1
SUPABASE_SERVICE_ROLE_KEY=你的_service_role_金鑰
AUTH_DEV_SHARED_PASSWORD=請用長隨機字串
SUPABASE_SERVICE_ROLE_KEY 在 Supabase Project Settings → API → service_role（勿提交到 git、勿用 NEXT_PUBLIC_）。
```

