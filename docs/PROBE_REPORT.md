# PROBE_REPORT — M0 資料探針結果

- 執行日期：2026-10-03（台灣時間上午；美國時間 10/2，當天無比賽）
- 腳本：`scripts/probe/01-schedule.mjs` 至 `05-seasons.mjs`，共用 `lib.mjs`（單一進行中請求、請求間隔 1.5 秒、回應全數快取到 `fixtures/mlb/raw/`，重跑分析不會再打網路）
- 總請求數：19 次；傳輸量合計 570,526 bytes（gzip 後，以 `content-length` 加總），解壓後 4,620,793 bytes
- 主要夾具：`fixtures/mlb/game-849841.json`，2026 國聯外卡系列賽第 2 戰，費城人 4：3 勇士，**10 局延長賽**
- `fixtures/mlb/` 已列入 `.gitignore`，不提交（DATA_SOURCE 7.2 第 4 點）

## 結論先講

| 問題 | 答案 |
| --- | --- |
| 好球帶逐球落點做得到嗎 | **做得到。** 每一球都有 `pX`／`pZ` 與該打者的好球帶上下緣，297/297 球 |
| 壘包與 B／S／O（第 2 點）做得到嗎 | **做得到。** `linescore` 直接給球數、出局、壘上跑者 |
| 能組出「左外野兩分砲」這種中文事件文字嗎 | **能。** 有事件代碼、擊球方向（守備位置編號）、擊球型態、打點、跑者移動 |
| MLB 有沒有提供隊色 | **沒有。** 要自己維護色表 |
| webview 直接 fetch 會不會被 CORS 擋 | 回應標頭是 `access-control-allow-origin: *`，應該不會。實際 webview 行為留給 M2 驗 |
| 回放可行嗎 | **可行。** `timestamps` 給 514 個時間碼，任一時間碼都能取回當下狀態 |
| 即時延遲 | **未量測。** 探針執行時沒有進行中的比賽 |

## 1. 賽程與賽事類型

`GET /api/v1/gameTypes` 實際回傳：

```
S=Spring Training | R=Regular Season | F=Wild Card | D=Division Series | L=League Championship Series
W=World Series | C=Championship | P=Postseason | A=All-Star Game | I=Intrasquad | E=Exhibition
```

- **2026 外卡系列賽的實際代碼是 `F`**（9/29–10/1 共 9 場，`seriesDescription` 為 "NL Wild Card Series"／"AL Wild Card Series"）。分區系列賽是 `D`。
- 賽程回應每場有 `gamePk`、`gameType`、`status.abstractGameState`（Preview／Live／Final）、`detailedState`、`codedGameState`、`seriesDescription`、`seriesGameNumber`、`gamesInSeries`、`ifNecessary`。季後賽資訊（F10）用賽程端點本身就夠。
- **`hydrate=linescore` 有效**：同一個請求就帶出每場的 `currentInning`、`inningHalf`、`balls`、`strikes`、`outs`、`offense`、`defense`、各局比分。一個請求 50,314 bytes 就涵蓋 6 天 15 場。這表示「點」與「條」兩個尺寸檔位，以及全聯盟比分通知，可能不需要逐場抓 `feed/live`。進行中比賽的 `offense` 是否同樣帶出跑者【未驗證，需等有直播時確認】。

## 2. 球隊

`GET /api/v1/teams?sportId=1`：30 隊，欄位為 `id, name, abbreviation, teamName, locationName, shortName, franchiseName, clubName, teamCode, fileCode, league, division, venue…`。

**沒有任何顏色欄位**（在所有鍵名中搜尋 `colo|hex|rgb`，結果為零）。球隊色表要自己維護。

## 3. 逐場資料 `feed/live`（以 849841 為例）

- 大小：比賽結束時 839,005 bytes，gzip 後 129,512 bytes；第 5 局時 464,346 bytes，gzip 後 65,191 bytes。
- `metaData.wait = 10`：伺服器建議的輪詢間隔是 10 秒。
- 快取標頭：`cache-control: max-age=10, public, stale-while-revalidate=30`，CDN 層本來就快取 10 秒，輪詢比 10 秒密沒有意義。
- 時間碼之間的間隔（514 個）：中位數 16 秒，25 百分位 10 秒，75 百分位 21 秒。

### 3.1 投球（好球帶視窗需要的）

297 顆投球，以下欄位覆蓋率全部 **100%**：

| 欄位 | 用途 | 本場數值範圍 |
| --- | --- | --- |
| `pitchData.coordinates.pX` | 通過本壘板時的水平位置（英尺，0 為本壘板中央） | −2.01 至 2.29 |
| `pitchData.coordinates.pZ` | 通過本壘板時的高度（英尺） | 0.00 至 4.22 |
| `pitchData.strikeZoneTop`／`Bottom` | 該打者的好球帶上下緣（英尺） | 上緣 2.98–3.41，下緣 1.51–1.72 |
| `pitchData.strikeZoneWidth`／`Depth` | 本壘板寬與深（英寸） | 17／8.5 |
| `pitchData.startSpeed` | 球速（mph） | |
| `pitchData.zone` | 落在 1–14 哪一格（九宮格加四個外角） | |
| `details.type.code` | 球種代碼 | FF, FS, SI, SL, CH, FC, ST |
| `details.call.code` | 判定代碼 | B, C, S, F, X, D, E, W, *B, T, M, L |
| `details.isBall`／`isStrike`／`isInPlay` | 好壞球與是否擊出 | |
| `count.balls`／`strikes`／`outs` | 該球之後的球數 | |

另外有 `pitchData.breaks`（轉速、位移）、`pfxX/Z`、初速向量 `vX0/vY0/vZ0`、加速度 `aX/aY/aZ`。若哪天要畫球的飛行軌跡，物理參數是齊的。

打者左右打在 `matchup.batSide.code`（R／L），投手左右投在 `matchup.pitchHand.code`。

### 3.2 擊球

62 次擊出，以下覆蓋率全部 **100%**：

| 欄位 | 用途 | 例 |
| --- | --- | --- |
| `hitData.location` | 擊球方向，以守備位置編號表示 | 1–9 與 `89`（右中間） |
| `hitData.trajectory` | 擊球型態 | `ground_ball`, `line_drive`, `fly_ball`… |
| `hitData.coordinates.coordX/Y` | 落點在球場圖上的座標（像素系） | X 42.56–218.13，Y 41.92–221.07 |
| `hitData.launchSpeed`／`launchAngle`／`totalDistance` | 初速、仰角、距離 | 111.7 mph, 27°, 447 ft |
| `hitData.hardness` | 擊球強度 | `medium`, `hard` |

### 3.3 打席結果與跑者（事件文字需要的）

- `result.eventType`：機器代碼。本場出現 `single, double, home_run, field_out, strikeout, walk, intent_walk, grounded_into_double_play, fielders_choice_out, force_out, sac_bunt, sac_fly`。
- `result.rbi`、`result.awayScore`／`homeScore`、`about.isScoringPlay`、`about.hasOut`。
- `runners[].movement`：`start`／`end`（`null`、`1B`、`2B`、`3B`、`score`）、`isOut`、`outNumber`。
- `runners[].credits[]`：哪個守備位置做了什麼（`LF:f_fielded_ball`、`2B:f_assist`、`1B:f_putout`）。
- `matchup.postOnFirst/Second/Third`：該打席結束後壘上是誰。
- 非投球事件（`playEvents` 中 `isPitch=false`）：`stolen_base_3b`、`pitching_substitution`、`offensive_substitution`、`defensive_switch`、`mound_visit`、`batter_timeout`。盜壘與換投通知可以從這裡取。

實例：英文描述「Kyle Schwarber homers (1) on a fly ball to right center field.」對應的結構化資料為 `eventType=home_run, location=89, trajectory=fly_ball, rbi=1`，足以產生「右中間陽春砲」。`result.description` 是英文整句，**不用它**。

### 3.4 壘包與球數（壘包視窗需要的）

`liveData.linescore` 直接有 `currentInning`、`inningHalf`、`isTopInning`、`balls`、`strikes`、`outs`。

`linescore.offense` 的鍵**只在有人時出現**。實測第 1 局（時間碼 `20260930_182107`）：

```
linescore.offense keys: batter,onDeck,inHole,first,third,pitcher,battingOrder,team
  first: Alec Bohm
  second: (沒有這個鍵)
  third: Bryce Harper
```

`linescore.defense` 有九個守位的球員（`pitcher, catcher, first, second, third, shortstop, left, center, right`）。

### 3.5 投打對決視窗需要的

`liveData.boxscore.teams.{home,away}`：

- `battingOrder`：九棒的球員 id。
- 投手 `stats.pitching`：`numberOfPitches`、`inningsPitched`、`strikeOuts`、`hits`、`earnedRuns`、`summary` 等。
- 打者 `stats.batting`：`atBats`、`hits`、`homeRuns`、`rbi`、`summary` 等；另有 `position`、`jerseyNumber`。

### 3.6 其他

- 2026 年的 ABS 挑戰：`gameData.absChallenges` 有兩隊已用成功／失敗次數與剩餘次數；投球事件有 `reviewDetails`。
- 比賽結束後 `currentPlay` 仍存在，`about.isComplete=true`。

## 4. 回放：`timestamps` 與 `timecode`

- `GET …/feed/live/timestamps`：514 個時間碼，9,253 bytes，從 `20260930_142506` 到 `20260930_211933`。
- 以兩個時間碼取狀態：

```
@20260930_192709: inning=5 Top B0-S0 O0 score 1-1 plays=34 status=Live
@20260930_192800: inning=5 Top B0-S1 O1 score 1-1 plays=34 status=Live
```

  回放（F12）與夾具測試可行。

## 5. `diffPatch`

| 請求 | 解壓後 | gzip 後 |
| --- | --- | --- |
| 整包 `feed/live`（第 5 局） | 464,346 | 65,191 |
| `diffPatch`，相鄰兩個時間碼 | 7,563 | 1,308 |
| `diffPatch`，跨 3 個時間碼 | 28,224 | 3,419 |

回應是陣列，每個元素為 `{ diff: [...] }`，裡面是標準 JSON Patch（`op`、`path`、`value`）。

推算（輸入都是上表的實測值，未在直播中驗證）：一場 3 小時的比賽每 10 秒輪詢一次約 1,080 次。整包輪詢的傳輸量約落在 1,080 × 65–130 KB；改用 `diffPatch` 約 1,080 × 1.3 KB。**建議第一次取整包，之後用 `diffPatch`。** 直播時 `diffPatch` 只給 `startTimecode`、不給 `endTimecode` 的行為【未驗證】。

## 5.1 `diffPatch` 一定要給終點（2026-10-03 補測）

前面推算假設「只給 `startTimecode`」就能拿到到現在為止的差異。實測（849841，已結束的比賽）不是這樣：

| 請求 | 回應 | gzip 後 |
| --- | --- | --- |
| `diffPatch?startTimecode=<最後一個時間碼>` | 整包 feed | 129,318 |
| `diffPatch?startTimecode=<倒數第三個>`（不給終點） | 整包 feed | 129,318 |
| `diffPatch?startTimecode=X&endTimecode=X`（同一個） | 整包 feed | 129,318 |
| `feed/live/timestamps` | 514 個時間碼 | 1,461 |
| `feed/live?fields=metaData,timeStamp,wait` | `{"metaData":{"wait":10,"timeStamp":"20260930_211903"}}` | 80 |

所以輪詢改成兩段：
1. 先送心跳 `feed/live?fields=metaData,timeStamp,wait`，約 80 bytes，回傳最新時間碼。
2. 時間碼沒變就不再發請求；變了才送 `diffPatch?startTimecode=<我們的>&endTimecode=<最新>`。§5 已驗證這種寫法會回差異。

兩球之間大多數的輪詢只花一次心跳。直播中這套方式的實際表現，留待直播量測（§8）。

## 6. CORS

所有回應都帶：

```
access-control-allow-origin: *
access-control-allow-credentials: true
access-control-allow-methods: GET, POST, PUT, DELETE, OPTIONS
```

帶 `Origin: http://tauri.localhost` 送出時同樣回 `*`。純 GET 不帶自訂標頭屬於簡單請求，不會觸發預檢。所以 webview 直接 fetch 應該可行，抓取不一定要放在 Rust 端。**M2 已在 Tauri（WebView2 154）內驗證可行**：選場清單直接從 webview 抓到當天 4 場賽程，CSP 只開放 `connect-src https://statsapi.mlb.com`。

## 7. 各賽季資料完整度

每季抽一場例行賽，單場樣本：

| 賽季 | gamePk | 投球落點 pX/pZ | 球速、球種 | 擊球座標 | 擊球初速 | 擊球方向 | 跑者移動 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026 | 849841 | 100% | 100% | 100% | 100% | 100% | 有 |
| 2015 | 414921 | 100% | 100% | 100% | 86.3% | 100% | 有 |
| 2008 | 235127 | 99.7% | 99.7% | 100% | 0% | 97.4% | 有 |
| 2007 | 69405 | 0% | 0% | 100% | 0% | 100% | 有 |
| 2005 | 23885 | 0% | 0% | 100% | 0% | 100% | 有 |

- 好球帶落點：2008 起有。2007 的樣本沒有，但 PITCHf/x 在 2007 是逐步安裝，單場樣本不足以斷定整季。
- 擊球初速：2015 起有（Statcast）。
- 壘包、球數、比分、擊球方向：2005 樣本就齊全。
- 回放舊比賽時，好球帶視窗要能優雅地顯示「此場無落點資料」。

## 7.1 球隊賽程、先發投手與系列賽狀態（2026-10-03 補測）

腳本 `scripts/probe/06-team-schedule.mjs`，一個請求：

```
GET /api/v1/schedule?sportId=1&teamId=143&startDate=2026-09-20&endDate=2026-10-10&hydrate=probablePitcher,seriesStatus
-> 200, 21,507 bytes, 10 場
```

- `teamId` 篩選有效。
- `teams.{away,home}.probablePitcher` 有先發投手。
- `seriesStatus` 欄位：`gameNumber, totalGames, isTied, isOver, wins, losses, description, shortDescription, result, shortName, abbreviation`。
- 實例：費城人 10/1 的 `seriesStatus` 為「ATL wins 2-1」、`isOver=true`；到 10/10 為止沒有其他費城人的賽程，可以據此判定淘汰。
- 時區：`gameDate` 是 UTC（例如 `2026-10-02T00:00:00Z`），`officialDate` 是美國當地日期（`2026-10-01`），顯示時要換算成使用者時區。

## 7.3 M5：季後賽、先發、淘汰判定（2026-10-03 補測）

腳本 `scripts/probe/11-postseason.mjs`（看欄位）與 `scripts/probe/12-schedule-fixtures.mjs`（存成測試夾具，不提交）。賽程請求一律 `hydrate=team,linescore,seriesStatus,probablePitcher`：

```
GET /api/v1/schedule?sportId=1&date=2026-10-03&hydrate=...          -> 200, 14,319 bytes, 4 場（分區系列賽第 1 戰）
GET /api/v1/schedule?sportId=1&teamId=143&startDate=...&endDate=...  -> 200, 41,974 bytes
GET /api/v1/schedule/postseason/series?sportId=1&season=2026         -> 200, 67,204 bytes, 11 個系列
GET /api/v1/seasons/2027?sportId=1                                   -> 200, 830 bytes
```

- `gameType`：`R` 例行賽、`F` 外卡、`D` 分區、`L` 聯盟冠軍、`W` 世界大賽。
- `seriesStatus`：`gameNumber`、`totalGames`、`wins`、`losses`、`isTied`、`isOver`、`shortName`（分區賽是 `ALDS`，外卡賽是 `NL Wild Card Series`，不是縮寫）、`shortDescription`（`ALDS Game 1`）、`result`（`ATL wins 2-1`，只有英文）。`wins`／`losses` 是領先那一隊的，誰領先看 `winningTeam`／`losingTeam` 的 id（只有 id，沒有縮寫）。
- 淘汰判定的實例：費城人最後一場 849844（外卡第 3 戰）`isOver=true`、`losingTeam=143`，之後沒有任何排定的比賽。洋基同一天有分區系列賽第 1–5 戰（含視需要才打的場次）。天使最後一場是例行賽，之後沒有比賽：沒打進季後賽。
- 先發投手：`teams.{away,home}.probablePitcher.fullName`，賽前就有（ATL@LAD 當時客隊還沒公布）。
- 之後幾輪的對戰在賽程上以佔位隊伍出現（「AL High」「NL Low」之類），不是真的球隊，選隊時要濾掉。
- 下一季開幕：`/api/v1/seasons/2027` 的 `regularSeasonStartDate` 是 `2027-03-25`。
- 直播中賽程的 `linescore.offense`（壘上跑者）仍未驗證：量測時沒有比賽在打。計分板有就畫、沒有就不畫。

## 7.2 重播節奏（849841 的真實時間戳）

| 間隔 | 次數 | 中位數 | 25–75 百分位 | 最大 |
| --- | --- | --- | --- | --- |
| 同打席的兩球之間 | 212 | 19.7 秒 | 16.7–22.6 | 63 |
| 打席之間 | 65 | 36.7 秒 | 32.9–48.9 | 183 |
| 換半局 | 19 | 165.9 秒 | 162.9–166.9 | 306 |

第一球到最後一球 182.5 分鐘（官方 `gameDurationMinutes` 為 183）。各種重播節奏見 `src/data/replay/pacing.ts`。

## 8. 沒做到的項目

| 項目 | 原因 | 何時補 |
| --- | --- | --- |
| 即時延遲、與轉播的落差 | 探針執行時無進行中比賽 | 分區系列賽期間（2026-10-03 起，美國時間）跑一次直播量測 |
| 直播中 `diffPatch` 的實際用法 | 同上 | 同上 |
| 直播中賽程 `hydrate=linescore` 是否帶跑者 | 同上 | 同上 |
| Tauri webview 內的 fetch | 尚無 Tauri 專案 | M2 |

## 9. 對資料模型的影響

已回寫到 `ARCHITECTURE.md` §3 與 §4.2。重點：

- `GameState.bases` 由 `linescore.offense.first/second/third` 是否存在決定，可帶跑者 id。
- `pitch` 事件加入 `pX`、`pZ`、`szTop`、`szBottom`、`zone`、`batSide`。
- `ballInPlay` 事件加入 `location`（守備位置）、`trajectory`、`hardness`，讓事件文字能在地化。
- 新增 `stolenBase`、`pitchingChange` 事件，來源為非投球的 `playEvents`。
- 輪詢間隔以 `metaData.wait` 為準（實測 10 秒），不寫死。
