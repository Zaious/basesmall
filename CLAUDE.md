# CLAUDE.md — Basesmall 專案說明（給 Claude Code 與貢獻者）

> **Basesmall** — *Baseball, but small.* 名稱與 tagline 不含 MLB；MLB 只出現在說明文字與標籤裡。

## 一句話

一個浮在桌面角落的抽象棋子賽場：用 MLB 公開的事件資料，讓愛棒球、但上班不能看直播的人，不打擾工作也能維持「你那隊正在打」的在場感。開源、免費、全部在使用者本機執行。

## 文件導覽

| 檔案 | 內容 |
| --- | --- |
| `docs/ARCHITECTURE.md` | 技術架構、資料模型、模組介面、里程碑與驗收標準 |
| `docs/DATA_SOURCE.md` | MLB 資料端點、欄位、已知限制、使用條款與本專案的做法 |
| `docs/PROBE_REPORT.md` | M0 探針的實測結果 |
| `styles/README.md` | 風格檔的格式與撰寫指南 |

## 文件中的標記

- **【已決定】** 維護者已拍板，不要重新討論。
- **【建議】** 提案，尚未拍板。可以替換，但請說明理由。
- **【待決】** 沒有答案。需要時直接問維護者，不要自行假設。
- **【未驗證】** 來自文件或社群程式碼，沒有實際打過 API 確認。動工前先驗證。

## 工作規則

1. **先驗證再回報。** 資料欄位名稱、端點行為一律以實際回應為準，不要憑文件或記憶假設。
2. **渲染層不得接觸 MLB 原始 JSON。** 資料先經 `src/data/mlb/` 轉成 `src/model/types.ts` 的標準化狀態與事件，再交給動畫與渲染。
3. **每個功能都做成開關。** 【已決定】預設值給合理選擇，使用者自行調整。
4. **做得更少，而不是更像。** 【已決定】每個功能先問：它是否讓一秒鐘的餘光更有用，同時不讓畫面更像在看球？抽象棋子用基本幾何體、良好材質與克制的打光即可，不為「豐富感」增加建模、粒子或後製。
5. **不做的事。** 【已決定】不做 AI 解說、不做伺服器端、不做商業化功能：App 裡沒有贊助連結，對外連結只有專案網站與原始碼（2026-10-04 起；Buy Me a Coffee 在專案網站頁尾、repo 的 README 與 Sponsor 按鈕，見 `docs/DATA_SOURCE.md` 7.2）。「關於」頁的「編年史記工作室 ChronicleCore Studio 出品 · 作者 Zaious」是純文字署名，不加連結；工作室連結只在專案網站首頁頁尾（README 的工作室署名不加連結，只有作者名連到研究者網站 zaious.dev，PRD §3.2.6；不要把工作室連結加回去）；不碰影像或轉播、不使用聯盟與球隊的 logo、字樣、背號或整套球衣的重現。隊色與簡單圖樣（例如洋基的細條紋）可以用，放在 `styles/team-colors/mlb.json`。
6. **不要從其他專案複製程式碼**，除非先確認授權相容。可以參考它們的架構想法。
7. **資料用量要節制。** 輪詢要有節流與退避，同一時間只保留一個進行中的請求。不提交任何 MLB 回應（`fixtures/mlb/` 已列入 `.gitignore`）。
8. 遇到【未驗證】或【待決】的事項卡住實作時，先停下來問，不要靠猜。
9. **測試對官方數字，不對自己算的數字。** 轉換層的驗收是拿夾具對照 MLB 的 linescore 與 boxscore（`tests/timeline.test.ts`）。

## 語言

- `docs/` 的文件用繁體中文撰寫；README 與 `styles/README.md` 用英文。
- 程式碼、識別字、commit message 用英文。
- UI 支援繁體中文與英文，字串從一開始就抽成可翻譯的資源檔，見 `docs/ARCHITECTURE.md` 4.9。

## 開發

```bash
npm install
node scripts/probe/07-fixtures.mjs   # 夾具：幾場已結束的比賽，存進 fixtures/mlb/（不提交）
npm test
npm run typecheck
```

`src/` 用 `.ts` 副檔名 import、不用參數屬性，所以 Node 24 可以直接執行原始碼（例如 `node scripts/m1-report.ts`）。
