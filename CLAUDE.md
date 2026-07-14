# transigen — CLAUDE.md（索引）

DJ transition app：使用者貼 YouTube link 組 setlist，在 room 內雙 deck 播放，transition effect 對拍切歌。
Next.js 15 + React 19 + Supabase（DB/Auth/migrations，無 edge functions）。播放走 YouTube IFrame API。

**本檔只是索引。只讀你任務需要的那條指到的檔，不要為了「了解專案」整包掃 src/。**

## Session 開始（照順序）

1. 讀本索引，找到任務相關的檔。
2. 索引沒涵蓋 → 派 investigator/Explore subagent 去找（不要自己 grep 十次）。
3. 派工、升降級、驗證規則 → `docs/ops/model-dispatch.md`（含查證過的型號/effort 參數）。
4. 交辦 prompt 直接抄範本 → `docs/ops/prompt-templates.md`。

## 核心三規則（其餘見 ops 檔）

- **指揮官不下場**：大量讀取/掃描/批次改檔/驗證一律派 subagent，主對話只收結論。
- **驗證不自驗**：完成宣稱必須有執行證據（build/測試/實跑/read-back），驗證派新開的 general-purpose agent（不續用做事者）。
- **卡住的判準查表**：何時升級模型、何時算完成、何時問使用者、何時換路 → `docs/ops/judgment-rubrics.md`。

## 程式碼地圖（2026-07-06 查證）

| 區域 | 位置 | 說明 |
|---|---|---|
| 頁面路由 | `src/app/` | room/（房間列表、[roomId] 播放頁）、transition/（composer）、login/、auth/ |
| Server actions | `src/app/actions.ts` | BPM 查詢、proposal、room CRUD（無 pages/api） |
| 播放核心 | `src/components/RoomFullSetPlayer.tsx` | 雙 deck A/B 編排：playVideo/pauseVideo/seekTo/setVolume |
| YT 播放器 | `src/components/YouTubePlayer.tsx`、`src/lib/youtubeIframeApi.ts` | iframe 載入與 ref 持有 |
| Transition 邏輯 | `src/lib/transitionPresetTick.ts` | fade（setVolume ramp）、echo/stutter（seekTo hack） |
| | `src/lib/transitionHandoff.ts` | hard-cut 交接 |
| | `src/lib/transitionBeatGrid.ts` | BPM→bar 對齊數學 |
| 型別 | `src/types/db.ts`、`src/types/media.ts` | Room、RoomSetItem（即 setlist 一格）、TransitionProposal 等 |
| DB schema | `supabase/migrations/` | 0001–0006；含 youtube/bpm metadata cache 表 |
| 工作日誌 | `worklog.md` | 近況與待辦（Spotify audio-features 已確認是死路：dev-mode 403） |

無 Web Audio API — 目前音量控制只有 `YT.Player.setVolume()`。無測試框架。

## 設計文件（按需讀）

- `docs/design/audio-cache-feasibility.md` — 「先下載音檔+記憶體播放」架構評估（Phase 1/2 分期、風險、client cache 規則）。動 transition 精準度或播放架構前必讀。
- `docs/design/deploy-oci-cicd-plan.md` — OCI + Terraform + OKE 部署，pull-based in-cluster CD（deploy-poller + kaniko，無 GitHub Actions）。worker 維持本地不部署。動部署/infra 前必讀。

## 制度檔（按需讀）

- `docs/ops/harness-diagnosis.md` — 此環境三大陷阱與修法（token 漏、caveman/ponytail 邊界、主對話下場）。
- `docs/ops/model-dispatch.md` — 派工對照表、三要素、升降級、驗證不自驗。
- `docs/ops/judgment-rubrics.md` — 判斷 checklist（每條含正反例）。
- `docs/ops/prompt-templates.md` — 搜尋/實作/重構/研究/審查五種交辦範本。
- `docs/ops/maintenance.md` — 誰能改什麼、教訓寫回 `docs/ops/lessons.md`（該檔不存在就按需建立）、精簡時機。
- `docs/ops/letter-to-future-sessions.md` — 給未來 session 的交接信。

## 硬規則

- 寫進檔案的內容（code/docs/commit）一律完整句子正常寫；caveman 口吻只用於對話。
- 改制度檔先備份（`.bak`）；新內容寫新檔；本索引 ≤150 行。
- 型號/參數/價格永遠先查證再寫，查不到標 UNVERIFIED，不編造。
