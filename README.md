# MK4 MindMapper

MK4 MindMapper is a dependency-free, installable mind mapping editor built from `Specification.docx`. This first release focuses on a fast local desktop-style app that runs in a modern browser/PWA shell and stores maps as `.mk4map`.

## Run

From this folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

The launcher starts a local server at `http://localhost:4174/` and opens the app in an Edge/Chrome app window when available.

## Install On Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

This installs the app under `%LOCALAPPDATA%\MK4MindMapper` and creates Desktop and Start Menu shortcuts. It does not require administrator access.

## Core Usage

- Double-click a topic or press `F2` to rename it.
- `Enter` creates a sibling topic.
- `Tab` creates a child topic.
- `Shift+Tab` promotes the selected topic.
- `Delete` removes the selected branch.
- Drag topics to manually position them.
- Drag the canvas background to pan.
- Mouse wheel zooms from 5% to 1000%.
- Use the right Properties panel for notes, labels, tags, colors, shapes, font size, bold/italic, collapse, and layout.
- Use the toolbar for child/sibling/floating topics, relationships, boundaries, summaries, undo/redo, search, save, and open.

## File Support

Implemented:

- Native `.mk4map` save/open. Uses gzip-compressed JSON when the browser supports `CompressionStream`, with plain JSON fallback.
- Import: `.mk4map`, `.json`, `.xmind` with modern `content.json`, `.mm`, `.opml`, `.md`, `.txt`, `.csv`, `.xml`.
- Export: `.mk4map`, `.xmind`, `.json`, Markdown, TXT, CSV, OPML, FreeMind `.mm`, XML, HTML, SVG, PNG.
- Autosave and recovery through browser local storage.

Partial/spec-scaffolded:

- XMind import supports ZIP entries stored directly or deflated when the browser supports `DecompressionStream("deflate-raw")`. Advanced XMind features such as all marker/style/resource variants are not fully round-tripped yet.
- PDF export is available through browser print/save-to-PDF rather than a dedicated PDF engine.
- Plugin API is exposed as `window.MK4MindMapper` with document access, command registration, and an event target.

## Architecture

- `src/model.js`: document model, hierarchy operations, style defaults.
- `src/layout.js`: automatic mind-map layout, bounds, viewport culling, branch paths.
- `src/importExport.js`: native format, text/XML converters, XMind ZIP read/write.
- `src/history.js`: undo/redo snapshots.
- `src/app.js`: UI state, rendering, shortcuts, autosave, import/export commands.

The renderer uses SVG with viewport culling for responsive editing on large maps. The model is structured so richer renderers, native packaging, collaboration, and plugin loading can be added without replacing the document format.

## Validation

Run static validation:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\validate.ps1
```

Run browser module tests by opening:

```text
tests/test-runner.html
```

The test runner covers document creation, hierarchy edits, layout, common exports, compressed `.mk4map` round-trip, and modern `.xmind` package round-trip.

## Current Limitations

The attached specification describes an XMind-class professional application with 100,000-node performance, full XMind round-trip fidelity, collaboration-ready architecture, rich notes, attachment sandboxing, print layout, native Qt/C++ packaging, and broad automated CI coverage. This repository is a working installable first release, not full commercial parity.

Recommended next milestones:

1. Package a native shell with Tauri, Electron, or Qt once the build toolchain is available.
2. Add a dedicated large-map benchmark view for 1k, 10k, 50k, and 100k nodes.
3. Expand XMind marker/style/resource round-tripping.
4. Add true PDF export, print preview controls, and multi-page layout.
5. Add CI after git/node or a native build stack is available.
