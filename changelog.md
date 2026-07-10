# Changelog

## 1.9.0

### Added
- **Relink Missing Audio** — File menu and Settings workflow to scan a folder by filename and repair broken cue paths in `cues.json`
- **Missing media indicators** on cue cards in playback and edit mode (desktop + web remote) with **MISSING** badge and striped overlay
- Launch warning when missing audio is detected, with shortcut to open the relink dialog
- **Periodic missing-media rescan** every 30 seconds (updates badges if a folder goes offline mid-show)
- Settings → **Workspace & Media → Relink Missing Audio…**
- **Windows in-app updates** via `electron-updater` (opt-in only: Help → Check for Updates; download and install each require confirmation; skipped versions are ignored until a newer release)
- `audioRelinkUtils.js`, `missingMediaMonitor.js`, `updateCheckUtils.js`, `autoUpdaterService.js`, and `relinkMissingAudioUI.js`

### Changed
- **Check for Updates** now targets `alanimedia/acCompanimentAlt` GitHub Releases (Mac/Linux/dev still open the releases page)
- Remote cue payloads include `mediaMissing` for live badge sync after relinks or offline detection

### Fixed
- Relink dialog auto-closes when all files resolve successfully instead of showing an empty success screen

## 1.8.0

### Added
- Post-fader **output level meter** on the Electron header (vertical VU + dBFS) with master volume slider
- **Per-cue level meters** on cue buttons (zone-style VU, dBFS, peak-hold) visible only while playing
- Global **Show cue meter** default and per-cue **Show cue meter** override in properties and web remote
- `audioOutputDiagnostics.js`, `audioLoudnessMeter.js`, `cueMeterDisplay.js`, and `cueMeterVisibility.js` for meter rendering and loudness
- **Crossfade mode** toggle on web remote with state sync to Electron
- Remote header **Master Vol** vertical slider and aligned vertical output VU on iPad-friendly playback strip
- Remote **fade-out / fade-in** countdown and orange styling during crossfade and normal fades
- **Configured vs output volume** separation so per-cue volume persists after fade-out and crossfade
- Cue **preview** button support on playback cards, edit cards, and web remote
- `cueMonitorPreview.js` and `cuePreviewButton.js` for monitor/preview routing

### Changed
- Brighter per-cue volume sliders on cue cards and web remote waveform lanes
- Web remote header layout: single-row playback strip (Master Vol + VU, XFADE, WAVE, Stop) tuned for iPad
- IPC playback updates send `configuredVolume` and `outputVolume` separately for accurate remote UI
- Crossfade fade-out/fade-in state forwarded to web remote via standard fade IPC fields
- Main waveform panel volume slider uses configured cue level, not live fade level

### Fixed
- Output meter bar scale mismatch (linear mask vs dBFS zones) causing inaccurate readings
- Double volume scaling on playback meters (analyser is already post–master-gain)
- LUFS readout during test tone using peak-derived loudness
- Crossfade fade display missing on web remote (outgoing cue orange countdown)
- Per-cue volume resetting to 100% after fade-out or crossfade
- Web remote waveform lane volume slider fighting playback sync on iPad touch
- Duplicate `normalizeShowButtonWaveformOverride` in `remoteEditUtils.js` causing startup crash

## 1.7.1

### Added
- Second audio output (Monitor/Preview) with separate device selection in app config
- Optional live show playback mirror to the monitor output (`routeShowPlaybackToMonitor`)
- `audioOutputRouting.js` and `playbackMonitorOutput.js` for WaveSurfer preview routing and Howl monitor sync

### Changed
- Web remote cue trigger and stop-all send immediately (removed 300ms debounce and 500ms client lock)
- Play/pause/stopped status pushed to web remote as soon as the audio engine reports it, not only on time ticks
- Server-side duplicate remote trigger guard reduced from 400ms to 150ms
- Stop All on web remote clears playing/paused button state optimistically

## 1.7.0

### Added
- Workspace-aware audio path resolution so cues with basename-only paths play correctly after Electron 31+ path restrictions
- **Replace…** browse button in cue properties to pick audio files via native dialog (preserves cue settings; trim resets only when the file path changes)
- Visible filename display for the assigned audio file path in properties
- Bulk-edit fields in properties when multiple cues are selected
- Trim badge braces on edit cards and web remote (grey when inactive)
- `remoteCuePropWaveform.js` module for remote properties waveform handling
- `audioPathCompareUtils`, `droppedFileUtils`, and `cueTrimBadgeUtils` helpers

### Changed
- Edit-mode cue drag-reorder uses grid-aware insertion with stable gap placeholders (smoother mid-section drops and a larger end-of-section drop zone)
- Edit-card color swatch updates apply immediately without full grid rebuild
- Web remote properties sidebar scroll and horizontal color swatch layout
- Web remote trim handles on cue property waveforms

### Fixed
- Newly dropped or assigned audio files failing to play when only the filename was stored
- `show-open-dialog` IPC handler missing from modular IPC setup
- Audio file path field collapsed or invisible in properties until focused
- Bottom main waveform panel staying on the first selected cue until play/stop
- Duplicate waveform lanes on web remote from concurrent lane creation
- File drag-drop from OS using `webUtils.getPathForFile` instead of unreliable `.name` fallback
- Cue paths normalized on workspace load/save via `audioPathUtils`

## 1.6.0

### Added
- Distinct fade-out-and-stop retrigger icon (shaded-corner stop SVG)
- Loop (∞) toggle on edit cue cards in Electron and web remote
- Shared retrigger and loop indicator badges on playback buttons, edit cards, and web remote
- Edit-card color swatches: preset row plus bottom row with custom picker and seven recent custom colors
- Click-to-select edit cue cards (click again to deselect; Ctrl/Cmd and Shift range multi-select)

### Changed
- Cue retrigger behavior now inherits the global app default unless a cue has an explicit override (`null` = use default)
- Cue properties and web remote use **Use app default** for retrigger, matching button waveform overrides
- Retrigger settings show descriptive help text for each option and an expandable legend (global settings, per-cue properties, and web remote)
- Every cue button always shows its effective retrigger behavior icon (app default or cue override)
- Fade-out-and-stop uses cue fade-out, then default cue fade-out, then Stop All fade time (no longer skips to Stop All when default fade-out is set)
- Saved app configuration now syncs to the audio engine immediately (fade-out and retrigger timing apply without restart)
- Retrigger icons remain visible on stopped custom-color cue buttons
- Retrigger icons use a consistent crossfade image with drop-shadow on all playback states
- Playback, edit, and web-remote cue cards are square (1:1 aspect ratio)
- Edit-mode cue cards use inline color swatches and settings cog; selection checkbox removed
- Hold **` / ~** while in edit mode temporarily shows playback buttons again
- Web remote edit cards: drag handle moved to bottom row with reorder and loop controls

### Fixed
- `fade_out_and_stop` retrigger fade duration now respects default cue fade-out before falling back to Stop All fade time
- Legacy `retriggerAction` fields no longer override cues set to **Use app default**
- Per-cue retrigger override no longer reverts to **Use app default** when the selected behavior matches the global default
- Edit cue card click selection and tilde peek playback after edit-card refactor
- Web remote drag handle overlapping color swatches on edit cards
- Blue selection outline restored on selected edit cue cards in Electron

## 1.5.8

### Fixed
- Web remote bottom-panel waveform lanes lingering after playback stops or cues enter `cued` state
- Stale playing state restored on cue sync causing waveforms to reappear when idle
- Playhead drawn on web remote waveforms when nothing is actively playing

## 1.5.7

### Added
- GitHub Actions release workflow building installers for Windows (x64/ARM64), macOS (universal), and Linux (deb/AppImage x64/ARM64)
- GitHub Releases publish config for in-app auto-updates

### Changed
- Companion WebSocket broadcasts cues in grid layout order with v2 sections/layout payload
- Companion WebSocket supports seek, prepare seek, and live volume actions

### Fixed
- Playback time and playhead freeze after waveform seek (inverted `lastSeekPosition` pinning)
- Time-update interval stopping during scrub/seek handoff
- Main waveform panel playhead sync after seek (pointer capture, scrub prep, sync reset)

## 1.5.6

### Added
- Hold **\`** (backquote) in Edit mode for temporary playback peek without leaving edit
- Shift+click range selection on edit-mode cue cards
- Live volume slider on edit-mode cue cards (Electron)
- Drag auto-scroll and gap placeholder helpers for smoother cue card reordering

### Changed
- Cue card drag/reorder only enabled in persisted Edit mode; waveform and volume controls no longer trigger drag
- Bottom panel and properties waveform use direct pointer handlers for seek/scrub instead of WaveSurfer event coupling

### Fixed
- Waveform seek pausing playback on Electron (scrub-mute/onpause race; skipScrubMute seek path)
- Bottom panel single-click seek and scrub blocked during playhead sync
- Web remote waveform lanes stuck in seeking state after scrub
- Cue-button waveform seek regressions after drag/reorder work
- Playhead IPC using lastSeekPosition when Howler seek report lags

## 1.5.5

### Added
- **Live volume** control during playback on main waveform panel, properties sidebar, cue-button waveforms, and web remote lanes
- **Waveform seek/scrub** during playback on Electron (main panel, properties, cue buttons) and web remote (pointer drag with prepare/finalize scrub)
- Remote HTTP/WebSocket actions: `prepare_seek`, `seek_cue`, `set_cue_volume`
- IPC channels for remote-driven seek and volume from main process

### Changed
- Volume-only cue saves use silent disk write (no `all_cues` broadcast) to avoid disrupting remotes during live mixing
- Web remote patches cue buttons in place on metadata-only `all_cues` updates instead of full grid rebuild

### Fixed
- Web remote cue button flashing between green and custom color when adjusting live volume on waveform lanes
- Seek audio glitch on web/iPad (~0.25–0.5s of old audio before jump) via mute-on-down and coalesced scrub seeks

## 1.5.4

### Added
- Web remote **WAVE** toolbar toggle matching Electron: manual on/off for the bottom waveform panel
- Close button on remote waveform panel header

### Changed
- Remote waveform panel uses a fixed bottom overlay with reserved grid padding when enabled (no layout shift)
- Waveform panel no longer auto-opens when playback starts; lanes update only while the panel is toggled on
- Remote scroll position preserved when cues update during playback

## 1.5.3

### Added
- Collapsible **cue sections** on Electron and web remote with v2 workspace layout (`sections` + `layout` in `cues.json`)
- Section drag reorder in edit mode (all cues in a section move together); full header click to expand/collapse
- Multi-select cues in edit mode (Ctrl/Cmd+click, Ctrl/Cmd+A) with bulk delete via toolbar or Delete/Backspace
- Multi-select drag: moving one selected cue moves the whole selection between sections
- Drag existing cues and new file drops into specific sections (Electron + remote)
- `cueGridSections.js` and `cueLayoutUtils.js` for section UI and layout repair/migration

### Changed
- Section headers use a single light grey bar (no separate dark divider line); styling matched on Electron and remote
- Section titles editable only in persisted edit mode (not show/playback mode)
- Remote `reorder_cues` accepts `layout` payloads; reorder buttons bind after DOM insert

### Fixed
- Electron grid blank after sections refactor (duplicate exports / syntax error in `cueGrid.js`)
- Adding cues to a section no longer collapses layout to a single "Cues" section (broadcast full workspace snapshot)
- Global file drop handler no longer intercepts in-grid cue drags
- Remote invalid reorder request when saving section layout from web UI

## 1.5.2

### Added
- Remote **Playback / Edit** mode toggle with per-cue editing (name, volume, color, reorder) and global settings panel
- WebSocket write actions from remote clients: `update_cue`, `reorder_cues`, `update_config`, `get_cue_detail`, `delete_cue`
- `remoteEditUtils.js` for patch sanitization, cue merge, and config snapshots
- Touch-friendly reorder on iPad: ◀ ▶ buttons, long-press drag, per-card settings cog
- Live volume meter beside playing cues on remote (matches Electron cue grid)
- Volume percentage on remote waveform lane headers during playback

### Changed
- Remote waveform panel uses a thin drag handle for resize (removed +/− size buttons)
- Remote edit cards use a two-row volume layout to prevent text overflow on narrow screens
- Waveform lane rendering caches static bars and redraws only the playhead to reduce flicker

### Fixed
- Multi-cue remote waveform panel flashing on desktop from scrollbar/layout feedback loops
- iOS Safari viewport clipping for bottom waveform panel (`100dvh`, safe-area insets)
- Remote cue saves now merge patches before write (prevents full cue replacement data loss)

## 1.5.1

### Added
- Waveform playhead sync during playback in properties sidebar, expanded editor, and remote UI
- Resizable main waveform panel below cue grid with stacked lanes for simultaneous playback (WAVE toolbar toggle)
- Shared waveform peaks service and HTTP API for remote clients (`/api/cues/:cueId/waveform-peaks`)
- Mini waveform strips on cue buttons (Electron grid and remote) with playhead progress
- Global default **Show waveform on cue buttons** in App Config → Main Display
- Per-cue button waveform override: Use app default / Always show / Always hide
- Remote cue payload improvements: `buttonColor`, trim times, progress ratios, and formatted cue broadcasts

### Changed
- Remote Web UI uses bottom multi-lane waveform panel matching Electron main UI
- Cue save broadcasts enriched remote-formatted cue data instead of raw cue objects

### Fixed
- Cue grid failed to render after waveform config helper refactor (`isInitialized` regression)
- Main-process crash when syncing button waveform fields to remote (`appConfigManager` scope)
- Config save loop when applying app configuration updates

## 1.5.0

### Added
- Per-cue button color with `buttonColor` field persisted in cue data
- Color picker in cue properties: preview box (opens custom picker), 8 neon preset swatches, and 8 recent custom colors
- Automatic text contrast on custom-colored cue buttons (black text on bright backgrounds via WCAG luminance threshold 0.5)
- `recentButtonColors` in app config to remember recently used custom colors across sessions

### Changed
- Properties sidebar scrolls correctly so lower fields are no longer cut off
- Selecting a recent custom color moves it to the front of the recents list
