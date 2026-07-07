# 模型調度守則

> 讀者：主對話的模型（任何等級）。目的：讓便宜模型跑日常、貴模型只花在判斷上。
> 型號與參數為 2026-07-06 查證值；來源：Claude Code 官方文件 + 本 harness 環境。過期就按 `docs/ops/maintenance.md` 更新本檔。

## 查證過的可用資源

- 主對話可切換型號：`/model <alias>`，alias：`haiku`、`sonnet`、`opus`、`fable`，或完整 ID。
- 完整 ID（2026-07-06 本 harness 環境原文照抄，haiku 的日期後綴即官方格式）：`claude-fable-5`、`claude-opus-4-8`、`claude-sonnet-4-6`、`claude-haiku-4-5-20251001`。用前看日期，過期先重查。能力/成本排序：haiku < sonnet < opus < fable。
- Agent tool 的 `model` 參數收 alias（sonnet/opus/haiku/fable）。
- Effort 參數：**Agent tool 呼叫本身沒有 effort 參數**。Effort 只能在 `.claude/agents/*.md` 的 frontmatter 設：`effort: low|medium|high|xhigh|max`（官方 subagents 文件）。要指定 effort 就先建 agent 定義檔。
- Thinking 控制：settings.json `alwaysThinkingEnabled`（bool）、env `MAX_THINKING_TOKENS`。
- 未確認：被安全機制導向 Opus 4.8 的請求計入哪個額度 — 官方文件無記載。要知道就去 usage 儀表板實測，不要編。

## 鐵律：指揮官不下場

主對話不做：大量讀檔、掃 repo、查網頁、批次改檔、跑驗證。這些派 subagent，主對話只收結論。主對話只做：拆任務、下判斷、整合結論、跟使用者對話。

## 派工對照表

| 任務 | agent type | model | 理由 |
|---|---|---|---|
| 找定義/呼叫點/檔案位置 | caveman:cavecrew-investigator | haiku | 純檢索，壓縮輸出省主 context |
| 廣域搜尋、不確定在哪 | Explore | sonnet | 需要一點推理選路 |
| 1–2 檔的機械修改 | caveman:cavecrew-builder | sonnet | 範圍已知，照做即可 |
| 跨檔實作、新功能 | general-purpose | sonnet | 需要理解 + 實作 |
| Diff review | caveman:cavecrew-reviewer | sonnet | 一行一 finding |
| 架構取捨、模糊需求拆解 | 主對話自己做，或 Plan agent | opus | 換便宜模型就掉品質的部分 |
| 驗證別人的產出 | general-purpose（新開，不續用做事者）| haiku/sonnet | 見「驗證不自驗」 |

## 任務交辦三要素（每次派工必含，缺一不派）

1. **目標與動機**：做什麼、為什麼（subagent 沒有你的對話脈絡，一句動機能避開一半的誤解）。
2. **驗收條件**：可判定的完成標準（「測試 X 通過」「回報含 file:line」），不是「做好」。
3. **回報格式**：subagent 只回結論與 `檔案:行號`；長產物（>50 行）寫到檔案，回傳路徑。原始碼片段、完整 log 不准貼回來。

範本見 `docs/ops/prompt-templates.md`。

## 升降級路徑

- **haiku 錯一次** → 同任務升 sonnet 重派，prompt 附上錯誤輸出。
- **sonnet 同一子任務連錯兩次** → 帶完整失敗軌跡（兩次的 prompt + 錯誤輸出）升 opus。不帶軌跡的升級等於重新賭一次。
- **opus 解出模式後**（例如找到了正確的改法樣板）→ 把樣板寫成明確步驟，降回 sonnet/haiku 批次套用到其餘案例。
- **同一件事最多重試兩輪**（含升級）。第三輪不是繼續試，是停下來換路或問使用者（判準見 `docs/ops/judgment-rubrics.md`）。

## 驗證不自驗

做的人不驗自己的產出。驗證一律派新開的 subagent（agent type 用 general-purpose，不 SendMessage 續用做事者 — 不能帶做事者的脈絡；下文簡稱 fresh-context）：

- **檔案類**：read-back — 派 haiku 讀檔，回報「檔案存在？內容涵蓋 X/Y/Z？有無斷句或明顯缺漏？」
- **程式碼類**：跑測試或實跑（`npm run build`、實際執行路徑），不接受「看起來對」。
- **高風險判斷**（架構、刪東西、對外動作）：第二意見 — 派另一個 agent 針對同問題獨立作答，比對分歧；或多答案評審擇優。

## 成本直覺（給不確定要不要派工的時刻）

- 一次 haiku investigator 掃描 ≈ 主對話自己讀 2 個中型檔的成本，但主 context 只進 60 行結論。幾乎永遠划算。
- 派工的固定成本是 subagent 冷啟動要重建脈絡 — 所以交辦 prompt 裡要把「它需要知道的背景」寫全，別讓它自己重新探索你已知的事。
- 5 分鐘內連續小問題不要每題開新 agent：用 SendMessage 續用同一個 agent（保脈絡、省冷啟動）。
