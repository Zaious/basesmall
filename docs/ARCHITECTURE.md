# ARCHITECTURE — Basesmall

標記說明見 `CLAUDE.md`。文中的「PRD §x」指維護者的產品需求文件，該文件不公開；本文件已收錄實作所需的決定。本文件的技術選型多數是【建議】，使用者沒有明確拍板，可以替換，但請說明理由。

## 1. 技術棧【建議】

| 層 | 選擇 | 理由 |
| --- | --- | --- |
| 桌面殼 | Tauri v2 | 透明、無邊框、置頂、點擊穿透皆可做到；記憶體占用比 Electron 小，適合長時間掛著。 |
| 前端 | TypeScript + Vite | 一般選擇。 |
| 3D | three.js（可選 react-three-fiber） | 棋子用基本幾何體即可，不需要重型引擎。 |
| 資料抓取 | webview 端 fetch 或 Rust 端皆可 | M0 實測回應帶 `access-control-allow-origin: *`，CORS 應該不擋（`PROBE_REPORT.md` §6）。放哪一邊改由多視窗的狀態擁有者決定（4.6）。Tauri 內實際行為 M2 驗證。 |
| 設定儲存 | App data 目錄下的 JSON | 簡單，使用者可讀。 |

## 2. 資料流

```
MLB Stats API
   │  (本機直接請求，不經任何自建伺服器)
   ▼
[Fetcher]  Rust 端：輪詢、節流、退避、單一進行中請求
   ▼
[Adapter]  MLB 原始 JSON → 標準化 GameState 與 GameEvent
   ▼
[GameStore]  目前狀態 + 事件佇列
   ├──▶ [AnimationQueue] ──▶ [Renderer: three.js]
   ├──▶ [Audio]  訂閱事件，觸發音效
   └──▶ [UI/HUD]  比分、局數、設定面板

[Settings]  所有開關，持久化
[WindowManager]  置頂、透明、穿透、位置、大小
```

**原則**：Renderer、Audio、UI 永遠看不到 MLB 的原始 JSON，只看標準化後的狀態與事件。換資料源時只換 Adapter。

## 3. 標準化資料模型（草案）

```ts
type GameStatus = 'scheduled' | 'pregame' | 'live' | 'delayed' | 'final' | 'postponed' | 'suspended';
type Base = '1B' | '2B' | '3B';

interface GameState {
  gamePk: number;
  status: GameStatus;
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  balls: number;
  strikes: number;
  bases: { '1B'?: PlayerRef; '2B'?: PlayerRef; '3B'?: PlayerRef };  // linescore.offense.first/second/third，有人才有鍵
  score: { home: number; away: number };
  teams: { home: TeamRef; away: TeamRef };
  batter?: PlayerRef & { side: 'L' | 'R' };      // matchup.batSide.code
  pitcher?: PlayerRef & { hand: 'L' | 'R' };     // matchup.pitchHand.code
  atBatPitches: PitchMark[];                     // 本打席已投的球，好球帶視窗用
  lastEvent?: GameEvent;
}

interface PitchMark {
  n: number;                        // 本打席第幾球
  pX?: number; pZ?: number;         // 英尺；2008 以前的比賽沒有
  szTop?: number; szBottom?: number;
  zone?: number;                    // 1–14
  call: 'ball' | 'strike' | 'foul' | 'inPlay';
  pitchType?: string;               // FF、SL…，顯示名稱由 i18n 對照
  speed?: number;                   // mph
}

type GameEvent =
  | { type: 'pitch'; pitch: PitchMark }
  | { type: 'ballInPlay'; location?: string; trajectory?: string; hardness?: string;
      coordX?: number; coordY?: number; launchAngle?: number; exitVelocity?: number; distance?: number }
  | { type: 'plateAppearance'; result: string; rbi: number }      // result = MLB eventType 原碼，文字由 i18n 模板產生
  | { type: 'runnerAdvance'; runner: PlayerRef; from: Base | 'batter'; to: Base | 'home' | 'out' }
  | { type: 'scoreChange'; side: 'home' | 'away'; runs: number }
  | { type: 'stolenBase'; runner: PlayerRef; to: Base | 'home' }
  | { type: 'pitchingChange'; side: 'home' | 'away'; pitcher: PlayerRef }
  | { type: 'inningChange'; inning: number; half: 'top' | 'bottom' }
  | { type: 'gameEnd'; winner: 'home' | 'away' | 'tie' };
```

欄位來源與覆蓋率見 `PROBE_REPORT.md`（2026-10-03 實測）。直播中的行為尚未驗證，見該報告 §8。

**M1 實作後以程式碼為準**：型別在 `src/model/types.ts`，MLB 轉換在 `src/data/mlb/timeline.ts`。與上方草案的差異：事件多了 `automaticCall`（自動壞球）、`runnerPlaced`（延長賽自動跑者、代跑）、`baserunning`（盜壘、暴投、牽制等）、`plateAppearance`（打席結果，文字由 i18n 模板產生）；狀態多了安打、失誤、逐局比分、投手用球數、打者今日成績。

## 4. 模組與介面

### 4.1 GameSource（資料源 adapter）

```ts
interface GameSource {
  listGames(date: string, opts?: { gameTypes?: string[] }): Promise<GameSummary[]>;
  subscribe(gamePk: number, onState: (s: GameState) => void, onEvent: (e: GameEvent) => void): Unsubscribe;
}
```

- `MlbLiveSource`：輪詢真實資料。
- `MlbReplaySource`：讀取已結束比賽或本地夾具，逐事件重播。只需抓一次整包 `feed/live`（本機快取），節奏由 `playEvents[].startTime` 決定，支援原速、緊湊（壓縮空檔）、每球固定秒數、只看結果四種（PRD §3.3）。
- 即時比賽中途加入的「快轉追上」：先用 ReplaySource 的「只看結果」播到最新，再接回 LiveSource。
- 之後想接其他聯盟，只需實作這個介面。【建議】

### 4.2 輪詢策略【建議，數值待實測】

- 逐場即時資料：輪詢間隔以回應的 `metaData.wait` 為準（實測 10 秒），不寫死；CDN 本身快取 10 秒，更密沒有意義。
- 第一次取整包 `feed/live`。之後每次輪詢先送心跳 `feed/live?fields=metaData,timeStamp,wait`（約 80 bytes），時間碼變了才送 `diffPatch?startTimecode=…&endTimecode=…`（相鄰時間碼約 1.3 KB）。`diffPatch` 不給終點會回整包，所以一定要給（`PROBE_REPORT.md` §5、§5.1）。實作在 `src/data/mlb/live-source.ts`。直播中的實測【待量測】。
- 官方事後改判（已送出的打席內容變了）：只更新狀態，不重播事件。新半局的打者已站上打擊區但還沒投球時，補一筆「打席開始」狀態（event -2），換局只宣告一次。
- 小尺寸檔位（點、條）只需要比分、球數、出局、壘上：可能只靠賽程端點加 `hydrate=linescore` 就夠，不必抓逐場資料。直播中是否帶出跑者【未驗證】。
- 賽程與全聯盟計分板：輕量、低頻輪詢；計分板收起時暫停。
- 只追一場時，不要輪詢其他場的逐球資料。
- 所有請求：單一進行中、指數退避、加入抖動，並在視窗隱藏或最小化時降頻。
- 推播 websocket 只有一份實驗性 PR 的證據【未驗證】，第一版以輪詢為主。
- 原型的通知有「只通知我追蹤的球隊」開關。若關掉它，其他場只用一個賽程請求（帶 linescore）偵測比分變化與開賽、終場，不逐場輪詢；代價是拿不到其他場全壘打等細節。【建議】賽程端點能否帶出 linescore【未驗證】。

### 4.2.1 FollowController：決定現在看哪一場【建議】

- 輸入只有賽程端點一個請求（`teamId`、`hydrate=linescore,probablePitcher,seriesStatus`，M0 已驗證）。輸出是「現在該跟哪一場、為什麼」。
- 狀態：主隊比賽中 → 跟；主隊今天稍後有比賽 → 開賽前；主隊今天沒比賽 → 休息日；主隊淘汰或沒打進 → 依使用者選的後備規則（PRD §3.3）。
- 絕不在一場比賽進行中自動換台；換場只發生在目前這場結束時，或使用者點了「改看這場」。
- 只有被選中的那一場會輪詢 `feed/live`；其他場只靠賽程請求。

### 4.3 AnimationQueue

- 事件進佇列，依序播放，順序要符合因果：投球 → 揮棒 → 球飛行 → 跑者移動 → 比分變化。不要讓計分板先跳、畫面才追上。
- 資料是事件式的，不是逐幀追蹤。野手使用名義站位；擊球用擊球座標與仰角產生拋物線；跑者在已知壘包狀態之間補間。
- 佇列落後太多時要有追趕機制（加速或略過細節動畫），以最終狀態為準。
- 動畫風格化，不假裝寫實跑動。

### 4.4 Renderer

- Renderer 由風格提供，介面見 4.8。（2026-10-03 改寫：原為俯瞰全場與投打小劇場兩種攝影機。）
- 棋子用基本幾何體（圓片、圓柱、球、車床面）；材質、打光、環境貼圖要克制。【已決定：不往更精緻的方向推】
- 視窗隱藏或失焦時降低或暫停繪製。

### 4.5 Audio

- 訂閱 GameEvent，每種音效獨立開關，另有總靜音。
- 音效素材要用授權清楚的來源（CC0 或自行製作），並在專案中記錄來源。

### 4.6 WindowManager

- 透明、無邊框、置頂；可拖曳、可縮放；點擊穿透可切換；記住位置、大小與所在螢幕。
- 平台差異：透明視窗與穿透在 Windows、macOS、Linux 的支援不一，【未驗證】，M2 要實測。
- 置頂視窗不會蓋過獨佔全螢幕的應用程式，這是已知限制，文件中要註明。
- 【已決定】一個主視窗就能看比賽。原型的其他視窗（好球帶、壘包、投打對決、逐局比分、通知、跑馬燈）全部是選配，各自記住位置與開關。
- GameStore 只能有一個擁有者（Rust 端，或一個隱藏的主 webview），由它廣播給各視窗，不能讓每個視窗各自輪詢。【建議】M2 決定放哪一邊。

**主視窗尺寸檔位**【已決定】

視窗尺寸決定細節層級，使用者拖曳邊框時內容自動換檔，不另設「模式」。用 container query 判斷，不看視窗類型。

| 檔位 | 高度 | 最小寬度 | 參考尺寸 | 內容 |
| --- | --- | --- | --- | --- |
| 點 | 未滿 44 | 150 | 168×28 | 兩隊色點與比分、▲▼局數、迷你菱形、出局點（寬度不足 168 時先省略出局點） |
| 條 | 44–109 | 240 | 480×64 | 原型的控制條，加上迷你菱形與最近一則事件文字（寬度不足 300 時先省略事件文字） |
| 場 | 110–249 | 300 | 480×160 | 左側膠囊（比分、局數與出局、球數、投手）、中間壘包與球隊色棋子與擊球軌跡、右側好球帶與本打席落點；事件從上方冒泡 |
| 全 | 250 以上 | 300 | 480×340 | 再加投打對決（投手用球數、打者今日成績）與逐局比分 |

場與全在寬度不足 340 時省略好球帶。選配視窗的開關、音效、設定收在滑鼠移上去才出現的選單裡，不佔條的寬度。【已決定】2026-10-03 使用者看過模擬後定案。

**背景模式**【已決定：可切換透明；三段為建議】

- 實底、半透明、全透明三段。
- 全透明時桌面圖案會在底下，文字一律放在小膠囊底色裡（同放置遊戲角落的數字），棋子保留描邊，場地只畫一條地面線或菱形線。
- 透明區域能不能讓滑鼠點穿到底下的視窗，各平台不同【未驗證】。Tauri 能整窗切換是否忽略滑鼠，逐像素判斷要實測；做不到就用「滑過才出現拖曳把手」替代。

### 4.7 Settings

- 單一 JSON schema，帶版本號以便日後遷移。
- 最少包含：追蹤球隊、各視窗位置與大小及開關、風格、背景模式、各音效開關、總靜音、計分板開關、低調模式、熱鍵、語言、通知方式與事件、重播節奏（預設 `compact`）、重播選場是否顯示比分（預設否）、主隊淘汰後的後備規則（預設 `manual`，即「我自己挑」）。

### 4.8 風格模組（Style）【已決定：每種風格是一個可切換的檔案；介面為建議】

使用者的決定（PRD §3.1）：所有風格都是可以切換的檔案，內建的平面、2.5D 也一樣；開源後邀請他人實作。3D 只是其中一個可選風格。

風格分兩種：

| 種類 | 內容 | 例子 | 載入方式【建議】 |
| --- | --- | --- | --- |
| 資料風格 | 一份 JSON：色彩 token、棋子形狀、厚度、描邊、陰影、版面參數。交給內建的平面或 2.5D renderer 解讀 | 暗夜、白晝、黑白棋盤、半透明極簡 | 可在執行時從使用者的風格資料夾載入 |
| 程式風格 | 一個 JS 模組，自己實作 renderer | 3D（three.js）、像素風 | 只在建置時打包，社群以 PR 貢獻 |

**草案已落地（2026-10-03）**：資料風格的格式定義在 `src/styles/manifest.ts`（含驗證器，文字對面板的對比度要達 4.5），內建的 `styles/flat.json`、`styles/iso.json` 同時是範例，撰寫指南在 `styles/README.md`。棋子顏色一律用球隊色，不由風格決定。格式在 M3 renderer 完成時定案。

程式風格不開放從磁碟任意載入：一個會自動執行下載來的腳本的桌面程式，就是一個安全漏洞。資料風格沒有這個問題。

```ts
interface StyleManifest {
  id: string;
  name: { en: string; 'zh-Hant': string };
  kind: 'data' | 'code';
  renderer?: 'flat' | 'iso';          // 資料風格：交給哪個內建 renderer
  theme: ThemeTokens;                 // 背景、面板、文字、accent
  piece: { shape: 'dot' | 'disc'; thickness: number; rim: boolean; shadow: 'none' | 'soft' };
}

interface StyleRenderer {
  mount(el: HTMLElement, ctx: { tier: SizeTier; background: BackgroundMode }): void;
  update(view: FieldView): void;              // 標準化後的畫面狀態，看不到 MLB 原始 JSON
  play(event: GameEvent): Promise<void>;      // AnimationQueue 依序呼叫，等它播完再播下一個
  resize(w: number, h: number, tier: SizeTier): void;
  dispose(): void;
}
```

- 同一份棋子 token，平面 renderer 忽略 thickness，2.5D 畫一個下移的橢圓當側面（同原型 `.ck-w`）。
- 平面與 2.5D 用 SVG 繪製；只有選了 3D 風格才載入 three.js。靜止的 SVG 不需要持續重繪，預期比常駐 WebGL 省資源。（未量測，M2 後驗證。）
- M6 附一份「如何新增風格」的短文件，內建風格本身就是範例。

**球隊色**【已決定】

- 棋子用球隊色。MLB API 沒有隊色欄位（`PROBE_REPORT.md` §2）。色表在 `styles/team-colors/mlb.json`，取自 colorr（MIT，來源標示見同目錄 `NOTICE.md`），只用色碼，不用 logo。每隊有 `piece`（棋子色）與 `alt`（撞色時的替代色），可手動調整。
- 兩隊棋子色太接近時（OKLab 距離低於 0.12）：主隊保留原色，另一隊改用 `alt`；兩隊都不是主隊時，客隊改色。
- 棋子與背景對比不足時自動加描邊。全透明背景下底色無法預知，所以一律加描邊。
- 【建議】攻守交換時，本壘上的打者棋子用黑白棋的翻面動畫，從客隊色翻成主隊色，一個旋轉就表達半局結束。

### 4.9 多語系【已決定：繁體中文與英文；以下細節為建議】

- UI 字串放在 `src/i18n/zh-Hant.json` 與 `src/i18n/en.json`，程式碼不寫死任何顯示文字。
- 通知與跑馬燈的事件文字，由 GameEvent 套語系模板產生，不直接顯示 MLB 回應裡的英文描述，否則中文介面會混進整句英文。代價是中文描述能多細，取決於結構化欄位：例如「左外野兩分砲」需要事件類型、擊球方向與打點。M0 已確認這些欄位齊全（`eventType`、`hitData.location`、`trajectory`、`rbi`），§3 的 GameEvent 已據此擴充。
- 中文隊名用手動維護的對照表。球員姓名保留英文原文，不自行音譯。

## 5. 目錄結構

```
/
├─ src/
│  ├─ model/             GameState / GameEvent 型別、GameStore
│  ├─ data/mlb/          MLB 原始資料型別與轉換（timeline.ts）
│  ├─ data/replay/       重播節奏、播放器、MlbReplaySource
│  ├─ render/            平面／2.5D（SVG）與 3D（three.js）renderer（M3）
│  ├─ i18n/              zh-Hant.json、en.json、事件文字模板（M3）
│  ├─ audio/             音效管理（M4）
│  └─ ui/                HUD、設定面板、計分板、通知
├─ src-tauri/            Rust：視窗、抓取、設定（M2）
├─ styles/               風格檔（每個風格一個 JSON）、撰寫指南、球隊色表
├─ tests/                vitest 測試
├─ fixtures/             已結束比賽的 JSON 夾具（不提交，用 scripts/probe/07-fixtures.mjs 產生）
├─ scripts/probe/        資料探針與夾具錄製腳本
└─ docs/                 本文件、資料來源、探針報告
```

## 6. 測試策略

- **夾具回放**：錄下數場已結束比賽的完整資料，包含一場季後賽、一場延長賽，作為 Adapter 與動畫佇列的確定性測試。
- **Adapter 單元測試**：對夾具逐步餵入，斷言輸出的 GameState 與事件序列。
- **完整回放煙霧測試**：腳本把一整場比賽跑完，檢查沒有例外、最終比分正確。
- **視窗行為**：各平台手動檢查清單（透明、置頂、穿透、拖曳、重啟後位置還原）。

## 7. 實作順序【建議】

每個里程碑都有驗收標準，達成後再往下。

**M0 — 資料探針與回放夾具**
- 寫探針腳本，驗證 `DATA_SOURCE.md` 列出的端點與欄位。
- 錄下數場已結束比賽的夾具。
- 驗收：回報實際欄位、粒度與延遲；夾具檔案可被後續步驟讀取。

**M1 — 標準化模型與 Adapter**【完成 2026-10-03】
- 實作 GameState、GameEvent、GameStore、MlbReplaySource。
- 驗收：對夾具回放，輸出的事件序列與比賽實際經過相符。
- 實際驗收方式：6 場夾具（2026 季後賽延長賽、2026 例行賽 12 局含自動跑者與失誤、2015、2008、2007、2005）逐項對照 MLB 官方數字：最終得分、安打、失誤、逐局得分、每個打席結束後的壘上跑者、每個打席結束的出局數、每位投手的用球數、每位打者的打數與安打。另測事件因果順序、半局宣告、時間戳單調、四種重播節奏、播放器的暫停／跳轉／倍速、GameStore 收到的事件序列。共 76 項測試。
- 代碼總表（2026-10-03 補）：`src/data/mlb/codes.ts` 把 MLB 自己的總表逐一歸類，包括事件類型 74 種、投球與自動判決代碼 39 種、比賽狀態 210 種。`tests/codes.test.ts` 會檢查每個代碼都恰好歸一類，而且和 MLB 標的旗標一致；MLB 新增代碼時測試會失敗。狀態新增 `review`（挑戰與重播審查）、`cancelled`。
- 實戰覆蓋：另挑 18 場 2026 年比賽（延長賽、再見安打、因雨提前結束、延賽後補賽、大比分差、1:0、雙重賽、季後賽），連同原本 6 場共 24 場、1,893 個打席、7,346 球全部通過對帳。`node scripts/census.ts` 統計實際遇過的代碼：事件類型 74 種中 43 種、投球與自動判決代碼 30 種中 16 種；沒遇過的（三殺、投手犯規、盜本壘、妨礙、計時器自動好球等）目前只靠歸類表處理。
- 官方 linescore 校正：最後一筆狀態（終場，或直播中的現在）以 feed 的 linescore 為準。原因有兩個：有些失誤（例如界外飛球掉球）在逐球資料裡完全沒有紀錄；比賽因雨提前結束時，沒打完的半局不計分。
- 實作中發現並修正的資料陷阱：同一跑者一球多段移動、打者移動列在既有跑者之前、第三個出局的投球層出局數少 1、代跑換人、延長賽自動跑者（`runner_placed`，不在跑者移動清單裡）、敬遠的自動壞球（`no_pitch`）、一段時間戳倒退的打席。

**M2 — 浮動視窗與最小視圖**【Windows 部分完成 2026-10-03；直播實測待分區系列賽】
- Tauri 視窗行為（透明、置頂、拖曳、縮放、穿透）+ 只顯示文字比分的最小視圖，接 MlbLiveSource。
- 驗收：能追一場即時比賽或回放；各平台實測視窗行為並記錄差異；量測基準資源占用。

實作：
- `src-tauri/`：Tauri 2.12、window-state 外掛（只記位置與大小）、系統匣選單（顯示／隱藏、滑鼠穿透、置頂、背景模式、結束）。命令列參數 `--game=<pk> [--mode=replay]` 可直接開一場。
- `src/ui/`：選場清單（直播中／稍後／已結束，不顯示比分）、一行文字比分條。按住空白處拖曳，右下角縮放。
- `src/data/mlb/live-source.ts`：心跳加差異的輪詢，見 4.2。

Windows 11 實測（release 版，執行檔 3.13 MB；PowerShell 以 Win32 API 檢查並截取視窗區域）：

| 項目 | 結果 | 方法 |
| --- | --- | --- |
| 無邊框 | 是。視窗保留 WS_CAPTION 樣式但不繪製標題列 | 截圖 |
| 透明圓角 | 是，圓角外露出後方桌面 | 截圖 |
| 置頂 | 是（WS_EX_TOPMOST） | GetWindowLong |
| 記住位置與大小 | 是：搬到 (300,220)、改成 520×180 後正常關閉，重開回到同位置同大小；存檔為實體像素（150% 縮放下 780×270） | SetWindowPos／GetWindowRect／`%APPDATA%\io.github.zaious.basesmall\.window-state.json` |
| WebView2 內直接 fetch MLB | 可以，CORS 與 CSP 都不擋 | 視窗標題 `Basesmall · picker · 2026-10-03 · 4 games` |
| 重播 | 照緊湊節奏前進：第 130 秒標題變成 PHI 1-0，與時間軸推算的約 120 秒相符 | 視窗標題 |
| 直播模式開已結束的比賽 | 一次載入即顯示終場，停止輪詢 | 視窗標題 |
| 拖曳、右下角縮放、滑鼠穿透、背景模式切換 | 未自動驗證（需要實際滑鼠操作），待人工確認 | — |
| macOS、Linux | 未測（沒有機器） | — |

資源基準（Windows 11，WebView2 154，程式 + 6 個 msedgewebview2 子程序）：

| 狀態 | 私有記憶體 | 工作集合計 | CPU |
| --- | --- | --- | --- |
| 選場清單，閒置 30 秒 | 164 MB | 367 MB（含共用頁面重複計算） | 0.03 s／30 s，單核 0.1% |
| 重播進行中 60 秒 | 167 MB | — | 0.41 s／60 s，單核 0.7% |

記憶體幾乎都是 WebView2（程式本身約 29 MB）。M3 加上 SVG 棋盤與動畫後要再量一次。

**第一輪試用後的修正（2026-10-03）**：

| 問題 | 修正 |
| --- | --- |
| 視窗太小時選場清單只剩標題列，新手不會想到拉大 | 每個畫面各自記住大小：選主隊與選場清單至少 200 高（預設 480×300），比分條預設 480×64。視窗以隱藏狀態啟動，尺寸調好才顯示，不會閃。window-state 外掛只記位置 |
| 點了比賽不知道怎麼操作 | 進比賽畫面時控制項先顯示 4 秒再收進滑鼠移上去的選單；重播有播放／暫停、速度（1／2／4／8 倍）、跳到下一個結果 |
| 看不出是重播 | 「重播 · 日期」頁籤 |
| 開頭一分鐘沒有變化，像當掉 | 每一球顯示一行小字（球種、球速、判定），打席結束才換成結果 |
| 第一次啟動沒有主隊 | 選主隊畫面（30 隊加「不指定」）；主隊的比賽排第一並加星號；撞色時主隊保留原色 |
| 比分條塞不下 | 改成原型控制條的兩行版面：比分一行，局數、球數、出局一行 |

**頁籤列**：比賽畫面的比分條上方固定有一條 20 高的列。左邊是頁籤：比賽經過時間（直播：第一球到現在；重播：當時的時間戳；終場：官方比賽長度，不含延誤）與重播標籤，各自可用 × 關掉。右邊是控制項，只在滑鼠移上去時（以及開場 4 秒）出現。控制項原本浮在比分條上，會擋住壘包與事件文字，使用者試用時指出後移到這裡。這條列一直存在，所以開關頁籤不必改變視窗大小；沒有頁籤時它是透明的。

**設定的保存**：主隊、背景、頁籤開關目前存在 WebView2 的 localStorage。正常結束會保存（實測：選主隊、正常關閉、重開即進選場清單）；行程被強制結束時，最近的變更可能遺失。M4 改存成設定檔。

**投球計時器**：公開資料沒有計時器倒數（全欄位搜尋 clock、timer 皆無），不做。

**M3 — 棋子賽場與風格接縫**
- 風格載入機制、內建平面與 2.5D 風格、球隊色、主視窗尺寸檔位與背景模式、事件動畫、追趕機制。3D 風格不在本里程碑。
- 驗收：回放一整場延長賽，畫面與狀態一致，無明顯卡頓。

**M4 — 音效與設定面板**
- 安打、全壘打音效，所有開關，設定持久化。
- 驗收：開關即時生效、重啟後保留。

**M5 — 全聯盟計分板、季後賽、低調模式**
- 計分板可開關；點選可切換主視圖；季後賽賽程篩選；低調模式與隱藏熱鍵。
- 驗收：同一個視窗內可切換比賽；季後賽比賽可正確顯示。

**M6 — 對外發布準備**
- README、GIF、安裝檔、資料聲明、授權、如何新增聯盟/主題的短文件。
- 驗收：全新環境照 README 能一個指令跑起來。

## 8. 風險與待驗證

- Webview 直接呼叫 MLB：M0 標頭顯示允許任意來源，M2 在 Tauri 內確認。
- 各平台透明視窗與點擊穿透的行為差異。
- 即時資料延遲與欄位完整性，是否足以支撐擊球動畫。
- 長時間掛機的記憶體趨勢。
