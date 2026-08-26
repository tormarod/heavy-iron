# Graph Report - heavy-iron  (2026-08-26)

## Corpus Check
- 17 files · ~86,830 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 342 nodes · 851 edges · 17 communities (15 shown, 2 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.87)
- Token cost: 98,624 input · 0 output

## Community Hubs (Navigation)
- jsQR Decoder Library
- Block & Profile State Actions
- Docs, Config & CI
- App Constants & Defaults
- Logged Sets & CSV Export
- Calculator, Chart & QR Encoder
- Volume & Plan Management
- QR Sharing & Display
- Profile Setup & Export
- Rest Timer & Audio Alerts
- Block Import & AI Prompt
- Default Block Data
- Smoke Tests
- Ask Dialog
- Toast & Backup Nag
- Sheet Navigation
- Service Worker Caching

## God Nodes (most connected - your core abstractions)
1. `drawApp()` - 37 edges
2. `slot()` - 21 edges
3. `num()` - 18 edges
4. `decode()` - 17 edges
5. `getProfile()` - 16 edges
6. `loadProfileFromText()` - 16 edges
7. `dayList()` - 15 edges
8. `applyQrPayload()` - 15 edges
9. `migrate()` - 14 edges
10. `mark()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Offline and installing (service worker, home screen)` --conceptually_related_to--> `Heavy Iron app icon (maskable barbell icon)`  [INFERRED]
  README.md → icon.svg
- `index.html app shell` --references--> `Heavy Iron app icon (maskable barbell icon)`  [EXTRACTED]
  index.html → icon.svg
- `Passing data with the camera (QR)` --references--> `qrSheet dialog (Compartir por QR)`  [INFERRED]
  README.md → index.html
- `Estimated one-rep max (Epley formula)` --references--> `chartSheet dialog (Progreso, Peso/1RM est.)`  [INFERRED]
  README.md → index.html
- `Warm-ups and plate maths (calculator)` --references--> `calcSheet dialog (Calculadora, Barra/Máquina)`  [INFERRED]
  README.md → index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CSP-scoped vendored QR script loading** — index_csp, readme_content_security_policy, js_vendor_readme_overview, js_vendor_readme_qrcode_js, js_vendor_readme_jsqr_js [INFERRED 0.85]
- **CACHE_VERSION bump enforcement pattern** — readme_cache_version, _github_workflows_test_cache_version, _github_workflows_test_workflow [EXTRACTED 1.00]
- **README feature sections mapped 1:1 to index.html dialogs** — readme_qr_transfer, readme_warmup_calculator, readme_weekly_volume, readme_first_run_setup, readme_importing_blocks_json, readme_block_manager, index_qr_sheet, index_calc_sheet, index_volume_sheet, index_setup_sheet, index_import_sheet, index_blocks_sheet [INFERRED 0.85]

## Communities (17 total, 2 thin omitted)

### Community 0 - "jsQR Decoder Library"
Cohesion: 0.07
Nodes (38): binarize(), BitMatrix(), BitStream(), buildFunctionPatternMask(), computeDimension(), countBlackWhiteRun(), countBlackWhiteRunTowardsPoint(), decode() (+30 more)

### Community 1 - "Block & Profile State Actions"
Cohesion: 0.08
Nodes (53): applyImportedBlock(), applyQrPayload(), applyTheme(), ask(), blockDate(), blockFromNormalized(), blockPickerLabel(), buildDayBox() (+45 more)

### Community 2 - "Docs, Config & CI"
Cohesion: 0.06
Nodes (37): Deploy to GitHub Pages (workflow), cache-version job (enforces CACHE_VERSION bump), smoke job (Playwright browser tests), Smoke tests (workflow), Heavy Iron app icon (maskable barbell icon), index.html app shell, blocksSheet dialog (Gestionar bloques), calcSheet dialog (Calculadora, Barra/Máquina) (+29 more)

### Community 3 - "App Constants & Defaults"
Cohesion: 0.06
Nodes (33): ACCENT_LABEL, ACCENTS, calcDraft, CRC32_TABLE, DEFAULT_BAR_WEIGHT, DEFAULT_PLATES, DEFAULT_STACK_INC, DELOAD_PHASE (+25 more)

### Community 4 - "Logged Sets & CSV Export"
Cohesion: 0.11
Nodes (32): blockLoggedSets(), blockShareLog(), buildCsv(), countBackupSets(), countShareLog(), csvCell(), drawApp(), dropKind() (+24 more)

### Community 5 - "Calculator, Chart & QR Encoder"
Cohesion: 0.13
Nodes (21): bestByExercise(), bestSet(), buildBarSVG(), buildChartSVG(), collectHistory(), collectHistoryAll(), drawCalc(), drawChart() (+13 more)

### Community 6 - "Volume & Plan Management"
Cohesion: 0.20
Nodes (22): blockSharePlan(), blockShareRir(), blockTagsFor(), blockWeeks(), buildQrPayload(), clampInt(), currentDay(), dayList() (+14 more)

### Community 7 - "QR Sharing & Display"
Cohesion: 0.18
Nodes (13): blockDoneSets(), buildQrSVG(), bytesToB64u(), crc32(), drawQr(), drawQrShow(), loadScriptOnce(), qrDecoderReady() (+5 more)

### Community 8 - "Profile Setup & Export"
Cohesion: 0.20
Nodes (11): accentOf(), countProfileSets(), openSetup(), profileExportPayload(), profileKeys(), renderProfileExports(), renderProfiles(), renderSetup() (+3 more)

### Community 9 - "Rest Timer & Audio Alerts"
Cohesion: 0.27
Nodes (10): beep(), nudgeRest(), primeAudio(), releaseWakeLock(), requestWakeLock(), startAlarmLoop(), startRest(), stopAlarmLoop() (+2 more)

### Community 10 - "Block Import & AI Prompt"
Cohesion: 0.27
Nodes (10): blocksBase(), buildAiPrompt(), copyBlockPrompt(), copyText(), downloadBlockTemplate(), downloadFile(), loadRepoBlockList(), openImportSheet() (+2 more)

### Community 11 - "Default Block Data"
Cohesion: 0.33
Nodes (6): DEFAULT_DAYS_PAREJA, DEFAULT_DAYS_TU, DEFAULT_PHASE_PAREJA, DEFAULT_PHASE_TU, defaultState(), freshBlock()

### Community 13 - "Ask Dialog"
Cohesion: 0.50
Nodes (4): askText(), closeAsk(), openAsk(), tell()

### Community 14 - "Toast & Backup Nag"
Cohesion: 0.50
Nodes (4): hideToast(), maybeNagBackup(), registerServiceWorker(), toast()

### Community 15 - "Sheet Navigation"
Cohesion: 0.50
Nodes (4): openBlockManager(), openChart(), openQr(), openSheet()

## Knowledge Gaps
- **52 isolated node(s):** `expandedSetup`, `MUSCLE_SUGGESTIONS`, `PATTERN_SUGGESTIONS`, `TYPE_SUGGESTIONS`, `MUSCLE_BY_ID` (+47 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `num()` connect `Calculator, Chart & QR Encoder` to `Block & Profile State Actions`, `App Constants & Defaults`, `Logged Sets & CSV Export`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `num()` (e.g. with `.mod()` and `.multiply()`) actually correct?**
  _`num()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `expandedSetup`, `MUSCLE_SUGGESTIONS`, `PATTERN_SUGGESTIONS` to the rest of the system?**
  _52 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `jsQR Decoder Library` be split into smaller, more focused modules?**
  _Cohesion score 0.074034902168165 - nodes in this community are weakly interconnected._
- **Should `Block & Profile State Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.08490566037735849 - nodes in this community are weakly interconnected._
- **Should `Docs, Config & CI` be split into smaller, more focused modules?**
  _Cohesion score 0.05855855855855856 - nodes in this community are weakly interconnected._
- **Should `App Constants & Defaults` be split into smaller, more focused modules?**
  _Cohesion score 0.05555555555555555 - nodes in this community are weakly interconnected._