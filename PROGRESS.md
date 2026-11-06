# iLogia Library — PROGRESS

## Status (2026-10-31)
Rebuilt as a no-build static site using the **existing iLogia theme** (`ilogia-ds.css`, self-hosted fonts, green/ivory/gold) and the **existing Supabase tables** (`library_items`, `grades`, `subjects`, RPC `get_library_file`, bucket `library`). No migrations were run or written for this version.

## Done (smoke-tested in headless Chromium against a MOCKED Supabase)
- Sign-in, Arabic RTL default + English/LTR toggle, responsive header
- Home (search, subject chips, latest, continue reading), Explore (search, subject/grade/type filters, sort, grid/list, pagination 24/page)
- Resource details (open, save, share, add to list), signed URLs via `get_library_file` (server checks free/paid)
- PDF reader (pdf.js 3.11.174 from cdnjs, range requests, page jump, zoom, fullscreen, remembers last page)
- My Library (saved, continue reading, custom lists, history)
- Strict CSP, HTML-escaped output, https-only external opening

## Not done / limits (be honest)
- NOT tested against the real Supabase project or real files.
- Bookmarks, lists, history and reading progress are stored in the browser (localStorage), per user and per device. Syncing them needs DB tables + RLS (migration for review first).
- Upload Center and Admin are NOT in this app; the page links to the main site's admin/teacher dashboards that already exist.
- Reports, usage stats, categories management, resource statuses (pending/review) and cover images need new tables/columns that do not exist in the current project.
- PDF.js is loaded from cdnjs (needs network; vendor it for offline use).
- No push, deploy or DNS change was made. `CNAME` = library.ilogia-eg.com is included.
