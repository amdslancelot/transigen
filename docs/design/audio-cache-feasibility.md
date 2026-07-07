# 可行性評估：Room 播放改用「先下載音檔 + 記憶體播放」架構

> 撰寫：2026-07-06，Fable 5 session。狀態：設計評估，未實作。
> 前提：依需求方指示，本文不討論 YouTube 版權/ToS，只評技術與營運可行性。

## 一句話結論

**可行，且值得做，但不要一步到位。** 先做「只下載來分析、播放仍走 iframe」的 Phase 1（幾天工作量，拿到 80% 的對拍精準度），再做「完整下載播放」的 Phase 2（1–2 週，拿到 sample-accurate transition 與真正的 DJ effects）。最大風險不是頻寬或記憶體，是 **YouTube 對 server 端下載的反爬蟲封鎖**，所以任何版本都必須保留現有 iframe 播放作為 fallback 路徑。

## 對三個問題的直接回答

### Q1：能不能寫一個 YouTube downloader，進 room 時 server 開始 parallel download？

能。但**不要自己寫 downloader** — YouTube 的簽名解密與 client 模擬是持續軍備競賽，自寫必死。用 `yt-dlp`（唯一持續維護的方案）包成 worker service。

現有架構的缺口：Supabase 只有 migrations，**沒有可以跑 yt-dlp 的 compute**（Edge Functions 是 Deno，跑不了 python + ffmpeg；Vercel serverless 也不合適：執行時間限制 + binary 打包麻煩）。需要一台獨立 worker（Fly.io / Railway / 小 VPS，Docker 裝 python + yt-dlp + ffmpeg + aubio 或 librosa），小規模成本約 $5–20/月。

流程（使用者點進 room 時）：

1. Next.js server action 把 setlist 全部 videoId 寫入 `ingest_jobs` 表（已在 storage 的跳過）。
2. Worker 輪詢（或 Supabase Realtime 通知）領工作，優先序：deck 上的前兩首 → setlist 其餘依 position。
3. 每首：`yt-dlp -x`（audio-only m4a/opus，約 1MB/分鐘 → 一首 3–5MB）→ 上傳 Supabase Storage `tracks/{videoId}.m4a` → 跑 beat 分析（見下）→ 寫 `track_analysis` 列（bpm、beat_offset、beats jsonb、duration、status）。
4. Client 用 Realtime 訂閱 readiness，UI 顯示「準備中 x/y」。

**等待時間的修正建議**：不要等「全部下載完」才開 room。20 首的 setlist 第一次進場可能要等 1–3 分鐘，體驗死。改成：**前兩首（deck A/B）ready 就開門**，其餘背景繼續。快取以 videoId 為 key 永久保留，所以同一首歌全站只下載一次 — 越用越快，熱門歌第二次進場等待趨近 0。

單首下載時間：yt-dlp 用對 client 模擬時約 2–10 秒/首；被 YouTube 節流時可能 30 秒以上（見風險節）。分析 1–5 秒/首（1 vCPU）。

### Q1 續：client cache 與 prefetch 邏輯

先分清兩層，因為記憶體量差 20 倍：

| 層 | 形式 | 大小 | 放哪 |
|---|---|---|---|
| 壓縮音檔 | m4a/opus bytes | 3–5MB/首 | Cache API（磁碟，不吃 RAM）|
| 解碼後 | AudioBuffer（PCM float32 stereo 44.1kHz）| **約 20MB/分鐘 → 4 分鐘歌 ≈ 80MB** | RAM |

規則（弱模型可直接照做）：

- **解碼窗口固定 = 2**（正在播的 + 下一首）。不要按 deviceMemory 放大解碼窗口，80MB×N 在手機上會被 OS 殺。
- **壓縮 prefetch 窗口 K 按設備調**：`navigator.deviceMemory >= 8 ? 4 : 2`（deviceMemory 只有 Chromium 有；拿不到就當 2）。
- prefetch 觸發**不要用「快播完時」**（使用者一 seek 就失準）。用不變量：「接下來 K 首的壓縮檔必須在 Cache API 裡」，在每次換歌時 + 每 10 秒 tick 檢查一次，缺就補。這等價於使用者描述的「第一首快結束時抓第三首」，但對 seek/跳歌是 robust 的。
- Transition composer / preview page 不套這套（需求方已指定），繼續走 iframe。

### Q2：保留 YouTube link 的使用者體驗？

完全保留。使用者仍然只貼 YouTube link；下載、分析、快取全部發生在背景，使用者不需要知道也看不出來（除了第一次進 room 的短暫「準備中」）。**永遠不要求使用者上傳音檔** — 這點寫進產品底線。

### Q3：有沒有別的做法能讓 YouTube/Spotify 播放時精準對拍？

- **Spotify：死路。** Web Playback SDK 的音訊走 DRM（EME），拿不到 audio data；`audio-features` API 對 2024 後的 dev-mode app 回 403（worklog 已踩過）；preview URL 只有 30 秒。不要再投資源。
- **Hybrid（推薦為 Phase 1）**：server 下載音檔**只用於分析**（BPM + beat grid + 第一拍 offset），播放仍走 iframe。Transition 時用 `player.getCurrentTime()` 對齊 beat grid：getCurrentTime 有 ±50ms 抖動，用「連續多次取樣 + 對播放時鐘做線性回歸」把估計壓到 ±20–30ms，然後 `setTimeout` 排程 effect 起點。拿得到「切在拍上」的精準度，拿不到 sample-accurate crossfade，但不動播放路徑、風險極低。現有的 `transitionBeatGrid.ts` 直接受益：BPM 從「使用者手填/title 猜」變成「實測」。
- **完整下載播放（Phase 2，即需求方原案）**：Web Audio API（每 deck 一條 `AudioBufferSourceNode → GainNode → effects → destination`），`AudioContext.currentTime` 排程是 sample-accurate。額外解鎖現在做不到的效果：真 EQ kill（BiquadFilter）、echo（DelayNode）、filter sweep — 現在用 `seekTo` 模擬 stutter 的 hack 可以整個丟掉。

## 風險排序（高到低）

1. **YouTube 反爬蟲封鎖 server 下載**（發生機率：高，長期必遇）。Datacenter IP 會被要求 PO token / 標記 bot。緩解：yt-dlp 保持最新 + cookies/PO-token plugin；必要時 residential proxy；快取永久化讓每支影片全站只下載一次；**下載失敗的歌自動 fallback 到 iframe 播放 + 現有 setVolume transition**。fallback 路徑是本架構的必要組件，不是 nice-to-have。
2. **手機記憶體**：解碼窗口鎖 2 已緩解；iOS Safari 對 AudioContext 有自動暫停行為，需要 user-gesture resume（進 room 的點擊即可當 gesture）。
3. **Worker 營運成本與維護**：多一個要顧的服務。小規模 $5–20/月 + Supabase storage（$0.021/GB/月）+ egress。1000 首快取 ≈ 4GB ≈ 忽略不計。
4. **雙路徑複雜度**：iframe 與 Web Audio 兩套播放/transition 程式碼並存。用同一個抽象介面（play/pause/seek/setGain/schedule）包住兩者，`RoomFullSetPlayer` 只認介面。

## 分期計畫

- **Phase 1（幾天）**：worker + yt-dlp + beat 分析 → `track_analysis` 表；iframe 播放不動；`transitionBeatGrid.ts` 改吃實測 BPM/offset；getCurrentTime 回歸對齊。驗收：同一首歌 transition 切點落拍誤差 < 50ms（錄音驗證）。
- **Phase 2（1–2 週）**：Supabase Storage 音檔 + client Cache API/decode 窗口 + Web Audio 雙 deck + fallback 機制。驗收：全程無 iframe 播放（除 fallback）、crossfade 無爆音、手機 4GB RAM 設備不 crash。
- Phase 1 的所有產出（worker、分析表、beat grid）在 Phase 2 全部沿用，沒有丟棄成本。

## 未確認事項

- 部署平台（假設 Vercel）— 影響 worker 選型細節，不影響結論。
- yt-dlp 當下的封鎖狀況隨時在變 — 動工前先手動測 20 首歌的下載成功率再定 proxy 預算。
