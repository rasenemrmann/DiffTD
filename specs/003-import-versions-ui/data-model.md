# Data Model: Import Project Versions + Polished GUI

## VersionEntry (browser, in memory)

| Field | Type | Rule |
|-------|------|------|
| `id` | string | sha256 hex of the file content. Same content → same entry (FR-006). |
| `name` | string | File name of the preferred origin. |
| `size` | integer | Bytes. Over 200 MB → `status: error` with a size message, never uploaded. |
| `origins` | Origin[] | Every place this content was seen. |
| `modified` | number | Latest `lastModified` among origins (ms), used for sorting. |
| `status` | `idle` \| `converting` \| `ready` \| `error` | Per version; one failing version never affects others. |
| `error` | string? | Human-readable cause (file name included). |
| `roots` | map? | Converted networks (`name → snapshot`), present when `ready`. |

### Origin

`{ kind: 'folder' | 'upload' | 'helper', label: string, folder?: string, handle?: FileSystemFileHandle }` — `folder` is the sub-folder name for display, `handle` lets a refresh re-read the file.

## Selection

`{ olderId, newerId, root }` — `root` is the chosen top-level network, default `project1` if present else first. Invariant: `olderId` and `newerId` refer to existing entries; swapping exchanges them; removing an entry used in the selection resets the selection to the default pair.

## ViewState (pure reducer)

| Phase | Entered when | Shows | Leaves on |
|-------|--------------|-------|-----------|
| `helper-missing` | health check fails | Start command, "Try again"; versions already read stay listed but comparison is not available if it needs conversion | helper reachable |
| `empty` | no versions or fewer than 2 | Import/Add prompt with drop zone | ≥ 2 versions |
| `loading` | selection changed and a needed conversion is running | Progress in place, previous result removed | conversion done / failed |
| `ready` | both versions converted, differences exist | Graph + detail | selection change, refresh |
| `identical` | both converted, no differences in the chosen network | "No differences" state (shows count of nodes compared) | selection change |
| `error` | a conversion of the selected versions failed | Cause + next step, file name | selection change |

Transitions always clear the previous phase's content first (FR-014). Messages go to the status area (fixed height), not into the layout.

## Remembered folder (IndexedDB)

`{ key: 'lastFolder', handle: FileSystemDirectoryHandle, name: string }` — only the handle; no file content.

## Helper cache entry (server memory)

`{ sha256, roots, size, converted_at }`; LRU, max 30 entries, lost on restart. Temporary expanded files are removed after each conversion.
