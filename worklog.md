# Work Log

a+c+d的方案可以
用 title 去查 BPM: 如果有免費方案那就用, 使用async方式呼叫, 然後在頁面上顯示有沒有抓成功

是否同意建一張 youtube_bpm_cache 做結果快取？
duration 抓不到時，錯誤是真的擋住 還是 僅當 advisory（讓使用者自己填 end/start，且不再 disable preview）？

Spotify 從 2024 中之後對 audio-features 在某些「未經審核 app」上會回 403，需要在 dashboard 把 app 模式從 “Development” 改成 “Quota Extension”（送一個簡單的問卷說明用途），或先在 Development 模式下把要查的 user 加到「users」清單。
對於這種 server-to-server 的查 catalog tempo，Client Credentials flow 一般沒這個限制，你可以照下面流程做先試試。


若還要再進一步（例如編輯時把 end_prev_sec 吸附到格點、或自訂相位 offset），可以再開一輪需求在 Agent 裡做。


若要之後關掉 debug，可改為只在 process.env.NODE_ENV === "development" 時渲染面板。

process.env.NODE_ENV 通常不是你在專案裡手寫設定的，而是由 執行指令的環境 / 打包工具 注入的。

常見來源
Next.js（你的專案）

next dev → 多半是 development
next build / next start → 多半是 production
這些值由 Next 在編譯／啟動時寫進 bundle，不是從 .env 讀 NODE_ENV 當一般變數。
自己下指令
在 shell 裡：
NODE_ENV=production node server.js
或先 export NODE_ENV=production 再跑指令。

CI / 託管平台
例如 Vercel、Netlify 在 build 時會設成 production（依平台而定）。

和 .env 的關係
.env、.env.local 裡可以寫 NODE_ENV=...，但 Next 官方文件會提醒：不要依賴在 .env 裡改 NODE_ENV，因為 dev/build 行為主要由 CLI 決定；在應用程式裡用 process.env.NODE_ENV === 'production' 做分支即可。

若要確認你本機現在是什麼，在專案裡暫時 console.log(process.env.NODE_ENV) 或用 next dev / next build 對照即可。

http://localhost:3000/room/4898e7ba-de23-4d32-bbc5-0dac950de881
http://localhost:3000/transition?fromVideo=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DkwEZRPkAAu8%26list%3DRDkwEZRPkAAu8&toVideo=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D88wHgiUAKoI%26list%3DRD88wHgiUAKoI
http://localhost:3000/room/3a7e48e6-3177-43ea-b0f5-37f6166fe67c

## 2026-07-06 — Fable 5 session：制度建立 + audio 架構可行性評估

### 可行性結論（全文：docs/design/audio-cache-feasibility.md）

「先下載音檔 + 記憶體播放」可行，分兩期：

- **Q1（downloader + 進房下載）**：用 yt-dlp 包成獨立 worker（Fly.io/VPS，$5–20/月；Supabase/Vercel 跑不了它）。不等全部下載完才開房：前兩首（deck A/B）ready 就開門，其餘背景下載。快取以 videoId 永久保留，每首歌全站只下載一次。Client 端：壓縮檔（3–5MB/首）放 Cache API；解碼後 PCM 一首 4 分鐘歌約 80MB，解碼窗口鎖死 2 首，prefetch 窗口按 deviceMemory 調。Prefetch 用「接下來 K 首必須在快取」的不變量（每次換歌 + 每 10 秒檢查），不用「快播完時觸發」（seek 會失準）。
- **Q2**：使用者體驗不變，仍只貼 YouTube link，下載分析全在背景。
- **Q3**：Spotify 死路（DRM 拿不到音訊、audio-features 403）。推薦 Phase 1：先下載只做分析（BPM + beat grid），播放照走 iframe，getCurrentTime 回歸對齊，幾天工作量拿 80% 對拍精度。Phase 2 才是原案：Web Audio 雙 deck，sample-accurate，解鎖真 EQ/echo/filter。Phase 1 產出全數沿用。
- **最大風險**：YouTube 封鎖 server 下載。iframe fallback 是必要組件；動工前先租 VPS 實測 20 首下載成功率。

### 制度產出（9 檔建立，對抗審查 7 findings 已修，read-back 8/8 PASS）

- CLAUDE.md（56 行，純索引：程式碼地圖 + 核心三規則 + 檔案路由）
- docs/ops/harness-diagnosis.md — 環境三大陷阱與修法
- docs/ops/model-dispatch.md — 派工對照表、升降級、驗證不自驗、查證過的 model/effort 參數
- docs/ops/judgment-rubrics.md — 六組判準，每條一正一反例
- docs/ops/prompt-templates.md — 搜尋/實作/重構/研究/審查五範本
- docs/ops/maintenance.md — 權限分級、lessons.md 格式、精簡門檻
- docs/ops/letter-to-future-sessions.md — 交接信（低信心清單在此）
- docs/design/audio-cache-feasibility.md — 可行性全文
- 記憶目錄 2 檔 + MEMORY.md 索引

### 下一步

1. 新 session 直接開，CLAUDE.md 自動路由。
2. 動 audio 架構前：一小時 VPS 實測 yt-dlp 成功率。
3. 未確認：Fable→Opus 導流額度歸屬（usage 儀表板實測）；feasibility 數字是量級估計。
4. 以上檔案未 commit。

### 補充討論：為什麼需要獨立 worker、能不能自己寫 downloader（2026-07-06）

結論：不是「不能自己寫」，是「自己寫要一直重寫」。

**為什麼現有基礎設施跑不了下載＋分析：**

- Vercel serverless：執行時間上限與部署包大小限制。yt-dlp 是 Python、ffmpeg 是 100MB+ 的 C binary，塞進 lambda 又要撐過整首歌的下載時間，兩頭都不合適（具體秒數/MB 上限依方案而異，未逐一查證，引用前先查官方文件）。
- Supabase Edge Functions：Deno runtime（JS/TS only），跑不了 Python 的 yt-dlp、呼叫不了 ffmpeg binary。硬限制。
- 使用者瀏覽器：CORS 封鎖 googlevideo.com；簽名解密需要執行 YouTube 混淆過的 player JS；且等於用使用者的 IP 去爬，風險轉嫁給使用者。

所以「獨立 worker」不是高級架構，就是一台能裝 Python + ffmpeg 的最小機器（Fly.io / Railway / VPS）。

**自寫 downloader 為什麼是死路：**

YouTube 媒體 URL 是動態加密（signature cipher）：要執行其混淆過的 player JS 才解得出真下載連結，且 YouTube 頻繁改演算法。yt-dlp 背後有數百人社群跟進，改版後幾天到兩週內 release 修復。自寫等於一人對抗這場軍備競賽。「自己寫」的正確形式是寫一個小 wrapper 呼叫 yt-dlp — worker 裡跑的就是這個。

**成本能不能再省：**

- 家裡電腦當 worker：$0，需 24/7 開機與自顧網路；但住宅 IP 反而比機房 IP 不易被 YouTube 擋。開發期先用這個實測最合理。
- GitHub Actions：不建議 — datacenter IP 幾乎必被 YouTube 要求驗證；「yt-dlp 用途曾被 GitHub 禁」一說未查證。
- Fly.io 免費 tier：未查證（近年方案有變動），當作沒有。

下一步不變：先拿自己的電腦實測 20 首下載成功率，確認可行再租機器（$5–20/月）。

### 補充查證：Supabase Storage 上限與費用（2026-07-06，來源 supabase.com 官方 pricing 與 docs）

| 項目 | Free | Pro（$25/月）|
|---|---|---|
| 儲存容量 | 1 GB | 100 GB（超出 $0.021/GB）|
| 單檔上限 | 50 MB | 500 GB |
| Egress/月 | 10 GB | 250 GB（超出 cached $0.03/GB、uncached $0.09/GB）|

結論：

- Free plan 撐不住音檔快取：1GB 約 250 首（4MB/首）就滿。
- Pro 容量無虞：100GB 約 25,000 首。1,000 首庫存僅 4GB，儲存費忽略不計。
- 真正的成本是 egress 不是儲存：1,000 首、每首月下載 50 次 = 200GB，在 Pro 內含 250GB 內，$25 全包。10,000 首同假設 = 2TB，超出部分約 $25–90/月（取決 CDN 命中率）。
- 緩解（已在設計內）：client Cache API 讓同一使用者重複進房不重新下載，實際 egress 低於「每次播放都下載」的假設；音檔用 opus 約 3MB/首可再省 25%。單檔 50MB 上限對音檔（3–5MB/首）無影響。

### 開發估算：Phase 1/2 token 與時間（2026-07-06，量級估計 ±2 倍）

範圍修正：Phase 1 用自己電腦當 worker（砍掉原規劃的部署/Docker/proxy/job queue 健壯性工程 — 這些是規劃中項目，不是現有 code）；Phase 2 音檔存本機、不用 Supabase Storage（代價：只有本機瀏覽器播得到，其他使用者自動走 iframe fallback）。

Phase 1（本機 worker + yt-dlp + beat 分析 + iframe 對拍）：

| 工作項 | Token（Sonnet 為主）| 工作時段 |
|---|---|---|
| 實測實驗（20 首下載成功率）| 50–100k | 半天，多半在等下載 |
| Worker 腳本（yt-dlp + aubio/librosa + 寫 DB，200–400 行 Python）| 200–400k | 1–2 |
| DB migration + server action + readiness 顯示 | 150–300k | 1 |
| 對拍整合（beatGrid 吃實測值 + getCurrentTime 回歸對齊）| 400–800k | 2–4（實測迴圈）|
| 量測工具（錄音驗證切點誤差）| 200–400k | 1–2 |

小計：約 1–2M token、6–10 時段、日曆約 1 週（每天 2–3 小時節奏）。

Phase 2（本機音檔 + Web Audio 雙 deck）：

| 工作項 | Token | 工作時段 |
|---|---|---|
| 音檔 serving（Next.js route 讀本機檔）| 100–200k | 1 |
| Client cache 管理（Cache API + 解碼窗口 2）| 300–500k | 2 |
| Web Audio deck 引擎（source→gain→effects）| 500–900k | 3–4 |
| Transition effects 移植（fade/echo/stutter 改 GainNode/DelayNode）| 400–800k | 2–3，聽感迴圈變數最大 |
| iframe fallback + 整合 RoomFullSetPlayer | 300–500k | 2 |

小計：約 1.6–3M token、10–12 時段、日曆 2–3 週。

總計：約 3–5M token（Sonnet ~80%、Haiku ~15%、Opus ~5%），API 牌價約 $15–40 等級；日曆 3–4 週 part-time，全職約 1.5–2 週。最可能超支處：getCurrentTime 對齊精度不達標（Phase 1 降級為粗對拍）、echo/stutter 聽感調參（需人耳驗證）。
