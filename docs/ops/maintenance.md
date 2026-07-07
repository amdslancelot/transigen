# 維護協議

> 這套制度檔會腐化。本檔規定誰能改什麼、教訓寫回哪裡、多長要精簡。

## 權限分級

**弱模型可自行改（不必問使用者）**：
- CLAUDE.md 索引：加一行指向新檔、修正失效路徑、更新一句話描述。
- `docs/ops/model-dispatch.md` 的「查證過的可用資源」節：發現型號/參數過期時，先查證（官方文件或 harness 環境實測）再更新，並改掉查證日期。
- `docs/design/*.md`：狀態標記更新（「設計評估」→「已實作 Phase 1」）。
- 踩雷教訓的追加（格式見下）。

**動之前必須問使用者**：
- 刪除或重寫任何制度檔（docs/ops/*）的整節。
- 改 `docs/ops/judgment-rubrics.md` 的規則本體（判準是制度核心，弱模型不自改判準 — 這是防退化的主閘）。
- 改 `.claude/settings.json`、hooks、plugin 設定。
- 任何「我覺得這條規則不對」的情況 — 不對就回報，不要繞過。

## 踩雷教訓寫回哪裡、什麼格式

觸發：任何「重試兩輪才解掉」或「方向錯了換路」的事件（判準見 judgment-rubrics.md#4）。

寫到：`docs/ops/lessons.md`（不存在就建立），**追加不改舊條目**，格式：

```
## YYYY-MM-DD [一句話標題]
- 症狀：[當時看到什麼]
- 錯誤路徑：[試了什麼、為什麼不行]
- 正解：[最後怎麼解的]
- 規則化：[一句可照做的預防規則；如果值得常載，同時在 CLAUDE.md 索引加一行]
```

跨 session 的使用者偏好/專案脈絡（非 repo 可推導的）→ 寫到記憶目錄（`~/.claude/projects/-Users-lans-h-Documents-Cursor-transigen/memory/`），一事一檔 + MEMORY.md 索引一行。repo 已記載的事實不要重複寫進記憶。

## 大小上限與精簡時機

- CLAUDE.md 本體 ≤ 150 行，只當索引。超過 → 內容抽到引用檔，索引留一行。
- CLAUDE.md 直接引用的常載檔合計 ≤ 500 行。
- `docs/ops/lessons.md` 超過 30 條 → 派 sonnet 做合併精簡：重複主題合成一條規則；「過時」的判定要有證據：grep 該條目提到的檔名/符號在 src/ 為 0 hits 才可刪，精簡前先備份為 `lessons.md.bak`。
- 任一 ops 檔超過 200 行 → 拆分或精簡（同樣先備份）。

## 改檔安全規則

- 改既有制度檔前先備份：`cp 檔案 檔案.bak`（同目錄）。新內容優先寫新檔。
- 每完成一項就存檔再做下一項；session 隨時可能中斷，存了的才算數。
- 改完 CLAUDE.md 或 ops 檔後，派 fresh-context haiku read-back 驗證（方法見 judgment-rubrics.md#5）。

## 每季（或使用者說「檢查制度」時）的健檢清單

1. `docs/ops/model-dispatch.md` 的型號清單還是現役的嗎？（查官方文件）
2. CLAUDE.md 索引指的路徑全部存在嗎？（一行 shell 驗證所有路徑）
3. lessons.md 有沒有該規則化進 rubrics 的重複教訓？（有 → 問使用者要不要改 rubrics）
4. 制度有沒有被實際遵守？抽查最近 session：派工有沒有帶三要素、驗證是不是 fresh-context。沒被遵守的規則要嘛太難用（回報使用者精簡）要嘛該加強（在 CLAUDE.md 索引提高可見度）。
