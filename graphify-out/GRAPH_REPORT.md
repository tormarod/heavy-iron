# Graph Report - heavy-iron  (2026-08-26)

## Corpus Check
- 21 files · ~89,241 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 360 nodes · 782 edges · 24 communities (16 shown, 8 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6c5abacd`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- jsQR.js
- toast
- Heavy Iron (project overview)
- app.js
- drawApp
- num
- block-editor.js
- drawQrShow
- openSetup
- startRest
- renderProfileExports
- data.js
- smoke.js
- applyQrPayload
- _this
- profile-transfer.js
- sw.js
- migrate
- CLAUDE.md
- mark
- .tmp_check.js
- .tmp_check2.js
- .tmp_repro.js
- .tmp_repro2.js

## God Nodes (most connected - your core abstractions)
1. `drawApp()` - 37 edges
2. `slot()` - 21 edges
3. `num()` - 19 edges
4. `decode()` - 17 edges
5. `Heavy Iron (project overview)` - 14 edges
6. `drawQrShow()` - 13 edges
7. `blockWeeks()` - 12 edges
8. `rowUsed()` - 12 edges
9. `drawChart()` - 12 edges
10. `applyQrPayload()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Offline and installing (service worker, home screen)` --conceptually_related_to--> `Heavy Iron app icon (maskable barbell icon)`  [INFERRED]
  README.md → icon.svg
- `index.html app shell` --references--> `Heavy Iron app icon (maskable barbell icon)`  [EXTRACTED]
  index.html → icon.svg
- `Deleting blocks you no longer want (Gestionar)` --references--> `blocksSheet dialog (Gestionar bloques)`  [INFERRED]
  README.md → index.html
- `Warm-ups and plate maths (calculator)` --references--> `calcSheet dialog (Calculadora, Barra/Máquina)`  [INFERRED]
  README.md → index.html
- `Estimated one-rep max (Epley formula)` --references--> `chartSheet dialog (Progreso, Peso/1RM est.)`  [INFERRED]
  README.md → index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CACHE_VERSION bump enforcement pattern** — readme_cache_version, _github_workflows_test_cache_version, _github_workflows_test_workflow [EXTRACTED 1.00]
- **CSP-scoped vendored QR script loading** — index_csp, readme_content_security_policy, js_vendor_readme_overview, js_vendor_readme_qrcode_js, js_vendor_readme_jsqr_js [INFERRED 0.85]
- **README feature sections mapped 1:1 to index.html dialogs** — readme_qr_transfer, readme_warmup_calculator, readme_weekly_volume, readme_first_run_setup, readme_importing_blocks_json, readme_block_manager, index_qr_sheet, index_calc_sheet, index_volume_sheet, index_setup_sheet, index_import_sheet, index_blocks_sheet [INFERRED 0.85]

## Communities (24 total, 8 thin omitted)

### Community 0 - "jsQR.js"
Cohesion: 0.07
Nodes (38): binarize(), BitMatrix(), BitStream(), buildFunctionPatternMask(), computeDimension(), countBlackWhiteRun(), countBlackWhiteRunTowardsPoint(), decode() (+30 more)

### Community 1 - "toast"
Cohesion: 0.33
Nodes (6): flushSave(), hideToast(), maybeNagBackup(), registerServiceWorker(), snapshotForUndo(), toast()

### Community 2 - "Heavy Iron (project overview)"
Cohesion: 0.06
Nodes (37): Deploy to GitHub Pages (workflow), cache-version job (enforces CACHE_VERSION bump), smoke job (Playwright browser tests), Smoke tests (workflow), Heavy Iron app icon (maskable barbell icon), index.html app shell, blocksSheet dialog (Gestionar bloques), calcSheet dialog (Calculadora, Barra/Máquina) (+29 more)

### Community 3 - "app.js"
Cohesion: 0.06
Nodes (34): ACCENT_LABEL, ACCENTS, ask(), askText(), calcDraft, closeAsk(), CRC32_TABLE, DEFAULT_BAR_WEIGHT (+26 more)

### Community 4 - "drawApp"
Cohesion: 0.10
Nodes (43): blockShareLog(), blockSharePlan(), blockShareRir(), blockTagsFor(), blockTonnageByWeek(), blockWeeks(), buildCsv(), buildQrPayload() (+35 more)

### Community 5 - "num"
Cohesion: 0.11
Nodes (31): bestByExercise(), bestSet(), buildBarSVG(), buildChartSVG(), collectHistory(), collectHistoryAll(), currentDay(), drawCalc() (+23 more)

### Community 6 - "block-editor.js"
Cohesion: 0.13
Nodes (30): applyImportedBlock(), blockDate(), blockFromNormalized(), blockPickerLabel(), buildAiPrompt(), buildDayBox(), buildExRow(), closePlanEditor() (+22 more)

### Community 7 - "drawQrShow"
Cohesion: 0.17
Nodes (13): blockDoneSets(), blockLoggedSets(), buildQrSVG(), bytesToB64u(), crc32(), drawQrShow(), loadScriptOnce(), qrDecoderReady() (+5 more)

### Community 8 - "openSetup"
Cohesion: 0.29
Nodes (8): accentOf(), openSetup(), profileKeys(), renderProfiles(), renderSetup(), setNote(), soloMode(), visibleProfileKeys()

### Community 9 - "startRest"
Cohesion: 0.32
Nodes (8): beep(), nudgeRest(), primeAudio(), requestWakeLock(), startAlarmLoop(), startRest(), stopAlarmLoop(), tick()

### Community 10 - "renderProfileExports"
Cohesion: 0.29
Nodes (7): downloadFile(), profileExportPayload(), renderProfileExports(), resetBackupNag(), setsLabel(), setsWithDoneLabel(), showRecovery()

### Community 11 - "data.js"
Cohesion: 0.33
Nodes (6): DEFAULT_DAYS_PAREJA, DEFAULT_DAYS_TU, DEFAULT_PHASE_PAREJA, DEFAULT_PHASE_TU, defaultState(), freshBlock()

### Community 13 - "applyQrPayload"
Cohesion: 0.28
Nodes (9): applyQrPayload(), countShareLog(), importIdMaps(), muscleTag(), normalizeImportedLog(), normalizeImportedRir(), patternTag(), txt() (+1 more)

### Community 15 - "profile-transfer.js"
Cohesion: 0.50
Nodes (7): countBackupSets(), countProfileSets(), describeBackupProblem(), describeProfileProblem(), loadProfileFromText(), restoreFromText(), wireProfileTransfer()

### Community 17 - "migrate"
Cohesion: 0.24
Nodes (11): applyTheme(), clampNum(), emptyBlock(), genericPhase(), load(), migrate(), readRaw(), render() (+3 more)

### Community 19 - "mark"
Cohesion: 0.22
Nodes (11): closeQr(), closeSetup(), closeSheet(), drawQr(), mark(), openQr(), qrReceiver(), save() (+3 more)

## Knowledge Gaps
- **57 isolated node(s):** `{ chromium }`, `{ chromium }`, `{ chromium }`, `{ chromium }`, `expandedSetup` (+52 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `num()` connect `num` to `migrate`, `app.js`, `drawApp`, `_this`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `rowUsed()` connect `drawApp` to `app.js`, `profile-transfer.js`, `applyQrPayload`, `drawQrShow`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `countBackupSets()` connect `profile-transfer.js` to `drawApp`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `num()` (e.g. with `.mod()` and `.multiply()`) actually correct?**
  _`num()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `{ chromium }`, `{ chromium }`, `{ chromium }` to the rest of the system?**
  _57 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `jsQR.js` be split into smaller, more focused modules?**
  _Cohesion score 0.074034902168165 - nodes in this community are weakly interconnected._
- **Should `Heavy Iron (project overview)` be split into smaller, more focused modules?**
  _Cohesion score 0.05855855855855856 - nodes in this community are weakly interconnected._