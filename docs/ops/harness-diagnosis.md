# 快速診斷：此環境最漏 token / 最易失焦 / 最易出錯的前三名

> 撰寫：2026-07-06，Fable 5 session 實測觀察。讀者：之後接手的較小模型（Sonnet/Haiku）。
> 每條附「弱模型能照做的修法」。其他制度檔引用本檔時寫 `docs/ops/harness-diagnosis.md#N`。

## 1. 沒有 CLAUDE.md → 每個 session 重新掃 repo（最大漏洞）

**症狀**：本 session 開場時 CLAUDE.md 不存在。每個新 session 都得重新 `ls`、讀 package.json、grep 找 player 邏輯 — 每次燒 1–3 萬 token 重建同樣的認知，而且弱模型重建的品質更差（會漏掉 `transitionPresetTick.ts` 這種非顯名檔案）。

**修法（照做）**：CLAUDE.md 已建立（repo root），是索引不是內容。你在 session 開始時：
1. 先讀 CLAUDE.md 的索引，**只讀你任務需要的那一條指到的檔**。
2. 不要為了「了解專案」整包掃 src/。索引沒涵蓋你要的東西時，派 Explore/investigator subagent 去找，不要自己 grep 十次。
3. 學到索引沒有的重要事實（新檔案、新概念）→ 按 `docs/ops/maintenance.md` 把它加進索引。

## 2. 常駐 hook 噪音與模式互相打架（最易出錯）

**症狀**：本環境每個 session 自動注入 caveman mode（極簡口吻）+ ponytail mode（最懶實作）兩個常駐 plugin，合計每 session 吃掉約 2k token 的 system 注入，且對弱模型有兩個具體陷阱：
- caveman 的「省字」會滲進**不該省的地方**：文件、commit message、給使用者的關鍵警告。規則其實寫了 code/docs/security 要正常寫，但弱模型常忽略邊界。
- ponytail 的「最短 diff」會被弱模型誤讀成「跳過理解直接改」— 它自己都警告這是危險的懶。

**修法（照做）**：
1. 口吻極簡只用在**對話回覆**。寫進檔案的內容（docs、code、commit、PR）一律完整句子、正常標點。判準：這段字會不會存進 repo？會 → 正常寫。
2. 動手改 code 前，必須先讀完「這個改動會碰到的每個檔」再選最小方案。做到一半發現要碰的檔案數比讀完後的估計多一倍以上 → 停，重新讀範圍內所有相關檔、更新估計後再繼續；更新後仍超出就按 `docs/ops/judgment-rubrics.md`#4 換路或升級。
3. 使用者說「stop caveman / stop ponytail / normal mode」時立即照辦，不要下一輪又滑回去。

## 3. 主對話自己下場做大量讀取／執行（最漏 token 的行為模式）

**症狀**：主對話（你）直接讀大檔、連續 grep、跑長 build log — 這些原始輸出全部進主 context，一次大掃描就吃掉 context 的 1/4，後面的判斷品質跟著掉（失焦：忘記前面的結論、重複問已答過的事）。

**修法（照做）**：
1. 凡是「要讀 3 個或更多檔案（≥3）才能回答」或「輸出會超過 100 行」的偵查工作 → 派 subagent（用法見 `docs/ops/model-dispatch.md`），主對話只收結論 + `檔案:行號`。
2. 跑測試/build：輸出長的話管到檔案（`npm run build > /tmp/build.log 2>&1`），只讀最後 30 行或 grep error。
3. 主 context 是稀缺資源。進 context 的每一段文字問一次：這段是「結論」還是「原料」？原料不進主對話。

## 4. Context 複利與 /compact、/clear 判準

**機制一句話**：API 無狀態，整場對話每輪重送；每個進入主 context 的 token，session 剩餘的每一輪都要重付一次（cache 折價但不免費）。

**修法（照做）**：
1. 任務交付完、下一件事**相關** → 確認結論已存檔，再建議使用者 `/compact 保留檔案路徑、行號、未完成事項`。
2. 下一件事**不相關** → 建議 `/clear`（新 session 從 CLAUDE.md + worklog 重建，比 compact 便宜且不失真）。
3. 不要在任務進行中 compact（工作細節會被摘要掉，得重讀檔案重建）。
4. 這兩個指令由使用者輸入；你的義務是在任務邊界主動提醒，並確保存檔先於壓縮。

## 次要（不到前三，但記一下）

- 深夜長 session 的 context 壓縮會丟細節：重要中間結論**隨做隨寫進檔案**，不要只放在對話裡。
- 記憶目錄（`~/.claude/projects/-Users-lans-h-Documents-Cursor-transigen/memory/`）session 開始會載入 MEMORY.md 索引 — 跨 session 的事實寫那裡，單 session 的事實不要寫（污染索引）。
