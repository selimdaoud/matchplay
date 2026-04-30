# PRD — Matchplay Live: SQLite Migration & Tournament History

**Status:** Draft  
**Date:** 2026-04-30  
**Scope:** Backend data layer + new capabilities unlocked by the migration

---

## 1. Context & Problem

The current app stores all data in a single `scores.json` file, read and overwritten on every request. This approach has three structural limits:

1. **Concurrency risk.** Concurrent writes can corrupt the file (read-modify-write race, no atomicity guarantee).
2. **Fixed match count.** The UI and data model implicitly assume two matches per session. Adding a third requires manual JSON editing.
3. **No history.** Every new tournament overwrites the previous one. There is no way to look back at past results.

SQLite resolves all three at once without adding infrastructure: it is a single embedded file, ACID-compliant, and requires no separate process.

---

## 2. Goals

- Replace `scores.json` with a SQLite database as the persistence layer.
- Support any number of concurrent matches within a session.
- Persist tournament history across sessions.
- Enable basic per-match timeline (hole-by-hole replay).
- Keep the frontend changes minimal — the UI model stays the same.

## 3. Non-Goals

- No user authentication or multi-user access control.
- No cloud sync or remote database.
- No real-time push (WebSocket / SSE) — polling stays.
- No stats dashboard or advanced analytics in this iteration.
- No change to the live/read-only URL scheme.

---

## 4. Data Model

### 4.1 Schema

```sql
CREATE TABLE tournaments (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  date        TEXT NOT NULL,          -- ISO 8601 date (YYYY-MM-DD)
  created_at  TEXT NOT NULL
);

CREATE TABLE matches (
  id                TEXT PRIMARY KEY,
  tournament_id     TEXT NOT NULL REFERENCES tournaments(id),
  title             TEXT NOT NULL DEFAULT '',
  reference_player  TEXT NOT NULL DEFAULT '',
  opponent          TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL
);

CREATE TABLE holes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id    TEXT NOT NULL REFERENCES matches(id),
  hole_number INTEGER NOT NULL,
  result      TEXT NOT NULL CHECK(result IN ('win', 'halve', 'loss')),
  played_at   TEXT NOT NULL,
  UNIQUE(match_id, hole_number)        -- one result per hole per match
);
```

### 4.2 Key design decisions

- **`holes.UNIQUE(match_id, hole_number)`** — enforces one result per hole at the DB level; an `INSERT OR REPLACE` handles corrections without extra logic.
- **Timestamps as ISO 8601 strings** — SQLite has no native date type; strings sort correctly and are compatible with `new Date()` in JS.
- **No `updatedAt` on matches** — derived on read as `MAX(holes.played_at)` when needed.
- **Tournaments as a first-class entity** — a match always belongs to a tournament; the "active tournament" is the one with the most recent date.

---

## 5. API Changes

### 5.1 Existing endpoints (behaviour preserved, payload unchanged)

| Method | Path | Change |
|--------|------|--------|
| `GET /api` | Return active tournament matches + holes | Source changes from JSON to DB; response shape stays identical |
| `POST /api` | Save full match state | Decomposed into upserts on `matches` + `INSERT OR REPLACE` on `holes` |

The frontend does not need to change for these two endpoints.

### 5.2 New endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET /api/tournaments` | List all tournaments (id, name, date, match count) | History screen |
| `POST /api/tournaments` | Create a new tournament | Start a new day / event |
| `GET /api/tournaments/:id` | Full detail: all matches + holes for a past tournament | Read-only replay |
| `POST /api/matches` | Add a match to the active tournament | Supports >2 matches |
| `DELETE /api/matches/:id` | Remove a match | Cleanup |
| `PUT /api/matches/:id/holes/:hole` | Set result for a single hole | Fine-grained update (replaces full-body POST for edits) |
| `DELETE /api/matches/:id/holes/:hole` | Delete a hole result | Replaces the current delete-via-POST pattern |

The fine-grained hole endpoints (`PUT`/`DELETE`) avoid sending the entire state on every tap — more efficient and safer under poor connectivity.

---

## 6. Frontend Changes

### 6.1 Minimal (required for migration)

- Update `fetchData` to call `GET /api` as today — no change if response shape is preserved.
- Update `executeSave` to call the new fine-grained `PUT /api/matches/:id/holes/:hole` instead of POSTing the full state. This simplifies the debounce/Promise issues described in the code review.
- Add a "New match" button in the toolbar that calls `POST /api/matches`.

### 6.2 New UI surfaces (post-migration)

- **Tournament switcher** — a dropdown or list linking to past tournaments via `GET /api/tournaments`.
- **History view** — read-only rendering of a past tournament (same `renderMatch` components, `readonly` flag already exists).
- **Match completion indicator** — now that `holes` has timestamps, dormie/match-over detection can be displayed ("Gagné 3&2").

---

## 7. Migration Plan

### Phase 1 — DB layer, no feature change (server only)

1. Add `better-sqlite3` dependency.
2. Write a `db.js` module: schema creation on startup, helper functions (`getActiveTournament`, `upsertMatch`, `setHole`, `deleteHole`).
3. On first start, if `scores.json` exists, import it into the DB as a tournament named "Import initial" dated today, then rename the file to `scores.json.bak`.
4. Replace `readData` / `writeData` in `server.js` with DB calls. `GET /api` and `POST /api` keep the same response shape.
5. Delete the write-race workaround (SQLite transactions handle this natively).

At the end of Phase 1, the app behaves identically from the browser's perspective.

### Phase 2 — New server endpoints

Add the endpoints listed in §5.2. No frontend change yet.

### Phase 3 — Frontend: fine-grained saves

Replace the full-body `POST /api` with `PUT`/`DELETE` per hole. This is where the `saveData` Promise issues get resolved naturally — each action is a single targeted request, not a full-state sync.

### Phase 4 — Frontend: new UI surfaces

Tournament switcher, history view, "add match" button.

---

## 8. Dependencies

| Package | Reason |
|---------|--------|
| `better-sqlite3` | Synchronous SQLite bindings for Node — simpler than async drivers for a single-process server |

No other new dependencies. `better-sqlite3` is synchronous by design, which eliminates the async coordination issues in the current write path.

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| SQLite file corruption on hard kill | WAL mode enabled by default in `better-sqlite3`; journal survives crashes |
| Migration loses existing data | Import `scores.json` on first boot; keep `.bak` copy |
| `better-sqlite3` requires native compilation | Pre-built binaries available for all major platforms via `npm install`; document Node version requirement (already `>=18`) |
| Phase 3 increases request volume (one request per hole instead of debounced batches) | Each request is tiny (<100 bytes body); negligible on LAN |

---

## 10. Success Criteria

- [ ] A session with 4+ concurrent matches works without any code change beyond adding a match.
- [ ] After a `kill -9` on the server process, no data written in the last session is lost.
- [ ] A past tournament's full match history is accessible via URL and renders correctly in read-only mode.
- [ ] The `scores.json` file is no longer modified after Phase 1 is deployed.
