# AV Cueboard — User Guide

Live audio cue software for **Bitfocus Companion** and **Elgato Stream Deck**.

> **AV Cueboard v1.10.3** · [Releases](https://github.com/alanimedia/avcueboard/releases) · [Companion module](https://github.com/bitfocus/companion-module-alanimedia-avcueboard)

---

## Main window layout

```
┌──────────────┬─────────────────────────────────────────────────────────┐
│  Settings    │  AV Cueboard    [Playback] [Edit]   Master│VU│XFADE│WAVE│Stop│
│  (gear)      ├─────────────────────────────────────────────────────────┤
│              │  ┌─ Section: Intro ─────────────────────────────────┐   │
│              │  │  [Cue] [Cue] [Cue]  …                            │   │
│              │  └──────────────────────────────────────────────────┘   │
│              │  ┌─ Waveform panel (WAVE) ──────────────────────────┐   │
│              │  │  stacked lanes while cues play                   │   │
│              │  └──────────────────────────────────────────────────┘   │
└──────────────┴─────────────────────────────────────────────────────────┘
                                                      Cue Properties →
```

| Area | What it does |
|------|----------------|
| **Settings** (gear, left) | App-wide defaults: audio routing, fades, waveforms, remote, relink |
| **Playback / Edit** (top center) | Switch between show mode (trigger cues) and layout editing |
| **Master Vol + VU** | Post-fader main output level; vertical meter with dBFS readout |
| **XFADE** | Crossfade mode — only one cue at a time; switching cues crossfades |
| **WAVE** | Show/hide the resizable waveform panel below the grid |
| **Stop** (“Don’t Panic”) | Emergency **Stop All** |
| **Cue grid** | Square cue cards in collapsible **sections** |
| **Cue Properties** (right) | Opens when you select a cue in Edit mode |

---

## Playback vs Edit mode

| Mode | Cue cards | Typical use |
|------|-----------|-------------|
| **Playback** | Red-tinted; click to trigger | During a show |
| **Edit** | Gray; drag, color, rename, reorder | Building the cue sheet |

**Edit mode shortcuts**

| Action | How |
|--------|-----|
| Select one cue | Click the card |
| Multi-select | **Ctrl/Cmd+click**; **Shift+click** for a range |
| Delete selected | Toolbar **Delete Selected** or **Delete/Backspace** |
| Peek playback while editing | Hold **\`** (backtick) or **~** |
| Open properties | Select cue(s) — sidebar opens on the right |
| Reorder cues | Drag cards; drop between sections |
| Move a section | Drag the section header (all cues in section move) |
| Add audio | Drag files onto the grid or into a section |

---

## Cue cards (what you see on each button)

While **playing**, each card can show:

- **Status** (top-left) — idle, playing, paused, cued next
- **Loop** (∞) when enabled
- **Retrigger** icon (always visible — reflects app default or per-cue override)
- **Ducking** indicator when this cue ducks or is ducked
- **Level meter** — zone-style VU + dBFS (per Settings default or per-cue override)
- **Mini waveform** — optional strip with playhead (Settings or per-cue override)
- **Preview** (♪) — routes preview audio to **Monitor / Preview** output
- **MISSING** badge — audio file not found (see [Relink](#relink-missing-audio))

In **Edit mode**, cards also show inline **color swatches**, **loop** toggle, and a **settings** cog.

---

## Cue Properties sidebar

Opens when you select cue(s) in Edit mode. Changes save automatically when you close the sidebar or switch cues.

### Single-cue fields

| Field | Description |
|-------|-------------|
| **Name** | Label on the button and in Companion |
| **Type** | Single file or playlist |
| **Button Color** | Preset swatches, custom picker, recent colors; text contrast auto-adjusts |
| **Level meter** | Use app default / always show / always hide while playing |
| **Button waveform** | Mini strip on the cue card |
| **Audio File** | **Replace…** opens native file picker; path shown below |
| **Waveform** | Trim in/out points; drag handles or skip buttons; **expand** for full editor |
| **Fade In / Out** | Milliseconds |
| **Loop** | Repeat single-file cue |
| **Retrigger behavior** | Override global default; see legend in sidebar |
| **Volume** | 0–1 configured level (live mixing uses waveform sliders during playback) |
| **Ducking** | Mark cue as trigger and/or ducking target; set duck level % |

### Playlist cues

- Ordered item list, **Shuffle**, **Repeat current item**
- **Advance behavior** — continue to next item, or stop and cue next

### Bulk edit

Select multiple cues to edit shared fields: **button color**, **loop**, **retrigger**, **fade in**, **fade out**.

### Waveform trim

- Drag region handles or use the **{** / **}** in/out buttons
- Trim saves automatically; **{ }** trim badges show when trim is active
- **Expanded waveform editor** (bottom panel) for precise edits
- Mouse on the waveform (Cue Properties and expanded editor):
  - **Wheel** — zoom in/out
  - **Shift+wheel** or **tilt wheel** — pan left/right when zoomed
  - **Ctrl/Cmd+wheel** — scrub the playhead
  - **Double-click** — reset zoom
  - **Drag** — seek; drag edge handles for in/out
- During **playback**, drag the waveform playhead to **seek**; volume slider adjusts **live level**
- Waveform peak data is cached under the app **user data** folder (`waveform-cache/`), not next to your audio files. On workspace load, existing `*.peaks.json` sidecars beside cue media are moved into that cache and removed when possible.

---

## Settings sidebar (gear icon)

Changes save automatically.

### Audio Outputs

| Setting | Description |
|---------|-------------|
| **Show / Main Output** | FOH / primary interface; **Test** tone + vol + VU + LUFS |
| **Monitor / Preview Output** | Headphones or second interface for preview |
| **Mirror live playback to monitor** | Triggered cues play on both outputs |

### Cue Defaults (This Workspace)

Saved in your workspace folder at **`.ac/config/appConfig.json`** (not inside `cues.json`). When you change these, they persist with the workspace on reload.

| Setting | What it affects |
|---------|-----------------|
| Fade in / out, loop | **New cues** only |
| **Default retrigger behavior** | New cues + any cue whose Properties say **Use app default** |
| Stop All / crossfade time | Workspace-wide playback behavior |

**Important:** This does **not** rewrite existing cues that already have their own retrigger override in Properties. Those cues keep their per-cue setting; only the badge/icon for “app default” cues follows this dropdown.

When you first open an older workspace that never had `.ac/config/`, AV Cueboard copies your **global** app defaults into the workspace config (instead of resetting to Restart).

**No workspace open** (Untitled): these fields save to global `%APPDATA%\AV Cueboard\appConfig.json` instead.

### Playback & Stop All

| Setting | Description |
|---------|-------------|
| **Stop All behavior** | Hard stop or fade-out-and-stop |
| **Stop All fade out** | Duration when fade-out-and-stop is selected |
| **Crossfade time** | Duration when **XFADE** toolbar mode is on |

### Display & Waveforms

| Setting | Description |
|---------|-------------|
| **Show waveform panel below cue grid** | Default for **WAVE** panel |
| **Show waveform on cue buttons** | Global default; per-cue override available |
| **Show level meter on cue cards** | Global default; per-cue override available |

Drag the **top edge** of the waveform panel to resize.

### Workspace & Media

- **Relink Missing Audio…** — pick a folder; matches files by **filename** and repairs broken paths
- Missing media is **rescanned every 30 seconds**; badges update if a network folder goes offline

### Remote Control

| Setting | Description |
|---------|-------------|
| **Enable HTTP remote** | Web UI on your LAN |
| **Remote port** | Default **3000** |
| **Access links** | URLs for this machine (use on iPad/phone browser) |

> **Companion** uses WebSocket port **8877** (configured separately in Companion) — not the HTTP remote port.

---

## Crossfade (XFADE)

1. Click **XFADE** on the toolbar to enable (highlighted when active).
2. Only one cue plays at a time.
3. Triggering a different cue **crossfades** using **Crossfade time** from Settings.
4. Fade progress shows orange countdown on cue cards and web remote.

---

## Ducking

1. On a cue, enable **This cue triggers ducking** in Properties.
2. On other cues, enable **Enable ducking for this cue** and set **ducking level** (% reduction).
3. When the trigger cue plays, ducked cues lower in volume.

---

## Workspaces

**File menu**

| Item | Shortcut | Action |
|------|----------|--------|
| New Workspace | Ctrl/Cmd+N | Empty workspace |
| Open Workspace… | Ctrl/Cmd+O | Load a `.cues` workspace folder |
| Save Workspace | Ctrl/Cmd+S | Save to current folder |
| Save Workspace As… | Ctrl/Cmd+Shift+S | Save to new folder |
| Relink Missing Audio… | — | Same as Settings button |
| Reveal Cues File / Config File | — | Open in file manager |

Workspaces store `cues.json` with **sections** and **layout** order (v2 format). Companion presets follow grid order.

---

## Relink Missing Audio

Use when files moved, drives changed, or a show folder went offline.

1. **File → Relink Missing Audio…** or **Settings → Workspace & Media**
2. Choose a folder to search
3. AV Cueboard matches **filenames** and updates paths in the workspace
4. Dialog closes automatically when everything is resolved

---

## Web remote (HTTP)

Open the URL from **Settings → Remote Control → Access links** (default port **3000**).

| Feature | Desktop | Web remote |
|---------|---------|------------|
| Trigger / stop cues | ✓ | ✓ |
| Playback / Edit toggle | ✓ | ✓ |
| Section layout | ✓ | ✓ |
| Per-cue edit (name, color, volume) | ✓ | ✓ |
| Reorder (buttons / long-press drag) | — | ✓ (touch-friendly) |
| Master vol + VU strip | ✓ | ✓ |
| XFADE / WAVE / Stop | ✓ | ✓ |
| Multi-lane waveform panel | ✓ | ✓ |
| Live seek + volume on waveforms | ✓ | ✓ |
| Missing media badges | ✓ | ✓ |

---

## Bitfocus Companion

1. Run AV Cueboard with WebSocket enabled (default **8877**).
2. Install the Companion module (**Companion 4.x.x or greater**):
   1. Download https://github.com/alanimedia/avcueboard-companion-module/raw/main/packages/alanimedia-avcueboard-1.10.0.tgz
   2. In Companion Admin, go to **Modules → Add Module Package** and select that `.tgz` file.
   3. When the store listing is available, you can install **Alani Media → AVCueboard** from Connections instead.
3. In Companion, add **Alani Media → AVCueboard**.
4. Set host IP and WebSocket port.
5. Use per-cue **Trigger** actions (stable cue IDs) for reliable targeting.

Module source: [alanimedia/avcueboard-companion-module](https://github.com/alanimedia/avcueboard-companion-module)

---

## Help menu (desktop)

| Item | Description |
|------|-------------|
| **Version** | Current app version |
| **Check for Updates…** | Opens the latest GitHub release / installer download (run the installer to update; Windows is not code-signed yet so in-app install is disabled) |
| **User Guide** | Opens this document on GitHub |
| **Learn More** | [alani.media](https://alani.media) |

---

## System requirements

- **OS:** Windows 10/11, macOS 10.15+, Linux (deb/AppImage)
- **RAM:** 4 GB minimum, 8 GB recommended
- **Audio:** Any compatible output device; optional second output for monitor/preview

---

## Getting help

- [GitHub Issues](https://github.com/alanimedia/avcueboard/issues) — bugs and feature requests
- Include OS version, steps to reproduce, and screenshots if possible

---

## License & credits

MIT License — [LICENSE](LICENSE) · [NOTICE](NOTICE).

Based on **[acCompaniment](https://github.com/mko1989/acCompaniment)** by **Marcin Wardecki** ([mko1989](https://github.com/mko1989)). Original work © Marcin Wardecki. Modifications © Omar Gadahn, Alani Media.
