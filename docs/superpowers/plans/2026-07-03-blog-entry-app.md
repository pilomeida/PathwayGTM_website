# Blog Editorial Planner + Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `blog-entry.pathwaygtm.com` — a private web app where Pedro plans, drafts,
and publishes "Beyond the Brief" articles without opening Claude Code or github.com.

**Architecture:** New repo `pilomeida/pathwaygtm-blog-entry` — FastAPI backend + React
(Vite/TS) frontend, self-hosted on the existing Hetzner VPS (same pattern as
`CareerOutreachCRM`). The app holds no database: `pilomeida/PathwayGTM_website` (via the
GitHub REST API) is the sole source of truth for drafts, calendar metadata, and published
articles. The Anthropic API powers the assist panel, translation, and the HTML
preview/revise loop.

**Tech Stack:** Python 3.11 / FastAPI / httpx / mistune / anthropic SDK / pytest / respx
(backend); React 19 / TypeScript / Vite / react-markdown (frontend); GitHub REST API v3;
nginx + systemd + GitHub Actions (deploy).

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-07-03-blog-entry-app-design.md` (this
  project's repo, `PathwayGTM_website`) — every task below traces back to it.
- Content repo: `pilomeida/PathwayGTM_website` (owner=`pilomeida`, repo=`PathwayGTM_website`).
  All reads/writes go through the GitHub REST API — never a local clone.
- No database. State lives in `drafts/calendar.json` inside `PathwayGTM_website`.
- Nothing commits straight to `PathwayGTM_website`'s `main` from the publish flow — the
  publish commit always goes to a new branch + PR; merge/discard is an explicit, separate
  in-app action.
- Draft-metadata saves (planner edits, in-progress writer saves) commit straight to
  `main` — these touch only `drafts/*.md` and `drafts/calendar.json`, which have no live
  route on the public site, so this carries no production risk.
- No code-level UI is ever required of Pedro to fix generated HTML — corrections happen
  through a plain-language "ask for changes" instruction, never a code editor.
- Category taxonomy is fixed to the 4 N² Module slugs (`gtm-readiness`,
  `deal-generation`, `customer-success`, `govern-steer`) — see Task 14, values sourced
  verbatim from `drafts/VOICE-NOTES.md` and the editorial-calendar brainstorm.
- Read time: `max(1, round(word_count / 200))` minutes — 200 wpm is the only rate used
  anywhere in this app.
- Match `CareerOutreachCRM`'s established VPS deploy shape exactly (systemd + nginx +
  GitHub Actions rsync) rather than introducing a new deploy pattern.

---

## File Structure

```
pathwaygtm-blog-entry/
  backend/
    __init__.py
    main.py                  # FastAPI app, CORS, routers, /healthz, static frontend serving
    config.py                 # Settings (env vars)
    github_client.py          # GitHub REST API wrapper
    calendar_store.py         # calendar.json <-> README.md table
    taxonomy.py                # WP -> category, read-time calc
    templating.py              # markdown body -> site article-prose HTML (mistune)
    page_template.py           # full-page HTML assembly (nav/footer boilerplate + slots)
    site_wiring.py             # listing-card insertion, nav-link updates
    cross_links.py             # CROSS-LINKS.md parsing + resolution proposals
    translate.py                # PT/ES generation
    anthropic_client.py         # Anthropic SDK wrapper (complete(), revise_html())
    api/
      __init__.py
      calendar.py               # /api/calendar
      drafts.py                  # /api/drafts
      assist.py                   # /api/assist
      publish.py                   # /api/publish
    tests/
      __init__.py
      conftest.py
      test_health.py
      test_github_client.py
      test_calendar_store.py
      test_calendar_api.py
      test_drafts_api.py
      test_taxonomy.py
      test_templating.py
      test_page_template.py
      test_anthropic_client.py
      test_assist_api.py
      test_cross_links.py
      test_site_wiring.py
      test_translate.py
      test_publish_preview.py
      test_publish_commit.py
      test_pr_review.py
      test_backfill_calendar.py
  frontend/
    index.html
    package.json
    vite.config.ts
    tsconfig.json / tsconfig.app.json / tsconfig.node.json
    src/
      main.tsx
      App.tsx
      index.css
      api.ts
      types.ts
      pages/
        PlannerPage.tsx
        WriterPage.tsx
        PublishPage.tsx
      components/
        CalendarTable.tsx
        MarkdownEditor.tsx
        AssistPanel.tsx
        PreviewFrame.tsx
        AskForChangesBox.tsx
        PRDiffView.tsx
  infra/
    nginx.conf
    blog-entry.service
  scripts/
    vps-setup.sh
    backfill_calendar.py
  .github/workflows/deploy.yml
  docs/
    pathwaygtm-blog-sysadmin.md
    pathwaygtm-blog-architecture.md
  requirements.txt
  .env.example
  README.md
```

---

### Task 1: Backend scaffolding + health check

**Files:**
- Create: `pathwaygtm-blog-entry/requirements.txt`
- Create: `pathwaygtm-blog-entry/.env.example`
- Create: `pathwaygtm-blog-entry/backend/__init__.py`
- Create: `pathwaygtm-blog-entry/backend/config.py`
- Create: `pathwaygtm-blog-entry/backend/main.py`
- Create: `pathwaygtm-blog-entry/backend/tests/__init__.py`
- Test: `pathwaygtm-blog-entry/backend/tests/test_health.py`

**Interfaces:**
- Produces: `backend.config.settings` (a `Settings` instance with `GITHUB_TOKEN`,
  `GITHUB_OWNER`, `GITHUB_REPO`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`), `backend.main.app`
  (the FastAPI instance every later router mounts onto).

- [ ] **Step 1: Create the repo and `requirements.txt`**

```bash
mkdir -p ~/Desktop/Claude_Corner/pathwaygtm-blog-entry
cd ~/Desktop/Claude_Corner/pathwaygtm-blog-entry
git init
mkdir -p backend/api backend/tests frontend/src infra scripts docs
```

`requirements.txt`:
```
fastapi
uvicorn[standard]
httpx==0.27.0
anthropic
mistune==3.0.2
pydantic-settings
python-multipart
pytest==8.2.2
pytest-asyncio==0.23.8
respx==0.21.1
```

- [ ] **Step 2: Write `.env.example`**

```
GITHUB_TOKEN=
GITHUB_OWNER=pilomeida
GITHUB_REPO=PathwayGTM_website
ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-sonnet-5
```

- [ ] **Step 3: Write `backend/config.py`**

```python
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    GITHUB_TOKEN: str = ""
    GITHUB_OWNER: str = "pilomeida"
    GITHUB_REPO: str = "PathwayGTM_website"

    ANTHROPIC_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-sonnet-5"


settings = Settings()
```

- [ ] **Step 4: Write the failing health-check test**

`backend/tests/__init__.py` — empty file.

`backend/tests/test_health.py`:
```python
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_healthz():
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd pathwaygtm-blog-entry && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/pytest backend/tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.main'`

- [ ] **Step 6: Write `backend/main.py`**

```python
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = FastAPI(title="PathwayGTM Blog Entry", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8006",
        "http://167.233.51.113:8006",
        "https://blog-entry.pathwaygtm.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    return {"ok": True}


frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    @app.get("/", response_class=HTMLResponse)
    async def serve_index():
        content = (frontend_dist / "index.html").read_text(encoding="utf-8")
        return HTMLResponse(content=content, headers={"Cache-Control": "no-store, no-cache"})

    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
else:
    @app.get("/")
    async def root():
        return {"message": "Backend running. Frontend not built — run: cd frontend && npm run build"}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_health.py -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: backend scaffolding with health check"
```

---

### Task 2: Frontend scaffolding

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`,
  `frontend/tsconfig.app.json`, `frontend/tsconfig.node.json`, `frontend/index.html`
- Create: `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/index.css`,
  `frontend/src/types.ts`

**Interfaces:**
- Produces: `App` component with a 2-route shell (`/` Planner, `/write/:id` Writer) that
  Tasks 6/8/13/17/22 mount pages into. `CalendarEntry` type in `types.ts` matching the
  spec's `calendar.json` schema exactly — every later frontend task imports this type.

- [ ] **Step 1: Scaffold with Vite**

```bash
cd pathwaygtm-blog-entry
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install react-router-dom react-markdown
npm install -D @types/node
```

- [ ] **Step 2: Write `frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8006',
    },
  },
})
```

- [ ] **Step 3: Write `frontend/src/types.ts`**

```typescript
export interface CalendarEntry {
  id: string
  title: string
  slug: string
  wp: string
  track: 'A' | 'B' | 'C'
  source: string
  category: 'gtm-readiness' | 'deal-generation' | 'customer-success' | 'govern-steer'
  format: string
  publishTarget: string
  status: 'idea' | 'outline' | 'drafting' | 'ready-for-review' | 'published'
  draftFile: string
  heroImage: string | null
  teaser: string
}
```

- [ ] **Step 4: Write `frontend/src/App.tsx`**

```tsx
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import PlannerPage from './pages/PlannerPage'
import WriterPage from './pages/WriterPage'
import PublishPage from './pages/PublishPage'

export default function App() {
  return (
    <BrowserRouter>
      <header style={{ padding: '12px 24px', borderBottom: '1px solid #ddd' }}>
        <Link to="/" style={{ fontWeight: 600, textDecoration: 'none' }}>
          Beyond the Brief — Editorial Planner
        </Link>
      </header>
      <main style={{ padding: 24 }}>
        <Routes>
          <Route path="/" element={<PlannerPage />} />
          <Route path="/write/:id" element={<WriterPage />} />
          <Route path="/publish/:id" element={<PublishPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
```

Create placeholder page files so the build succeeds (later tasks replace each):

`frontend/src/pages/PlannerPage.tsx`:
```tsx
export default function PlannerPage() {
  return <div>Planner — Task 6 wires this up</div>
}
```

`frontend/src/pages/WriterPage.tsx`:
```tsx
export default function WriterPage() {
  return <div>Writer — Task 8 wires this up</div>
}
```

`frontend/src/pages/PublishPage.tsx`:
```tsx
export default function PublishPage() {
  return <div>Publish — Task 17 wires this up</div>
}
```

`frontend/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 5: Build and verify**

Run: `cd frontend && npm run build && test -f dist/index.html && echo BUILD_OK`
Expected: `BUILD_OK` printed, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
cd ..
git add -A
git commit -m "feat: frontend scaffolding with routed page shells"
```

---

### Task 3: GitHub client wrapper

**Files:**
- Create: `backend/github_client.py`
- Test: `backend/tests/test_github_client.py`

**Interfaces:**
- Consumes: `backend.config.settings` (`GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`).
- Produces: `class GitHubClient` with methods used by every later backend task that
  touches `PathwayGTM_website`:
  - `async def get_file(self, path: str, ref: str = "main") -> FileContent | None`
  - `async def put_file(self, path: str, content: str, message: str, branch: str, sha: str | None = None) -> None`
  - `async def create_branch(self, new_branch: str, from_branch: str = "main") -> None`
  - `async def open_pr(self, head: str, title: str, body: str, base: str = "main") -> int`
  - `async def get_pr_files(self, pr_number: int) -> list[PRFile]`
  - `async def merge_pr(self, pr_number: int) -> None`
  - `async def discard_pr(self, pr_number: int, branch: str) -> None`
  - `FileContent(path: str, content: str, sha: str)`, `PRFile(filename: str, status: str, additions: int, deletions: int, patch: str | None)`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_github_client.py`:
```python
import base64
import pytest
import respx
from httpx import Response

from backend.github_client import GitHubClient

OWNER, REPO = "pilomeida", "PathwayGTM_website"
API = f"https://api.github.com/repos/{OWNER}/{REPO}"


@pytest.fixture
def client():
    return GitHubClient(token="fake-token", owner=OWNER, repo=REPO)


@respx.mock
@pytest.mark.asyncio
async def test_get_file_returns_decoded_content(client):
    encoded = base64.b64encode(b"hello world").decode()
    respx.get(f"{API}/contents/drafts/calendar.json", params={"ref": "main"}).mock(
        return_value=Response(200, json={"content": encoded, "sha": "abc123", "encoding": "base64"})
    )
    result = await client.get_file("drafts/calendar.json")
    assert result.content == "hello world"
    assert result.sha == "abc123"


@respx.mock
@pytest.mark.asyncio
async def test_get_file_returns_none_on_404(client):
    respx.get(f"{API}/contents/drafts/missing.md", params={"ref": "main"}).mock(
        return_value=Response(404, json={"message": "Not Found"})
    )
    result = await client.get_file("drafts/missing.md")
    assert result is None


@respx.mock
@pytest.mark.asyncio
async def test_put_file_sends_base64_body(client):
    route = respx.put(f"{API}/contents/drafts/calendar.json").mock(
        return_value=Response(200, json={"content": {"sha": "new-sha"}})
    )
    await client.put_file(
        "drafts/calendar.json", "updated content", "chore: update calendar",
        branch="main", sha="old-sha",
    )
    sent = route.calls[0].request
    import json as _json
    body = _json.loads(sent.content)
    assert base64.b64decode(body["content"]).decode() == "updated content"
    assert body["sha"] == "old-sha"
    assert body["branch"] == "main"


@respx.mock
@pytest.mark.asyncio
async def test_create_branch(client):
    respx.get(f"{API}/git/ref/heads/main").mock(
        return_value=Response(200, json={"object": {"sha": "base-sha"}})
    )
    route = respx.post(f"{API}/git/refs").mock(return_value=Response(201, json={}))
    await client.create_branch("blog/article-1", from_branch="main")
    import json as _json
    body = _json.loads(route.calls[0].request.content)
    assert body["ref"] == "refs/heads/blog/article-1"
    assert body["sha"] == "base-sha"


@respx.mock
@pytest.mark.asyncio
async def test_open_pr_returns_number(client):
    respx.post(f"{API}/pulls").mock(
        return_value=Response(201, json={"number": 42})
    )
    number = await client.open_pr(head="blog/article-1", title="Publish article 1", body="...")
    assert number == 42


@respx.mock
@pytest.mark.asyncio
async def test_get_pr_files(client):
    respx.get(f"{API}/pulls/42/files").mock(
        return_value=Response(200, json=[
            {"filename": "blog-x.html", "status": "added", "additions": 10, "deletions": 0, "patch": "+..."}
        ])
    )
    files = await client.get_pr_files(42)
    assert len(files) == 1
    assert files[0].filename == "blog-x.html"
    assert files[0].status == "added"


@respx.mock
@pytest.mark.asyncio
async def test_merge_pr(client):
    route = respx.put(f"{API}/pulls/42/merge").mock(return_value=Response(200, json={"merged": True}))
    await client.merge_pr(42)
    assert route.called


@respx.mock
@pytest.mark.asyncio
async def test_discard_pr_closes_and_deletes_branch(client):
    close_route = respx.patch(f"{API}/pulls/42").mock(return_value=Response(200, json={}))
    delete_route = respx.delete(f"{API}/git/refs/heads/blog/article-1").mock(return_value=Response(204))
    await client.discard_pr(42, branch="blog/article-1")
    assert close_route.called
    assert delete_route.called
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_github_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.github_client'`

- [ ] **Step 3: Write `backend/github_client.py`**

```python
from __future__ import annotations

import base64
from dataclasses import dataclass

import httpx


@dataclass
class FileContent:
    path: str
    content: str
    sha: str


@dataclass
class PRFile:
    filename: str
    status: str
    additions: int
    deletions: int
    patch: str | None


class GitHubClient:
    def __init__(self, token: str, owner: str, repo: str):
        self._owner = owner
        self._repo = repo
        self._base = f"https://api.github.com/repos/{owner}/{repo}"
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    async def get_file(self, path: str, ref: str = "main") -> FileContent | None:
        async with httpx.AsyncClient() as http:
            resp = await http.get(
                f"{self._base}/contents/{path}", params={"ref": ref}, headers=self._headers
            )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
        content = base64.b64decode(data["content"]).decode("utf-8")
        return FileContent(path=path, content=content, sha=data["sha"])

    async def put_file(
        self, path: str, content: str, message: str, branch: str, sha: str | None = None
    ) -> None:
        body = {
            "message": message,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "branch": branch,
        }
        if sha:
            body["sha"] = sha
        async with httpx.AsyncClient() as http:
            resp = await http.put(f"{self._base}/contents/{path}", json=body, headers=self._headers)
        resp.raise_for_status()

    async def create_branch(self, new_branch: str, from_branch: str = "main") -> None:
        async with httpx.AsyncClient() as http:
            ref_resp = await http.get(f"{self._base}/git/ref/heads/{from_branch}", headers=self._headers)
            ref_resp.raise_for_status()
            base_sha = ref_resp.json()["object"]["sha"]
            resp = await http.post(
                f"{self._base}/git/refs",
                json={"ref": f"refs/heads/{new_branch}", "sha": base_sha},
                headers=self._headers,
            )
        resp.raise_for_status()

    async def open_pr(self, head: str, title: str, body: str, base: str = "main") -> int:
        async with httpx.AsyncClient() as http:
            resp = await http.post(
                f"{self._base}/pulls",
                json={"title": title, "head": head, "base": base, "body": body},
                headers=self._headers,
            )
        resp.raise_for_status()
        return resp.json()["number"]

    async def get_pr_files(self, pr_number: int) -> list[PRFile]:
        async with httpx.AsyncClient() as http:
            resp = await http.get(f"{self._base}/pulls/{pr_number}/files", headers=self._headers)
        resp.raise_for_status()
        return [
            PRFile(
                filename=f["filename"],
                status=f["status"],
                additions=f["additions"],
                deletions=f["deletions"],
                patch=f.get("patch"),
            )
            for f in resp.json()
        ]

    async def merge_pr(self, pr_number: int) -> None:
        async with httpx.AsyncClient() as http:
            resp = await http.put(f"{self._base}/pulls/{pr_number}/merge", headers=self._headers)
        resp.raise_for_status()

    async def discard_pr(self, pr_number: int, branch: str) -> None:
        async with httpx.AsyncClient() as http:
            close_resp = await http.patch(
                f"{self._base}/pulls/{pr_number}", json={"state": "closed"}, headers=self._headers
            )
            close_resp.raise_for_status()
            del_resp = await http.delete(f"{self._base}/git/refs/heads/{branch}", headers=self._headers)
            del_resp.raise_for_status()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_github_client.py -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/github_client.py backend/tests/test_github_client.py
git commit -m "feat: GitHub REST API client (files, branches, PRs)"
```

---

### Task 4: Calendar store (calendar.json <-> README.md)

**Files:**
- Create: `backend/calendar_store.py`
- Test: `backend/tests/test_calendar_store.py`

**Interfaces:**
- Consumes: `GitHubClient` (Task 3).
- Produces: `class CalendarEntry(BaseModel)` (fields: `id, title, slug, wp, track, source,
  category, format, publish_target, status, draft_file, hero_image, teaser` — matches
  `frontend/src/types.ts`'s `CalendarEntry` field-for-field, camelCase on the wire via
  `alias_generator`), `async def load_calendar(client) -> list[CalendarEntry]`,
  `async def save_calendar(client, entries, message) -> None`,
  `def render_readme_table(entries: list[CalendarEntry]) -> str` (pure function, used by
  Task 5's tests directly without mocking GitHub).

- [ ] **Step 1: Write the failing test**

`backend/tests/test_calendar_store.py`:
```python
import json
import pytest
from unittest.mock import AsyncMock

from backend.calendar_store import CalendarEntry, load_calendar, save_calendar, render_readme_table
from backend.github_client import FileContent

SAMPLE = [
    {
        "id": "1", "title": "Pathway's 10-Point GTM Health Check", "slug": "blog-gtm-health-check",
        "wp": "Cross-WP diagnostic (Module 1)", "track": "A", "source": "",
        "category": "gtm-readiness", "format": "Resource / Playbook",
        "publishTarget": "2026-07-23", "status": "published",
        "draftFile": "drafts/01-blog-gtm-health-check.md", "heroImage": None,
        "teaser": "GTM rarely breaks for one reason.",
    },
    {
        "id": "2", "title": "Agility & Coordination", "slug": "blog-agility-coordination",
        "wp": "Agility & Coordination", "track": "B", "source": "star-hyperion-team-recovery",
        "category": "gtm-readiness", "format": "Long-form Insight",
        "publishTarget": "2026-08-20", "status": "drafting",
        "draftFile": "drafts/02-blog-agility-coordination.md", "heroImage": None,
        "teaser": "",
    },
]


@pytest.mark.asyncio
async def test_load_calendar_parses_entries():
    client = AsyncMock()
    client.get_file.return_value = FileContent(
        path="drafts/calendar.json", content=json.dumps(SAMPLE), sha="sha1"
    )
    entries = await load_calendar(client)
    assert len(entries) == 2
    assert entries[0].title == "Pathway's 10-Point GTM Health Check"
    assert entries[0].publish_target == "2026-07-23"
    assert entries[1].status == "drafting"


@pytest.mark.asyncio
async def test_save_calendar_writes_json_and_readme():
    client = AsyncMock()
    client.get_file.side_effect = [
        FileContent(path="drafts/calendar.json", content=json.dumps(SAMPLE), sha="cal-sha"),
        FileContent(path="drafts/README.md", content="# old readme", sha="readme-sha"),
    ]
    entries = [CalendarEntry(**e) for e in SAMPLE]
    await save_calendar(client, entries, message="chore: update calendar")

    calls = {c.args[0]: c for c in client.put_file.call_args_list}
    assert "drafts/calendar.json" in calls
    assert "drafts/README.md" in calls
    written_json = calls["drafts/calendar.json"].args[1]
    assert json.loads(written_json)[0]["title"] == "Pathway's 10-Point GTM Health Check"
    assert calls["drafts/calendar.json"].kwargs["sha"] == "cal-sha"
    assert calls["drafts/README.md"].kwargs["sha"] == "readme-sha"


def test_render_readme_table_contains_every_entry():
    entries = [CalendarEntry(**e) for e in SAMPLE]
    table = render_readme_table(entries)
    assert "Pathway's 10-Point GTM Health Check" in table
    assert "Agility & Coordination" in table
    assert "2026-08-20" in table
    assert table.startswith("| # | File | WP | Publish target | Status |")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_calendar_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.calendar_store'`

- [ ] **Step 3: Write `backend/calendar_store.py`**

```python
from __future__ import annotations

import json

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from backend.github_client import GitHubClient

CALENDAR_PATH = "drafts/calendar.json"
README_PATH = "drafts/README.md"


class CalendarEntry(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str
    title: str
    slug: str
    wp: str
    track: str
    source: str
    category: str
    format: str
    publish_target: str
    status: str
    draft_file: str
    hero_image: str | None
    teaser: str


async def load_calendar(client: GitHubClient) -> list[CalendarEntry]:
    file = await client.get_file(CALENDAR_PATH)
    if file is None:
        return []
    raw = json.loads(file.content)
    return [CalendarEntry(**item) for item in raw]


def render_readme_table(entries: list[CalendarEntry]) -> str:
    lines = [
        "# Beyond the Brief — Draft Queue",
        "",
        "Auto-generated from `drafts/calendar.json` by the blog editorial app. Do not "
        "hand-edit this table — edit the entry in the app instead.",
        "",
        "| # | File | WP | Publish target | Status |",
        "|---|---|---|---|---|",
    ]
    for i, e in enumerate(entries, start=1):
        lines.append(f"| {i} | [{e.draft_file.split('/')[-1]}]({e.draft_file.split('/')[-1]}) | {e.wp} | {e.publish_target} | {e.status} |")
    return "\n".join(lines) + "\n"


async def save_calendar(client: GitHubClient, entries: list[CalendarEntry], message: str) -> None:
    calendar_file = await client.get_file(CALENDAR_PATH)
    payload = json.dumps(
        [e.model_dump(by_alias=True) for e in entries], indent=2, ensure_ascii=False
    )
    await client.put_file(
        CALENDAR_PATH, payload, message, branch="main",
        sha=calendar_file.sha if calendar_file else None,
    )

    readme_file = await client.get_file(README_PATH)
    table = render_readme_table(entries)
    await client.put_file(
        README_PATH, table, message, branch="main",
        sha=readme_file.sha if readme_file else None,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_calendar_store.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/calendar_store.py backend/tests/test_calendar_store.py
git commit -m "feat: calendar.json store with README.md regeneration"
```

---

### Task 5: Calendar API endpoints

**Files:**
- Create: `backend/api/__init__.py`
- Create: `backend/api/calendar.py`
- Modify: `backend/main.py` (mount router)
- Test: `backend/tests/test_calendar_api.py`

**Interfaces:**
- Consumes: `load_calendar`, `save_calendar`, `CalendarEntry` (Task 4).
- Produces: `GET /api/calendar` (list), `GET /api/calendar/{id}` (one, 404 if missing),
  `POST /api/calendar` (append new entry, id auto-assigned as `str(len(entries)+1)`),
  `PUT /api/calendar/{id}` (replace one entry's fields, 404 if missing). Frontend Task 6
  calls these exact routes.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_calendar_api.py`:
```python
import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

from backend.main import app
from backend.calendar_store import CalendarEntry

ENTRY = CalendarEntry(
    id="1", title="Test Article", slug="blog-test", wp="Lead Generation", track="B",
    source="star-schreder-lead-qualification", category="deal-generation",
    format="Long-form Insight", publish_target="2026-10-15", status="idea",
    draft_file="drafts/06-blog-lead-generation.md", hero_image=None, teaser="",
)

client = TestClient(app)


@patch("backend.api.calendar.load_calendar", new_callable=AsyncMock)
def test_list_calendar(mock_load):
    mock_load.return_value = [ENTRY]
    resp = client.get("/api/calendar")
    assert resp.status_code == 200
    assert resp.json()[0]["title"] == "Test Article"


@patch("backend.api.calendar.load_calendar", new_callable=AsyncMock)
def test_get_one_entry(mock_load):
    mock_load.return_value = [ENTRY]
    resp = client.get("/api/calendar/1")
    assert resp.status_code == 200
    assert resp.json()["slug"] == "blog-test"


@patch("backend.api.calendar.load_calendar", new_callable=AsyncMock)
def test_get_missing_entry_404(mock_load):
    mock_load.return_value = [ENTRY]
    resp = client.get("/api/calendar/999")
    assert resp.status_code == 404


@patch("backend.api.calendar.save_calendar", new_callable=AsyncMock)
@patch("backend.api.calendar.load_calendar", new_callable=AsyncMock)
def test_update_entry_status(mock_load, mock_save):
    mock_load.return_value = [ENTRY]
    updated = ENTRY.model_dump(by_alias=True)
    updated["status"] = "drafting"
    resp = client.put("/api/calendar/1", json=updated)
    assert resp.status_code == 200
    assert resp.json()["status"] == "drafting"
    saved_entries = mock_save.call_args.args[1]
    assert saved_entries[0].status == "drafting"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_calendar_api.py -v`
Expected: FAIL — 404 on all routes (router not mounted / module missing).

- [ ] **Step 3: Write `backend/api/calendar.py`**

```python
from fastapi import APIRouter, HTTPException

from backend.calendar_store import CalendarEntry, load_calendar, save_calendar
from backend.github_client import GitHubClient
from backend.config import settings

router = APIRouter()


def _client() -> GitHubClient:
    return GitHubClient(settings.GITHUB_TOKEN, settings.GITHUB_OWNER, settings.GITHUB_REPO)


@router.get("", response_model=list[CalendarEntry])
async def list_entries():
    return await load_calendar(_client())


@router.get("/{entry_id}", response_model=CalendarEntry)
async def get_entry(entry_id: str):
    entries = await load_calendar(_client())
    for e in entries:
        if e.id == entry_id:
            return e
    raise HTTPException(status_code=404, detail="Calendar entry not found")


@router.post("", response_model=CalendarEntry)
async def create_entry(entry: CalendarEntry):
    client = _client()
    entries = await load_calendar(client)
    entries.append(entry)
    await save_calendar(client, entries, message=f"chore: add calendar entry {entry.title}")
    return entry


@router.put("/{entry_id}", response_model=CalendarEntry)
async def update_entry(entry_id: str, entry: CalendarEntry):
    client = _client()
    entries = await load_calendar(client)
    for i, e in enumerate(entries):
        if e.id == entry_id:
            entries[i] = entry
            await save_calendar(client, entries, message=f"chore: update calendar entry {entry.title}")
            return entry
    raise HTTPException(status_code=404, detail="Calendar entry not found")
```

- [ ] **Step 4: Mount the router in `backend/main.py`**

Add near the top imports:
```python
from backend.api.calendar import router as calendar_router
```

Add after the `app = FastAPI(...)` block:
```python
app.include_router(calendar_router, prefix="/api/calendar", tags=["calendar"])
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_calendar_api.py -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/api/calendar.py backend/main.py backend/tests/test_calendar_api.py
git commit -m "feat: calendar CRUD API"
```

---

### Task 6: Planner UI

**Files:**
- Create: `frontend/src/api.ts`
- Create: `frontend/src/components/CalendarTable.tsx`
- Modify: `frontend/src/pages/PlannerPage.tsx`

**Interfaces:**
- Consumes: `GET /api/calendar`, `PUT /api/calendar/{id}` (Task 5), `CalendarEntry`
  (Task 2's `types.ts`).
- Produces: `fetchCalendar()`, `updateCalendarEntry()` in `api.ts` — Tasks 8/17 reuse
  these for the writer and publish pages.

- [ ] **Step 1: Write `frontend/src/api.ts`**

```typescript
import type { CalendarEntry } from './types'

const BASE = '/api'

export async function fetchCalendar(): Promise<CalendarEntry[]> {
  const resp = await fetch(`${BASE}/calendar`)
  if (!resp.ok) throw new Error('Failed to load calendar')
  return resp.json()
}

export async function fetchCalendarEntry(id: string): Promise<CalendarEntry> {
  const resp = await fetch(`${BASE}/calendar/${id}`)
  if (!resp.ok) throw new Error('Failed to load entry')
  return resp.json()
}

export async function updateCalendarEntry(entry: CalendarEntry): Promise<CalendarEntry> {
  const resp = await fetch(`${BASE}/calendar/${entry.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  })
  if (!resp.ok) throw new Error('Failed to update entry')
  return resp.json()
}
```

- [ ] **Step 2: Write `frontend/src/components/CalendarTable.tsx`**

```tsx
import { Link } from 'react-router-dom'
import type { CalendarEntry } from '../types'

export default function CalendarTable({ entries }: { entries: CalendarEntry[] }) {
  const sorted = [...entries].sort((a, b) => a.publishTarget.localeCompare(b.publishTarget))
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {['WP', 'Track', 'Category', 'Format', 'Status', 'Publish target', ''].map((h) => (
            <th key={h} style={{ textAlign: 'left', borderBottom: '2px solid #ddd', padding: 8 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((e) => (
          <tr key={e.id} style={{ borderBottom: '1px solid #eee' }}>
            <td style={{ padding: 8 }}>{e.wp}</td>
            <td style={{ padding: 8 }}>{e.track}</td>
            <td style={{ padding: 8 }}>{e.category}</td>
            <td style={{ padding: 8 }}>{e.format}</td>
            <td style={{ padding: 8 }}>{e.status}</td>
            <td style={{ padding: 8 }}>{e.publishTarget}</td>
            <td style={{ padding: 8 }}>
              <Link to={`/write/${e.id}`}>Open</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 3: Write `frontend/src/pages/PlannerPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import CalendarTable from '../components/CalendarTable'
import { fetchCalendar } from '../api'
import type { CalendarEntry } from '../types'

export default function PlannerPage() {
  const [entries, setEntries] = useState<CalendarEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchCalendar().then(setEntries).catch((e) => setError(e.message))
  }, [])

  if (error) return <p style={{ color: 'crimson' }}>{error}</p>
  return (
    <div>
      <h1>Editorial Queue</h1>
      <CalendarTable entries={entries} />
    </div>
  )
}
```

- [ ] **Step 4: Build and verify**

Run: `cd frontend && npm run build && echo BUILD_OK`
Expected: `BUILD_OK`, no TypeScript errors.

- [ ] **Step 5: Manual smoke check**

Run backend (`.venv/bin/uvicorn backend.main:app --reload --port 8006`) and frontend
(`npm run dev`) together, with a real `GITHUB_TOKEN` in `.env` pointed at
`PathwayGTM_website`. Visit `http://localhost:5173/` and confirm the table renders once
Task 23's backfill has populated `drafts/calendar.json` (empty table is expected before
that).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api.ts frontend/src/components/CalendarTable.tsx frontend/src/pages/PlannerPage.tsx
git commit -m "feat: planner queue view"
```

---

### Task 7: Draft API endpoints

**Files:**
- Create: `backend/api/drafts.py`
- Modify: `backend/main.py` (mount router)
- Test: `backend/tests/test_drafts_api.py`

**Interfaces:**
- Consumes: `GitHubClient`, `CalendarEntry`, `load_calendar`, `save_calendar` (Tasks 3-4).
- Produces: `GET /api/drafts/{id}` → `{entry: CalendarEntry, body: str}`,
  `PUT /api/drafts/{id}` → accepts `{entry: CalendarEntry, body: str}`, writes the
  markdown file and the updated entry, returns the same shape. Frontend Task 8 consumes
  this exact shape.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_drafts_api.py`:
```python
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

from backend.main import app
from backend.calendar_store import CalendarEntry
from backend.github_client import FileContent

ENTRY = CalendarEntry(
    id="2", title="Agility & Coordination", slug="blog-agility-coordination",
    wp="Agility & Coordination", track="B", source="star-hyperion-team-recovery",
    category="gtm-readiness", format="Long-form Insight", publish_target="2026-08-20",
    status="drafting", draft_file="drafts/02-blog-agility-coordination.md",
    hero_image=None, teaser="",
)

client = TestClient(app)


@patch("backend.api.drafts.GitHubClient.get_file", new_callable=AsyncMock)
@patch("backend.api.drafts.load_calendar", new_callable=AsyncMock)
def test_get_draft_returns_entry_and_body(mock_load, mock_get_file):
    mock_load.return_value = [ENTRY]
    mock_get_file.return_value = FileContent(path=ENTRY.draft_file, content="# Draft body", sha="s1")
    resp = client.get("/api/drafts/2")
    assert resp.status_code == 200
    data = resp.json()
    assert data["body"] == "# Draft body"
    assert data["entry"]["title"] == "Agility & Coordination"


@patch("backend.api.drafts.GitHubClient.put_file", new_callable=AsyncMock)
@patch("backend.api.drafts.GitHubClient.get_file", new_callable=AsyncMock)
@patch("backend.api.drafts.save_calendar", new_callable=AsyncMock)
@patch("backend.api.drafts.load_calendar", new_callable=AsyncMock)
def test_put_draft_saves_body_and_entry(mock_load, mock_save, mock_get_file, mock_put_file):
    mock_load.return_value = [ENTRY]
    mock_get_file.return_value = FileContent(path=ENTRY.draft_file, content="old", sha="old-sha")
    updated_entry = ENTRY.model_dump(by_alias=True)
    updated_entry["status"] = "ready-for-review"
    resp = client.put("/api/drafts/2", json={"entry": updated_entry, "body": "# New body"})
    assert resp.status_code == 200
    mock_put_file.assert_called_once()
    assert mock_put_file.call_args.args[1] == "# New body"
    saved_entries = mock_save.call_args.args[1]
    assert saved_entries[0].status == "ready-for-review"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_drafts_api.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `backend/api/drafts.py`**

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.calendar_store import CalendarEntry, load_calendar, save_calendar
from backend.github_client import GitHubClient
from backend.config import settings

router = APIRouter()


class DraftPayload(BaseModel):
    entry: CalendarEntry
    body: str


def _client() -> GitHubClient:
    return GitHubClient(settings.GITHUB_TOKEN, settings.GITHUB_OWNER, settings.GITHUB_REPO)


async def _find_entry(entries: list[CalendarEntry], entry_id: str) -> CalendarEntry:
    for e in entries:
        if e.id == entry_id:
            return e
    raise HTTPException(status_code=404, detail="Draft not found")


@router.get("/{entry_id}", response_model=DraftPayload)
async def get_draft(entry_id: str):
    client = _client()
    entries = await load_calendar(client)
    entry = await _find_entry(entries, entry_id)
    file = await client.get_file(entry.draft_file)
    body = file.content if file else ""
    return DraftPayload(entry=entry, body=body)


@router.put("/{entry_id}", response_model=DraftPayload)
async def put_draft(entry_id: str, payload: DraftPayload):
    client = _client()
    entries = await load_calendar(client)
    await _find_entry(entries, entry_id)  # 404s if missing

    existing_file = await client.get_file(payload.entry.draft_file)
    await client.put_file(
        payload.entry.draft_file, payload.body,
        message=f"docs: update draft {payload.entry.title}",
        branch="main", sha=existing_file.sha if existing_file else None,
    )

    entries = [payload.entry if e.id == entry_id else e for e in entries]
    await save_calendar(client, entries, message=f"chore: update calendar entry {payload.entry.title}")
    return payload
```

- [ ] **Step 4: Mount the router in `backend/main.py`**

```python
from backend.api.drafts import router as drafts_router
...
app.include_router(drafts_router, prefix="/api/drafts", tags=["drafts"])
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_drafts_api.py -v`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/api/drafts.py backend/main.py backend/tests/test_drafts_api.py
git commit -m "feat: draft read/write API"
```

---

### Task 8: Writer UI

**Files:**
- Create: `frontend/src/components/MarkdownEditor.tsx`
- Modify: `frontend/src/pages/WriterPage.tsx`
- Modify: `frontend/src/api.ts` (add `fetchDraft`, `saveDraft`)

**Interfaces:**
- Consumes: `GET/PUT /api/drafts/{id}` (Task 7).
- Produces: the mounted `<textarea>` + preview + metadata form Task 13's `AssistPanel`
  slots into.

- [ ] **Step 1: Extend `frontend/src/api.ts`**

```typescript
import type { CalendarEntry } from './types'

export interface DraftPayload {
  entry: CalendarEntry
  body: string
}

export async function fetchDraft(id: string): Promise<DraftPayload> {
  const resp = await fetch(`${BASE}/drafts/${id}`)
  if (!resp.ok) throw new Error('Failed to load draft')
  return resp.json()
}

export async function saveDraft(id: string, payload: DraftPayload): Promise<DraftPayload> {
  const resp = await fetch(`${BASE}/drafts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) throw new Error('Failed to save draft')
  return resp.json()
}
```
(Append these below the existing `fetchCalendar`/`updateCalendarEntry` functions; keep the
`const BASE = '/api'` declaration already there — don't redeclare it.)

- [ ] **Step 2: Write `frontend/src/components/MarkdownEditor.tsx`**

```tsx
import ReactMarkdown from 'react-markdown'

export default function MarkdownEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 16, minHeight: 500 }}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1, fontFamily: 'monospace', fontSize: 14, padding: 12 }}
      />
      <div style={{ flex: 1, padding: 12, border: '1px solid #ddd', overflowY: 'auto' }}>
        <ReactMarkdown>{value}</ReactMarkdown>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write `frontend/src/pages/WriterPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import MarkdownEditor from '../components/MarkdownEditor'
import { fetchDraft, saveDraft, type DraftPayload } from '../api'

export default function WriterPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<DraftPayload | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (id) fetchDraft(id).then(setDraft)
  }, [id])

  if (!draft || !id) return <p>Loading…</p>

  const handleSave = async (status?: DraftPayload['entry']['status']) => {
    setSaving(true)
    const entry = status ? { ...draft.entry, status } : draft.entry
    const updated = await saveDraft(id, { entry, body: draft.body })
    setDraft(updated)
    setSaving(false)
  }

  return (
    <div>
      <h1>{draft.entry.title}</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={draft.entry.teaser}
          placeholder="Teaser / meta description"
          onChange={(e) => setDraft({ ...draft, entry: { ...draft.entry, teaser: e.target.value } })}
          style={{ flex: 1 }}
        />
        <input
          value={draft.entry.heroImage ?? ''}
          placeholder="Hero image path"
          onChange={(e) => setDraft({ ...draft, entry: { ...draft.entry, heroImage: e.target.value } })}
          style={{ flex: 1 }}
        />
      </div>
      <MarkdownEditor value={draft.body} onChange={(body) => setDraft({ ...draft, body })} />
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button disabled={saving} onClick={() => handleSave()}>Save</button>
        <button disabled={saving} onClick={() => handleSave('ready-for-review')}>Mark ready for publish</button>
        <button onClick={() => navigate(`/publish/${id}`)}>Go to publish</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Build and verify**

Run: `cd frontend && npm run build && echo BUILD_OK`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/components/MarkdownEditor.tsx frontend/src/pages/WriterPage.tsx
git commit -m "feat: writer view with markdown editor + preview"
```

---

### Task 9: Anthropic client wrapper

**Files:**
- Create: `backend/anthropic_client.py`
- Test: `backend/tests/test_anthropic_client.py`

**Interfaces:**
- Consumes: `backend.config.settings` (`ANTHROPIC_API_KEY`, `CLAUDE_MODEL`).
- Produces: `async def complete(system: str, user: str, model: str | None = None) -> str`
  — every later AI-backed task (10, 11, 12, 17, 18, 20) calls this one function; no task
  talks to the `anthropic` SDK directly.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_anthropic_client.py`:
```python
from unittest.mock import AsyncMock, patch
import pytest

from backend.anthropic_client import complete


class _FakeTextBlock:
    def __init__(self, text):
        self.text = text


class _FakeMessage:
    def __init__(self, text):
        self.content = [_FakeTextBlock(text)]


@pytest.mark.asyncio
async def test_complete_returns_response_text():
    fake_client = AsyncMock()
    fake_client.messages.create = AsyncMock(return_value=_FakeMessage("hello from claude"))
    with patch("backend.anthropic_client._client", return_value=fake_client):
        result = await complete(system="You are terse.", user="Say hi.")
    assert result == "hello from claude"
    fake_client.messages.create.assert_called_once()
    call_kwargs = fake_client.messages.create.call_args.kwargs
    assert call_kwargs["system"] == "You are terse."
    assert call_kwargs["messages"] == [{"role": "user", "content": "Say hi."}]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_anthropic_client.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `backend/anthropic_client.py`**

```python
import anthropic

from backend.config import settings

_MAX_TOKENS = 4096


def _client() -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)


async def complete(system: str, user: str, model: str | None = None) -> str:
    client = _client()
    response = await client.messages.create(
        model=model or settings.CLAUDE_MODEL,
        max_tokens=_MAX_TOKENS,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return response.content[0].text
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_anthropic_client.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/anthropic_client.py backend/tests/test_anthropic_client.py
git commit -m "feat: Anthropic client wrapper"
```

---

### Task 10: Assist API — principles check

**Files:**
- Create: `backend/api/assist.py`
- Modify: `backend/main.py` (mount router)
- Test: `backend/tests/test_assist_api.py`

**Interfaces:**
- Consumes: `complete` (Task 9), `GitHubClient.get_file` (Task 3), `load_calendar`
  (Task 4).
- Produces: `POST /api/assist/principles-check` accepting `{"draftId": str}`, returning
  `{"raw": str}` (the model's full response — kept as free text rather than forcing a
  brittle JSON contract, since these are editorial judgment calls Pedro reads directly,
  not machine-parsed data). Tasks 11-12 in this same file follow the identical
  `{"draftId": ...} -> {"raw": str}` shape.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_assist_api.py`:
```python
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

from backend.main import app
from backend.calendar_store import CalendarEntry
from backend.github_client import FileContent

ENTRY = CalendarEntry(
    id="2", title="Agility & Coordination", slug="blog-agility-coordination",
    wp="Agility & Coordination", track="B", source="star-hyperion-team-recovery",
    category="gtm-readiness", format="Long-form Insight", publish_target="2026-08-20",
    status="drafting", draft_file="drafts/02-blog-agility-coordination.md",
    hero_image=None, teaser="",
)

client = TestClient(app)


@patch("backend.api.assist.complete", new_callable=AsyncMock)
@patch("backend.api.assist.GitHubClient.get_file", new_callable=AsyncMock)
@patch("backend.api.assist.load_calendar", new_callable=AsyncMock)
def test_principles_check(mock_load, mock_get_file, mock_complete):
    mock_load.return_value = [ENTRY]
    mock_get_file.side_effect = [
        FileContent(path="drafts/EDITORIAL-PRINCIPLES.md", content="§7 checklist...", sha="p1"),
        FileContent(path=ENTRY.draft_file, content="draft body text", sha="d1"),
    ]
    mock_complete.return_value = "No privileging issues found. Meta description is balanced."

    resp = client.post("/api/assist/principles-check", json={"draftId": "2"})
    assert resp.status_code == 200
    assert "No privileging issues" in resp.json()["raw"]
    system_arg = mock_complete.call_args.kwargs["system"]
    assert "EDITORIAL-PRINCIPLES" in system_arg or "checklist" in system_arg.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_assist_api.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `backend/api/assist.py`** (principles-check only for now — Tasks
  11-12 append to this same file)

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.anthropic_client import complete
from backend.calendar_store import load_calendar
from backend.github_client import GitHubClient
from backend.config import settings

router = APIRouter()


class DraftIdPayload(BaseModel):
    draftId: str


class AssistResponse(BaseModel):
    raw: str


def _client() -> GitHubClient:
    return GitHubClient(settings.GITHUB_TOKEN, settings.GITHUB_OWNER, settings.GITHUB_REPO)


async def _load_entry_and_body(draft_id: str):
    client = _client()
    entries = await load_calendar(client)
    entry = next((e for e in entries if e.id == draft_id), None)
    if entry is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    body_file = await client.get_file(entry.draft_file)
    return client, entry, (body_file.content if body_file else "")


@router.post("/principles-check", response_model=AssistResponse)
async def principles_check(payload: DraftIdPayload):
    client, entry, body = await _load_entry_and_body(payload.draftId)
    principles_file = await client.get_file("drafts/EDITORIAL-PRINCIPLES.md")
    principles = principles_file.content if principles_file else ""

    system = (
        "You are an editorial reviewer for Pathway GTM's blog. Run the §7 "
        "Definition-of-Done checklist from EDITORIAL-PRINCIPLES.md (given below) "
        "against the draft. List every concrete issue found, quoting the offending "
        "phrase. If nothing is wrong, say so plainly instead of inventing a nitpick.\n\n"
        f"EDITORIAL-PRINCIPLES.md:\n{principles}"
    )
    user = f"Draft to review (title: {entry.title}):\n\n{body}"
    result = await complete(system=system, user=user)
    return AssistResponse(raw=result)
```

- [ ] **Step 4: Mount the router in `backend/main.py`**

```python
from backend.api.assist import router as assist_router
...
app.include_router(assist_router, prefix="/api/assist", tags=["assist"])
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_assist_api.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/api/assist.py backend/main.py backend/tests/test_assist_api.py
git commit -m "feat: assist API — principles check"
```

---

### Task 11: Assist API — cross-link suggestions

**Files:**
- Modify: `backend/api/assist.py` (append endpoint)
- Modify: `backend/tests/test_assist_api.py` (append test)

**Interfaces:**
- Consumes: `_load_entry_and_body`, `_client` (Task 10, same file).
- Produces: `POST /api/assist/cross-links` — identical `DraftIdPayload -> AssistResponse`
  shape as Task 10.

- [ ] **Step 1: Append the failing test to `backend/tests/test_assist_api.py`**

```python
@patch("backend.api.assist.complete", new_callable=AsyncMock)
@patch("backend.api.assist.GitHubClient.get_file", new_callable=AsyncMock)
@patch("backend.api.assist.load_calendar", new_callable=AsyncMock)
def test_cross_links_suggestion(mock_load, mock_get_file, mock_complete):
    mock_load.return_value = [ENTRY]
    mock_get_file.side_effect = [
        FileContent(path="drafts/CROSS-LINKS.md", content="| From | To | Status |\n...", sha="c1"),
        FileContent(path=ENTRY.draft_file, content="draft body text", sha="d1"),
    ]
    mock_complete.return_value = "No pending rows reference this article yet."

    resp = client.post("/api/assist/cross-links", json={"draftId": "2"})
    assert resp.status_code == 200
    assert "No pending rows" in resp.json()["raw"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_assist_api.py::test_cross_links_suggestion -v`
Expected: FAIL — 404, route doesn't exist yet.

- [ ] **Step 3: Append to `backend/api/assist.py`**

```python
@router.post("/cross-links", response_model=AssistResponse)
async def cross_links_suggestion(payload: DraftIdPayload):
    client, entry, body = await _load_entry_and_body(payload.draftId)
    links_file = await client.get_file("drafts/CROSS-LINKS.md")
    links = links_file.content if links_file else ""

    system = (
        "You track forward-references between Pathway GTM's blog articles, recorded in "
        "CROSS-LINKS.md (given below). Check whether this draft resolves any pending "
        "row — i.e. an older, already-published article promised content this draft "
        "now delivers. For each match, quote the pending row and suggest the exact "
        "sentence to add/change in the older article. If nothing matches, say so.\n\n"
        f"CROSS-LINKS.md:\n{links}"
    )
    user = f"Draft to check (title: {entry.title}, slug: {entry.slug}):\n\n{body}"
    result = await complete(system=system, user=user)
    return AssistResponse(raw=result)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_assist_api.py -v`
Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add backend/api/assist.py backend/tests/test_assist_api.py
git commit -m "feat: assist API — cross-link suggestions"
```

---

### Task 12: Assist API — ask-AI chat

**Files:**
- Modify: `backend/api/assist.py` (append endpoint)
- Modify: `backend/tests/test_assist_api.py` (append test)

**Interfaces:**
- Consumes: `_load_entry_and_body`, `_client` (Task 10).
- Produces: `POST /api/assist/chat` accepting
  `{"draftId": str, "message": str, "history": list[{"role": str, "content": str}]}`,
  returning `AssistResponse`. Task 13's `AssistPanel` maintains `history` client-side and
  resends it each call (no server-side session state, consistent with this app's
  no-database constraint).

- [ ] **Step 1: Append the failing test**

```python
@patch("backend.api.assist.complete", new_callable=AsyncMock)
@patch("backend.api.assist.GitHubClient.get_file", new_callable=AsyncMock)
@patch("backend.api.assist.load_calendar", new_callable=AsyncMock)
def test_ask_ai_chat(mock_load, mock_get_file, mock_complete):
    mock_load.return_value = [ENTRY]
    mock_get_file.side_effect = [
        FileContent(path="drafts/VOICE-NOTES.md", content="always 'we', never 'I'", sha="v1"),
        FileContent(path=ENTRY.draft_file, content="draft body text", sha="d1"),
    ]
    mock_complete.return_value = "Here's a tighter version of that paragraph: ..."

    resp = client.post("/api/assist/chat", json={
        "draftId": "2", "message": "Tighten the second paragraph.", "history": [],
    })
    assert resp.status_code == 200
    assert "tighter version" in resp.json()["raw"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_assist_api.py::test_ask_ai_chat -v`
Expected: FAIL — 404.

- [ ] **Step 3: Append to `backend/api/assist.py`**

```python
class ChatMessage(BaseModel):
    role: str
    content: str


class ChatPayload(BaseModel):
    draftId: str
    message: str
    history: list[ChatMessage] = []


@router.post("/chat", response_model=AssistResponse)
async def ask_ai_chat(payload: ChatPayload):
    client, entry, body = await _load_entry_and_body(payload.draftId)
    voice_file = await client.get_file("drafts/VOICE-NOTES.md")
    voice = voice_file.content if voice_file else ""

    system = (
        "You are helping Pedro edit a draft for Pathway GTM's blog. Follow "
        f"VOICE-NOTES.md exactly:\n{voice}\n\n"
        f"Current draft (title: {entry.title}):\n{body}"
    )
    history_text = "\n".join(f"{m.role}: {m.content}" for m in payload.history)
    user = f"{history_text}\nuser: {payload.message}" if history_text else payload.message
    result = await complete(system=system, user=user)
    return AssistResponse(raw=result)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_assist_api.py -v`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add backend/api/assist.py backend/tests/test_assist_api.py
git commit -m "feat: assist API — ask-AI chat"
```

---

### Task 13: Assist panel UI

**Files:**
- Create: `frontend/src/components/AssistPanel.tsx`
- Modify: `frontend/src/pages/WriterPage.tsx` (mount panel)
- Modify: `frontend/src/api.ts` (add assist calls)

**Interfaces:**
- Consumes: `POST /api/assist/{principles-check,cross-links,chat}` (Tasks 10-12).

- [ ] **Step 1: Append to `frontend/src/api.ts`**

```typescript
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

async function callAssist(endpoint: string, body: object): Promise<string> {
  const resp = await fetch(`${BASE}/assist/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`Assist call failed: ${endpoint}`)
  const data = await resp.json()
  return data.raw
}

export const checkPrinciples = (draftId: string) => callAssist('principles-check', { draftId })
export const suggestCrossLinks = (draftId: string) => callAssist('cross-links', { draftId })
export const askAi = (draftId: string, message: string, history: ChatMessage[]) =>
  callAssist('chat', { draftId, message, history })
```

- [ ] **Step 2: Write `frontend/src/components/AssistPanel.tsx`**

```tsx
import { useState } from 'react'
import { checkPrinciples, suggestCrossLinks, askAi, type ChatMessage } from '../api'

export default function AssistPanel({ draftId }: { draftId: string }) {
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [message, setMessage] = useState('')

  const run = async (fn: () => Promise<string>) => {
    setLoading(true)
    try {
      setOutput(await fn())
    } finally {
      setLoading(false)
    }
  }

  const sendChat = async () => {
    if (!message.trim()) return
    const nextHistory = [...history, { role: 'user' as const, content: message }]
    setHistory(nextHistory)
    setMessage('')
    await run(async () => {
      const reply = await askAi(draftId, message, history)
      setHistory([...nextHistory, { role: 'assistant', content: reply }])
      return reply
    })
  }

  return (
    <div style={{ border: '1px solid #ddd', padding: 12, marginTop: 16 }}>
      <h3>Assist</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button disabled={loading} onClick={() => run(() => checkPrinciples(draftId))}>
          Check against principles
        </button>
        <button disabled={loading} onClick={() => run(() => suggestCrossLinks(draftId))}>
          Suggest cross-links
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          style={{ flex: 1 }}
          value={message}
          placeholder="Ask AI (e.g. tighten the second paragraph)"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendChat()}
        />
        <button disabled={loading} onClick={sendChat}>Send</button>
      </div>
      {loading && <p>Thinking…</p>}
      {output && <pre style={{ whiteSpace: 'pre-wrap' }}>{output}</pre>}
    </div>
  )
}
```

- [ ] **Step 3: Mount in `frontend/src/pages/WriterPage.tsx`**

Add the import:
```tsx
import AssistPanel from '../components/AssistPanel'
```

Add just before the closing `</div>` of the component's returned JSX (after the
save-button row):
```tsx
      <AssistPanel draftId={id} />
```

- [ ] **Step 4: Build and verify**

Run: `cd frontend && npm run build && echo BUILD_OK`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/components/AssistPanel.tsx frontend/src/pages/WriterPage.tsx
git commit -m "feat: assist panel UI (principles check, cross-links, ask-AI chat)"
```

---

### Task 14: Taxonomy module

**Files:**
- Create: `backend/taxonomy.py`
- Test: `backend/tests/test_taxonomy.py`

**Interfaces:**
- Produces: `WP_TO_CATEGORY: dict[str, str]`, `CATEGORY_LABELS: dict[str, str]`,
  `def category_for_wp(wp: str) -> str` (raises `KeyError` on unknown WP — surfaces
  taxonomy gaps loudly rather than silently defaulting), `def compute_read_time(markdown_body: str) -> str`
  (e.g. `"7 min read"`). Task 15/16 (templating) call both.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_taxonomy.py`:
```python
import pytest
from backend.taxonomy import category_for_wp, compute_read_time, CATEGORY_LABELS


def test_category_for_known_wps():
    assert category_for_wp("GTM Target & Strategy") == "gtm-readiness"
    assert category_for_wp("Agility & Coordination") == "gtm-readiness"
    assert category_for_wp("Lead Generation") == "deal-generation"
    assert category_for_wp("Expand") == "customer-success"
    assert category_for_wp("Govern & Steer") == "govern-steer"


def test_category_for_unknown_wp_raises():
    with pytest.raises(KeyError):
        category_for_wp("Not A Real WP")


def test_category_labels_cover_all_four():
    assert set(CATEGORY_LABELS.keys()) == {
        "gtm-readiness", "deal-generation", "customer-success", "govern-steer",
    }
    assert CATEGORY_LABELS["gtm-readiness"] == "GTM Readiness"


def test_compute_read_time_rounds_to_nearest_minute():
    body = " ".join(["word"] * 1400)  # 1400 words / 200 wpm = 7.0
    assert compute_read_time(body) == "7 min read"


def test_compute_read_time_floors_at_one_minute():
    assert compute_read_time("short draft") == "1 min read"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_taxonomy.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `backend/taxonomy.py`**

```python
WP_TO_CATEGORY: dict[str, str] = {
    # Module 1 — GTM Readiness / Business Alignment
    "GTM Target & Strategy": "gtm-readiness",
    "ICP & Customer Experience": "gtm-readiness",
    "Customer Messaging": "gtm-readiness",
    "Governance & Steering": "gtm-readiness",
    # Module 1 — GTM Readiness / Operational Enablement
    "Engagement Tools": "gtm-readiness",
    "Metrics & KPIs": "gtm-readiness",
    "Agility & Coordination": "gtm-readiness",
    "Capabilities": "gtm-readiness",
    "Skills & Competency": "gtm-readiness",
    "Incentives": "gtm-readiness",
    # Module 2 — Deal Generation
    "Demand Creation": "deal-generation",
    "Lead Generation": "deal-generation",
    "Deal Closure": "deal-generation",
    "Commercial Management": "deal-generation",
    # Module 3 — Customer Success
    "Onboard": "customer-success",
    "Support": "customer-success",
    "Expand": "customer-success",
    # Module 4 — Govern & Steer (cross-cutting)
    "Govern & Steer": "govern-steer",
}

CATEGORY_LABELS: dict[str, str] = {
    "gtm-readiness": "GTM Readiness",
    "deal-generation": "Deal Generation",
    "customer-success": "Customer Success",
    "govern-steer": "Govern & Steer",
}

_WORDS_PER_MINUTE = 200


def category_for_wp(wp: str) -> str:
    return WP_TO_CATEGORY[wp]


def compute_read_time(markdown_body: str) -> str:
    word_count = len(markdown_body.split())
    minutes = max(1, round(word_count / _WORDS_PER_MINUTE))
    return f"{minutes} min read"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_taxonomy.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/taxonomy.py backend/tests/test_taxonomy.py
git commit -m "feat: WP-to-category taxonomy and read-time calc"
```

---

### Task 15: Markdown body templating (mistune)

**Files:**
- Create: `backend/templating.py`
- Test: `backend/tests/test_templating.py`

**Interfaces:**
- Produces: `def render_body(markdown_body: str) -> str` — converts a draft's markdown
  into the site's `.article-prose` inner HTML, per these rules (fixed by this task, used
  by every draft going forward):
  1. Prose (paragraphs, `**bold**`, `*italic*`, links, `## `/`### ` headings, `> `
     blockquotes, `- ` lists) — standard Markdown, no special handling.
  2. Images: `![banner](path)` → `<img src="path" alt="" class="diagram-img diagram-img--banner" />`;
     `![float](path)` → `class="diagram-img diagram-img-float"`; any other alt text →
     plain `class="diagram-img"`.
  3. A checklist table (a Markdown table immediately preceded by a paragraph starting
     with the literal marker `[[checklist]]`) renders as `<dl class="checklist-grid">`,
     row N gets `<span class="checklist-num">NN</span>` (zero-padded, continuing the
     running count across the whole document — not reset per table, matching the
     10-point checklist's 01-04 / 05-10 split across two `<h3>`-separated tables).
  4. Any other Markdown table renders as `<table class="info-table">` (`info-table--wide`
     added when the table has more than 3 columns).
- Task 16 wraps this function's output into the full page.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_templating.py`:
```python
from backend.templating import render_body


def test_prose_renders_standard_html():
    html = render_body("Ask five executives and you'll get five **different** answers.")
    assert "<p>Ask five executives and you&rsquo;ll get five" in html or \
           "<p>Ask five executives and you'll get five <strong>different</strong> answers.</p>" in html


def test_banner_image_gets_banner_class():
    html = render_body("![banner](Site Assets/Blog_Images/x.jpg)")
    assert 'class="diagram-img diagram-img--banner"' in html
    assert 'src="Site Assets/Blog_Images/x.jpg"' in html


def test_float_image_gets_float_class():
    html = render_body("![float](Site Assets/Diagrams_Explainers/x.png)")
    assert 'class="diagram-img diagram-img-float"' in html


def test_plain_image_gets_base_class_only():
    html = render_body("![](Site Assets/Diagrams_Explainers/x.png)")
    assert 'class="diagram-img"' in html
    assert 'diagram-img--banner' not in html


def test_checklist_marked_table_renders_as_dl():
    md = (
        "[[checklist]]\n\n"
        "| WP | Content |\n"
        "|---|---|\n"
        "| GTM Target & Strategy | Could your leadership team agree independently? |\n"
        "| ICP & Customer Experience | Can every salesperson state it the same way? |\n"
    )
    html = render_body(md)
    assert '<dl class="checklist-grid">' in html
    assert '<span class="checklist-num">01</span>' in html
    assert '<span class="checklist-wp">GTM Target &amp; Strategy</span>' in html
    assert '<span class="checklist-num">02</span>' in html


def test_checklist_numbering_continues_across_two_tables():
    md = (
        "[[checklist]]\n\n| WP | Content |\n|---|---|\n| One | a |\n| Two | b |\n\n"
        "[[checklist]]\n\n| WP | Content |\n|---|---|\n| Three | c |\n"
    )
    html = render_body(md)
    assert '<span class="checklist-num">01</span>' in html
    assert '<span class="checklist-num">03</span>' in html


def test_plain_table_renders_as_info_table():
    md = "| A | B |\n|---|---|\n| 1 | 2 |\n"
    html = render_body(md)
    assert '<table class="info-table">' in html


def test_wide_table_gets_wide_modifier():
    md = "| A | B | C | D |\n|---|---|---|---|\n| 1 | 2 | 3 | 4 |\n"
    html = render_body(md)
    assert 'class="info-table info-table--wide"' in html
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_templating.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `backend/templating.py`**

```python
import re

import mistune
from mistune.renderers.html import HTMLRenderer

_CHECKLIST_MARKER = "[[checklist]]"


class _SiteRenderer(HTMLRenderer):
    def __init__(self):
        super().__init__()
        self._checklist_counter = 0
        self._pending_checklist = False

    def paragraph(self, text: str) -> str:
        stripped = text.strip()
        if stripped == _CHECKLIST_MARKER:
            self._pending_checklist = True
            return ""
        return super().paragraph(text)

    def image(self, text: str, url: str, title: str | None = None) -> str:
        variant = {"banner": " diagram-img--banner", "float": " diagram-img-float"}.get(text, "")
        cls = f"diagram-img{variant}"
        return f'<img src="{url}" alt="" class="{cls}" />'

    def table(self, text: str) -> str:
        if self._pending_checklist:
            self._pending_checklist = False
            return self._render_checklist_table(text)
        col_count = text.count("<th") or text.count("<td") // max(text.count("<tr"), 1)
        wide = " info-table--wide" if col_count > 3 else ""
        return f'<table class="info-table{wide}">{text}</table>'

    def table_head(self, text: str) -> str:
        return ""  # header row (WP / Content) is structural only, not shown in the dl/table

    def table_body(self, text: str) -> str:
        return text

    def table_row(self, text: str) -> str:
        return text

    def table_cell(self, text: str, align=None, head=False) -> str:
        return f"\x1f{text}\x1f"

    def _render_checklist_table(self, raw_rows: str) -> str:
        rows = []
        for row_text in raw_rows.split("\x1f\x1f")[:-1]:
            cells = [c for c in row_text.split("\x1f") if c != ""]
            if len(cells) >= 2:
                rows.append((cells[0], cells[1]))
        out = ['<dl class="checklist-grid">']
        for wp, content in rows:
            self._checklist_counter += 1
            num = f"{self._checklist_counter:02d}"
            out.append(
                '<div class="checklist-row">'
                f'<dt class="checklist-label"><span class="checklist-num">{num}</span>'
                f'<span class="checklist-wp">{wp}</span></dt>'
                f'<dd class="checklist-content"><p>{content}</p></dd>'
                "</div>"
            )
        out.append("</dl>")
        return "".join(out)


_renderer = _SiteRenderer()
_markdown = mistune.create_markdown(renderer=_renderer, plugins=["table"])


def render_body(markdown_body: str) -> str:
    _renderer._checklist_counter = 0
    _renderer._pending_checklist = False
    html = _markdown(markdown_body)
    return re.sub(r"\x1f", "", html)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_templating.py -v`

If the `table_cell`/`table_row` delimiter approach doesn't line up with the installed
`mistune` version's exact callback signatures (mistune's table plugin API has shifted
across 2.x/3.x point releases), inspect the actual arguments mistune passes by adding a
temporary `print(text)` inside `table_row`/`table_cell` and re-running — adjust the
`\x1f`-splitting logic in `_render_checklist_table` to match what's actually received,
keeping the public `render_body` contract and all 8 tests passing.
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/templating.py backend/tests/test_templating.py
git commit -m "feat: markdown-to-article-prose templating engine"
```

---

### Task 16: Full page template

**Files:**
- Create: `backend/page_template.py`
- Test: `backend/tests/test_page_template.py`

**Interfaces:**
- Consumes: `render_body` (Task 15), `category_for_wp`, `CATEGORY_LABELS`,
  `compute_read_time` (Task 14).
- Produces: `def render_page(entry: CalendarEntry, markdown_body: str, prev_link: NavLink | None, next_link: NavLink | None) -> str`
  (`NavLink(slug: str, title: str)`) — returns the complete article HTML file content.
  Task 17 (preview) and Task 21 (publish commit) both call this.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_page_template.py`:
```python
from backend.calendar_store import CalendarEntry
from backend.page_template import render_page, NavLink

ENTRY = CalendarEntry(
    id="2", title="Agility & Coordination", slug="blog-agility-coordination",
    wp="Agility & Coordination", track="B", source="star-hyperion-team-recovery",
    category="gtm-readiness", format="Long-form Insight", publish_target="2026-08-20",
    status="ready-for-review", draft_file="drafts/02-blog-agility-coordination.md",
    hero_image="Site Assets/Blog_Images/agility-banner.jpg",
    teaser="Two real stories about scaling a team without breaking it.",
)


def test_render_page_includes_title_and_meta():
    html = render_page(ENTRY, "Body text here.", prev_link=None, next_link=None)
    assert "<title>Agility &amp; Coordination | Beyond the Brief</title>" in html
    assert 'content="Two real stories about scaling a team without breaking it."' in html


def test_render_page_includes_meta_bar_fields():
    html = render_page(ENTRY, "word " * 400, prev_link=None, next_link=None)
    assert "<span>GTM Readiness</span>" not in html  # category is the .tag span, not a bare span
    assert '<span class="tag">GTM Readiness</span>' in html
    assert "<span>Long-form Insight</span>" in html
    assert "<span>2 min read</span>" in html


def test_render_page_includes_body_html():
    html = render_page(ENTRY, "Some **bold** body content.", prev_link=None, next_link=None)
    assert "<strong>bold</strong>" in html
    assert 'class="article-prose"' in html


def test_render_page_nav_bar_with_both_links():
    html = render_page(
        ENTRY, "Body.",
        prev_link=NavLink(slug="blog-gtm-health-check", title="Pathway's 10-Point GTM Health Check"),
        next_link=NavLink(slug="blog-gtm-target-strategy", title="GTM Target & Strategy"),
    )
    assert '<a href="blog-gtm-health-check.html" class="article-nav-prev">← Pathway\'s 10-Point GTM Health Check</a>' in html
    assert '<a href="blog-gtm-target-strategy.html" class="article-nav-next">GTM Target & Strategy →</a>' in html


def test_render_page_nav_bar_with_only_next_link_right_aligns():
    html = render_page(
        ENTRY, "Body.", prev_link=None,
        next_link=NavLink(slug="blog-gtm-target-strategy", title="GTM Target & Strategy"),
    )
    assert 'style="margin-left:auto;"' in html
    assert "article-nav-prev" not in html


def test_render_page_hero_image_included():
    html = render_page(ENTRY, "Body.", prev_link=None, next_link=None)
    assert 'src="Site%20Assets/Blog_Images/agility-banner.jpg"' in html
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_page_template.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `backend/page_template.py`**

```python
from dataclasses import dataclass
from urllib.parse import quote

from backend.calendar_store import CalendarEntry
from backend.taxonomy import category_for_wp, CATEGORY_LABELS, compute_read_time
from backend.templating import render_body

_NAV_LINKS = """    <ul class="nav-links">
      <li><a href="who-we-serve.html" class="nav-link">Who We Serve</a></li>
      <li><a href="what-we-do.html" class="nav-link">What We Do</a></li>
      <li><a href="n2-framework.html" class="nav-link">The N&sup2; Frame</a></li>
      <li><a href="beyond-the-brief.html" class="nav-link active">Beyond the Brief</a></li>
      <li><a href="pathways-story.html" class="nav-link">Pathway's Story</a></li>
      <li><a href="partner.html" class="nav-link">Partner</a></li>
      <li><a href="reach-out.html" class="nav-link nav-cta">Reach Out</a></li>
    </ul>"""

_FOOTER = """<footer>
  <div class="footer-inner">
    <div class="footer-grid">
      <div class="footer-brand">
        <img src="Site%20Assets/Logo/PATHWAY-CIRCLE_white.png" alt="Pathway GTM" />
        <p>No-nonsense go-to-market consulting for B2B mid-caps and fast-growing startups.</p>
        <div class="footer-contact">
          <a href="mailto:hello@pathwaygtm.com">hello@pathwaygtm.com</a>
          <a href="https://wa.me/351919671584">+351.919 671 584</a>
        </div>
      </div>
      <div class="footer-col"><h5>Services</h5><div class="footer-links"><a href="what-we-do.html#strategic-advisory">Strategic Advisory</a><a href="what-we-do.html#fractional-leadership">Fractional Leadership</a><a href="what-we-do.html#embedded-shadowing">Embedded Shadowing</a><a href="what-we-do.html#program-management">Program Management</a><a href="what-we-do.html#technology-enablement">Technology Enablement</a></div></div>
      <div class="footer-col"><h5>Company</h5><div class="footer-links"><a href="pathways-story.html">Pathway's Story</a><a href="who-we-serve.html">Who We Serve</a><a href="n2-framework.html">The N&sup2; Frame</a><a href="partner.html">Partner with Us</a></div></div>
      <div class="footer-col"><h5>Insights</h5><div class="footer-links"><a href="beyond-the-brief.html">Beyond the Brief</a><a href="reach-out.html">Reach Out</a></div></div>
    </div>
    <div class="footer-bottom"><span>&copy; 2026 Pathway GTM. All rights reserved.</span><span>hello@pathwaygtm.com</span></div>
  </div>
</footer>

<script>
  function toggleMenu() { document.getElementById('mobileMenu').classList.toggle('open'); }
  document.addEventListener('click', function(e) {
    const m = document.getElementById('mobileMenu'), b = document.querySelector('.nav-hamburger');
    if (m.classList.contains('open') && !m.contains(e.target) && !b.contains(e.target)) m.classList.remove('open');
  });
</script>"""

_CTA_BOX = """      <div class="article-cta-box">
        <p>&#62; Interested in discussing GTM challenges and specific situations? <a href="reach-out.html">Let's talk.</a></p>
        <p>&#62; <a href="partner.html">Explore how to extend your impact.</a> We're expanding the network of practitioners who combine strategic thinking with execution excellence. Even with an established career, there are ways to collaborate on meaningful, high-impact projects that leverage your expertise in rewarding ways.</p>
      </div>"""


@dataclass
class NavLink:
    slug: str
    title: str


def _render_nav_bar(prev_link: NavLink | None, next_link: NavLink | None) -> str:
    if not prev_link and not next_link:
        return ""
    links = []
    if prev_link:
        links.append(f'<a href="{prev_link.slug}.html" class="article-nav-prev">← {prev_link.title}</a>')
    if next_link:
        style = ' style="margin-left:auto;"' if not prev_link else ""
        links.append(f'<a href="{next_link.slug}.html" class="article-nav-next"{style}>{next_link.title} →</a>')
    return f"""<div class="article-nav-bar">
  <div class="wrap">
    <div class="article-nav">
      {''.join(links)}
    </div>
  </div>
</div>

"""


def render_page(
    entry: CalendarEntry,
    markdown_body: str,
    prev_link: NavLink | None,
    next_link: NavLink | None,
) -> str:
    category_slug = category_for_wp(entry.wp)
    category_label = CATEGORY_LABELS[category_slug]
    read_time = compute_read_time(markdown_body)
    body_html = render_body(markdown_body)
    hero_src = quote(entry.hero_image) if entry.hero_image else ""
    hero_img_html = (
        f'<img src="{hero_src}" alt="" class="diagram-img diagram-img--banner" />\n\n        '
        if entry.hero_image else ""
    )
    nav_bar = _render_nav_bar(prev_link, next_link)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{entry.title} | Beyond the Brief</title>
  <meta name="description" content="{entry.teaser}" />
  <link rel="stylesheet" href="css/style.css" />
  <link rel="icon" href="Site%20Assets/Logo/PathwayGTM_NewLogo.png" />
</head>
<body>

<nav class="nav">
  <div class="nav-inner">
    <a href="index.html" class="nav-logo"><img src="Site%20Assets/Logo/PATHWAY-CIRCLE.png" alt="Pathway GTM" /></a>
{_NAV_LINKS}
    <button class="nav-hamburger" onclick="toggleMenu()" aria-label="Menu"><span></span><span></span><span></span></button>
  </div>
</nav>
<div class="mobile-menu" id="mobileMenu">
  <a href="who-we-serve.html" class="nav-link">Who We Serve</a>
  <a href="what-we-do.html" class="nav-link">What We Do</a>
  <a href="n2-framework.html" class="nav-link">The N&sup2; Frame</a>
  <a href="beyond-the-brief.html" class="nav-link">Beyond the Brief</a>
  <a href="pathways-story.html" class="nav-link">Pathway's Story</a>
  <a href="partner.html" class="nav-link">Partner</a>
  <a href="reach-out.html" class="nav-link nav-cta">Reach Out</a>
</div>

<section class="section" style="background:var(--white); padding-top: calc(var(--nav-h) + 60px);">
  <div class="wrap">
    <div class="article-layout">
      <a href="beyond-the-brief.html" class="article-back">&larr; Beyond the Brief</a>
      <div class="article-meta-bar">
        <span class="tag">{category_label}</span>
        <span>&middot;</span>
        <span>{entry.format}</span>
        <span>&middot;</span>
        <span>{read_time}</span>
      </div>
      <h1 style="font-size:2rem; margin-bottom:24px; line-height:1.25;">{entry.title}</h1>

      <div class="article-prose">
        {hero_img_html}{body_html}
      </div>

{_CTA_BOX}

      <hr class="article-divider" />
      <p style="font-size:0.82rem; color:var(--mid-grey); font-style:italic; margin-bottom:12px;"><a href="beyond-the-brief.html" style="color:var(--mid-grey);"><strong>Beyond the Brief</strong></a> is Pathway's blog, where we dive into the nuances of <strong><a href="n2-framework.html">N&sup2; (Nexus x Nerve)</a></strong>, and explore real-world applications, practical execution insights, and strategies for navigating the complexities of modern B2B GTM.</p>
    </div>
  </div>
</section>

{nav_bar}{_FOOTER}
</body>
</html>
"""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_page_template.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/page_template.py backend/tests/test_page_template.py
git commit -m "feat: full-page HTML template assembly"
```

---

### Task 17: Publish preview + ask-for-changes loop

**Files:**
- Create: `backend/api/publish.py`
- Modify: `backend/main.py` (mount router)
- Test: `backend/tests/test_publish_preview.py`
- Create: `frontend/src/components/PreviewFrame.tsx`
- Create: `frontend/src/components/AskForChangesBox.tsx`
- Modify: `frontend/src/pages/PublishPage.tsx`
- Modify: `frontend/src/api.ts`

**Interfaces:**
- Consumes: `render_page`, `NavLink` (Task 16), `complete` (Task 9), `load_calendar`
  (Task 4).
- Produces: `POST /api/publish/{id}/preview` → `{"html": str}` (no commit — pure
  render), `POST /api/publish/{id}/revise` accepting `{"html": str, "instruction": str}`
  → `{"html": str}` (Claude-revised HTML, still uncommitted). Task 21 reuses the preview
  HTML this produces as the exact content it eventually commits.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_publish_preview.py`:
```python
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

from backend.main import app
from backend.calendar_store import CalendarEntry
from backend.github_client import FileContent

ENTRY = CalendarEntry(
    id="2", title="Agility & Coordination", slug="blog-agility-coordination",
    wp="Agility & Coordination", track="B", source="star-hyperion-team-recovery",
    category="gtm-readiness", format="Long-form Insight", publish_target="2026-08-20",
    status="ready-for-review", draft_file="drafts/02-blog-agility-coordination.md",
    hero_image=None, teaser="Two real stories about scaling a team without breaking it.",
)

client = TestClient(app)


@patch("backend.api.publish.GitHubClient.get_file", new_callable=AsyncMock)
@patch("backend.api.publish.load_calendar", new_callable=AsyncMock)
def test_preview_renders_without_committing(mock_load, mock_get_file):
    mock_load.return_value = [ENTRY]
    mock_get_file.return_value = FileContent(path=ENTRY.draft_file, content="Body text.", sha="d1")

    resp = client.post("/api/publish/2/preview")
    assert resp.status_code == 200
    html = resp.json()["html"]
    assert "<title>Agility &amp; Coordination | Beyond the Brief</title>" in html
    assert "Body text." in html


@patch("backend.api.publish.complete", new_callable=AsyncMock)
def test_revise_calls_claude_with_current_html_and_instruction(mock_complete):
    mock_complete.return_value = "<html>revised</html>"
    resp = client.post("/api/publish/2/revise", json={
        "html": "<html>original</html>",
        "instruction": "Make the hero image smaller",
    })
    assert resp.status_code == 200
    assert resp.json()["html"] == "<html>revised</html>"
    user_arg = mock_complete.call_args.kwargs["user"]
    assert "Make the hero image smaller" in user_arg
    assert "<html>original</html>" in user_arg
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_publish_preview.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `backend/api/publish.py`** (preview + revise only — Task 21 appends
  the commit/PR endpoints, Task 22 appends the review endpoints)

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.anthropic_client import complete
from backend.calendar_store import load_calendar
from backend.github_client import GitHubClient
from backend.page_template import render_page
from backend.config import settings

router = APIRouter()


def _client() -> GitHubClient:
    return GitHubClient(settings.GITHUB_TOKEN, settings.GITHUB_OWNER, settings.GITHUB_REPO)


class HtmlResponse(BaseModel):
    html: str


class RevisePayload(BaseModel):
    html: str
    instruction: str


@router.post("/{entry_id}/preview", response_model=HtmlResponse)
async def preview(entry_id: str):
    client = _client()
    entries = await load_calendar(client)
    entry = next((e for e in entries if e.id == entry_id), None)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    body_file = await client.get_file(entry.draft_file)
    body = body_file.content if body_file else ""
    html = render_page(entry, body, prev_link=None, next_link=None)
    return HtmlResponse(html=html)


@router.post("/{entry_id}/revise", response_model=HtmlResponse)
async def revise(entry_id: str, payload: RevisePayload):
    system = (
        "You edit HTML for Pathway GTM's blog articles. You will be given the current "
        "full HTML page and a plain-language instruction describing what to change. "
        "Apply exactly that change and nothing else — preserve every other tag, class, "
        "and piece of copy verbatim. Return ONLY the complete revised HTML document, "
        "no explanation, no markdown fences."
    )
    user = f"Instruction: {payload.instruction}\n\nCurrent HTML:\n{payload.html}"
    revised = await complete(system=system, user=user)
    return HtmlResponse(html=revised)
```

- [ ] **Step 4: Mount the router in `backend/main.py`**

```python
from backend.api.publish import router as publish_router
...
app.include_router(publish_router, prefix="/api/publish", tags=["publish"])
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_publish_preview.py -v`
Expected: PASS

- [ ] **Step 6: Frontend — extend `frontend/src/api.ts`**

```typescript
export async function previewPublish(id: string): Promise<string> {
  const resp = await fetch(`${BASE}/publish/${id}/preview`, { method: 'POST' })
  if (!resp.ok) throw new Error('Failed to render preview')
  return (await resp.json()).html
}

export async function reviseHtml(id: string, html: string, instruction: string): Promise<string> {
  const resp = await fetch(`${BASE}/publish/${id}/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, instruction }),
  })
  if (!resp.ok) throw new Error('Failed to revise HTML')
  return (await resp.json()).html
}
```

- [ ] **Step 7: Write `frontend/src/components/PreviewFrame.tsx`**

```tsx
export default function PreviewFrame({ html }: { html: string }) {
  return (
    <iframe
      title="Article preview"
      srcDoc={html}
      style={{ width: '100%', height: 700, border: '1px solid #ddd' }}
    />
  )
}
```

- [ ] **Step 8: Write `frontend/src/components/AskForChangesBox.tsx`**

```tsx
import { useState } from 'react'

export default function AskForChangesBox({
  onSubmit,
}: {
  onSubmit: (instruction: string) => Promise<void>
}) {
  const [instruction, setInstruction] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!instruction.trim()) return
    setLoading(true)
    await onSubmit(instruction)
    setInstruction('')
    setLoading(false)
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
      <input
        style={{ flex: 1 }}
        placeholder="Describe what to change (e.g. 'move the image up one paragraph')"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <button disabled={loading} onClick={submit}>{loading ? 'Applying…' : 'Ask for change'}</button>
    </div>
  )
}
```

- [ ] **Step 9: Write `frontend/src/pages/PublishPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import PreviewFrame from '../components/PreviewFrame'
import AskForChangesBox from '../components/AskForChangesBox'
import { previewPublish, reviseHtml } from '../api'

export default function PublishPage() {
  const { id } = useParams<{ id: string }>()
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    if (id) previewPublish(id).then(setHtml)
  }, [id])

  if (!html || !id) return <p>Rendering preview…</p>

  const handleChange = async (instruction: string) => {
    const revised = await reviseHtml(id, html, instruction)
    setHtml(revised)
  }

  return (
    <div>
      <h1>Preview</h1>
      <PreviewFrame html={html} />
      <AskForChangesBox onSubmit={handleChange} />
    </div>
  )
}
```

- [ ] **Step 10: Build and verify**

Run: `cd frontend && npm run build && echo BUILD_OK`

- [ ] **Step 11: Commit**

```bash
git add backend/api/publish.py backend/main.py backend/tests/test_publish_preview.py \
        frontend/src/api.ts frontend/src/components/PreviewFrame.tsx \
        frontend/src/components/AskForChangesBox.tsx frontend/src/pages/PublishPage.tsx
git commit -m "feat: publish preview + ask-for-changes revision loop"
```

---

### Task 18: Cross-link resolution logic

**Files:**
- Create: `backend/cross_links.py`
- Test: `backend/tests/test_cross_links.py`

**Interfaces:**
- Consumes: `complete` (Task 9).
- Produces: `@dataclass PendingRow(from_article: str, to_slug_hint: str, raw_row: str)`,
  `def find_pending_rows(cross_links_md: str, new_slug: str) -> list[PendingRow]`,
  `async def propose_resolution(pending: PendingRow, new_entry_title: str, new_entry_slug: str) -> str`
  (returns Claude's suggested sentence/paragraph edit as plain text — Task 21 surfaces
  this in the PR body for Pedro to read, never auto-applies it to the older article's
  HTML).

- [ ] **Step 1: Write the failing test**

`backend/tests/test_cross_links.py`:
```python
from unittest.mock import AsyncMock, patch
import pytest

from backend.cross_links import find_pending_rows, propose_resolution, PendingRow

CROSS_LINKS_MD = """# Cross-Links Tracker

| From article | Pending reference | Target (once known) | Status |
|---|---|---|---|
| blog-gtm-nerve | "the operating layer of Nerve" teaser | blog-agility-coordination | pending |
| blog-designing-growth | generic "more on this later" | (unresolved) | pending |
"""


def test_find_pending_rows_matches_by_target_slug():
    rows = find_pending_rows(CROSS_LINKS_MD, new_slug="blog-agility-coordination")
    assert len(rows) == 1
    assert rows[0].from_article == "blog-gtm-nerve"


def test_find_pending_rows_no_match_returns_empty():
    rows = find_pending_rows(CROSS_LINKS_MD, new_slug="blog-lead-generation")
    assert rows == []


@pytest.mark.asyncio
async def test_propose_resolution_calls_claude():
    with patch("backend.cross_links.complete", new_callable=AsyncMock) as mock_complete:
        mock_complete.return_value = 'Link directly: "...see Agility & Coordination."'
        pending = PendingRow(
            from_article="blog-gtm-nerve",
            to_slug_hint="blog-agility-coordination",
            raw_row='| blog-gtm-nerve | "the operating layer of Nerve" teaser | blog-agility-coordination | pending |',
        )
        result = await propose_resolution(pending, "Agility & Coordination", "blog-agility-coordination")
        assert "Agility & Coordination" in result
        mock_complete.assert_called_once()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_cross_links.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `backend/cross_links.py`**

```python
from dataclasses import dataclass

from backend.anthropic_client import complete


@dataclass
class PendingRow:
    from_article: str
    to_slug_hint: str
    raw_row: str


def find_pending_rows(cross_links_md: str, new_slug: str) -> list[PendingRow]:
    rows = []
    for line in cross_links_md.splitlines():
        line = line.strip()
        if not line.startswith("|") or "---" in line:
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 4 or cells[0] in ("From article",):
            continue
        from_article, _pending_ref, target, status = cells[0], cells[1], cells[2], cells[3]
        if target == new_slug and status.lower() == "pending":
            rows.append(PendingRow(from_article=from_article, to_slug_hint=target, raw_row=line))
    return rows


async def propose_resolution(pending: PendingRow, new_entry_title: str, new_entry_slug: str) -> str:
    system = (
        "You resolve a pending forward-reference in Pathway GTM's blog. An older, "
        "already-published article promised content that has now been written. "
        "Propose the exact sentence to add or change in the older article so it "
        "links directly to the new one, with no stale date and no explanation of "
        "the editorial process to the reader. Return only the proposed sentence(s)."
    )
    user = (
        f"Pending row: {pending.raw_row}\n"
        f"Older article: {pending.from_article}\n"
        f"Newly published article: \"{new_entry_title}\" ({new_entry_slug}.html)"
    )
    return await complete(system=system, user=user)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_cross_links.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/cross_links.py backend/tests/test_cross_links.py
git commit -m "feat: cross-link pending-row detection and resolution proposals"
```

---

### Task 19: Listing-card + nav-link wiring

**Files:**
- Create: `backend/site_wiring.py`
- Test: `backend/tests/test_site_wiring.py`

**Interfaces:**
- Consumes: `CalendarEntry`, `category_for_wp`, `CATEGORY_LABELS` (Tasks 4, 14).
- Produces: `def insert_listing_card(listing_html: str, entry: CalendarEntry) -> str`
  (inserts a new `.blog-card` as the first child of `#from-the-field`),
  `def update_nav_links_in_html(article_html: str, new_link: NavLink, direction: str) -> str`
  (`direction` is `"prev"` or `"next"` — adds or replaces the corresponding
  `article-nav-prev`/`article-nav-next` anchor in an already-published article's HTML, so
  it reciprocally links to the newly published one). Task 21 calls both.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_site_wiring.py`:
```python
from backend.calendar_store import CalendarEntry
from backend.page_template import NavLink
from backend.site_wiring import insert_listing_card, update_nav_links_in_html

ENTRY = CalendarEntry(
    id="2", title="Agility & Coordination", slug="blog-agility-coordination",
    wp="Agility & Coordination", track="B", source="star-hyperion-team-recovery",
    category="gtm-readiness", format="Long-form Insight", publish_target="2026-08-20",
    status="ready-for-review", draft_file="drafts/02-blog-agility-coordination.md",
    hero_image="Site Assets/Blog_Images/agility-banner.jpg",
    teaser="Two real stories about scaling a team without breaking it.",
)

LISTING_HTML = """<div class="blog-grid" id="from-the-field">
      <div class="blog-card" data-category="gtm-readiness">
        <div class="blog-thumb"><img src="x.jpg" alt="Old" /></div>
      </div>
    </div>"""

ARTICLE_HTML = """<div class="article-nav-bar">
  <div class="wrap">
    <div class="article-nav">
      <a href="blog-gtm-misalignment.html" class="article-nav-next" style="margin-left:auto;">One Misalignment That Quietly Kills GTM &rarr;</a>
    </div>
  </div>
</div>"""


def test_insert_listing_card_prepends_new_card():
    result = insert_listing_card(LISTING_HTML, ENTRY)
    assert result.index('data-category="gtm-readiness">\n        <div class="blog-thumb"><img src="Site%20Assets/Blog_Images/agility-banner.jpg"') \
        < result.index('src="x.jpg" alt="Old"')
    assert "Agility &amp; Coordination" in result
    assert "blog-agility-coordination.html" in result


def test_update_nav_links_adds_prev_link_when_missing():
    new_link = NavLink(slug="blog-agility-coordination", title="Agility & Coordination")
    result = update_nav_links_in_html(ARTICLE_HTML, new_link, direction="prev")
    assert '<a href="blog-agility-coordination.html" class="article-nav-prev">← Agility &amp; Coordination</a>' in result
    assert 'style="margin-left:auto;"' not in result  # both links now present, no longer solo
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_site_wiring.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `backend/site_wiring.py`**

```python
import re
from urllib.parse import quote

from backend.calendar_store import CalendarEntry
from backend.page_template import NavLink
from backend.taxonomy import category_for_wp, CATEGORY_LABELS


def insert_listing_card(listing_html: str, entry: CalendarEntry) -> str:
    category_slug = category_for_wp(entry.wp)
    category_label = CATEGORY_LABELS[category_slug]
    hero_src = quote(entry.hero_image) if entry.hero_image else ""
    card = f"""      <div class="blog-card" data-category="{category_slug}">
        <div class="blog-thumb"><img src="{hero_src}" alt="{entry.title}" /></div>
        <div class="blog-body">
          <div class="blog-meta"><span>{category_label}</span></div>
          <h3>{entry.title}</h3>
          <p>{entry.teaser}</p>
          <a href="{entry.slug}.html" class="blog-more">Read More &rarr;</a>
        </div>
      </div>
"""
    marker = '<div class="blog-grid" id="from-the-field">'
    idx = listing_html.index(marker) + len(marker)
    return listing_html[:idx] + "\n" + card + listing_html[idx:]


def update_nav_links_in_html(article_html: str, new_link: NavLink, direction: str) -> str:
    other_present = (
        'article-nav-prev' in article_html if direction == "next" else 'article-nav-next' in article_html
    )
    style = "" if other_present else ' style="margin-left:auto;"'
    css_class = f"article-nav-{direction}"
    arrow = f"← {new_link.title}" if direction == "prev" else f"{new_link.title} →"
    new_anchor = f'<a href="{new_link.slug}.html" class="{css_class}"{style}>{arrow}</a>'

    existing_pattern = re.compile(
        rf'<a href="[^"]+" class="{css_class}"[^>]*>.*?</a>'
    )
    if existing_pattern.search(article_html):
        return existing_pattern.sub(new_anchor, article_html, count=1)

    nav_div_pattern = re.compile(r'(<div class="article-nav">\s*)')
    return nav_div_pattern.sub(rf"\1{new_anchor}\n      ", article_html, count=1)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_site_wiring.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/site_wiring.py backend/tests/test_site_wiring.py
git commit -m "feat: listing-card insertion and nav-link wiring"
```

---

### Task 20: Translation generation (PT/ES)

**Files:**
- Create: `backend/translate.py`
- Test: `backend/tests/test_translate.py`

**Interfaces:**
- Consumes: `complete` (Task 9).
- Produces: `async def translate_body(markdown_body: str, target_lang: str) -> str`
  (`target_lang` is `"pt"` or `"es"`) — returns translated Markdown, still to be run
  through `render_page`/`render_body` same as the English version. Task 21 calls this
  twice per publish.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_translate.py`:
```python
from unittest.mock import AsyncMock, patch
import pytest

from backend.translate import translate_body


@pytest.mark.asyncio
async def test_translate_body_pt():
    with patch("backend.translate.complete", new_callable=AsyncMock) as mock_complete:
        mock_complete.return_value = "Texto traduzido em portugues."
        result = await translate_body("English text here.", "pt")
        assert result == "Texto traduzido em portugues."
        system_arg = mock_complete.call_args.kwargs["system"]
        assert "Portuguese" in system_arg


@pytest.mark.asyncio
async def test_translate_body_es():
    with patch("backend.translate.complete", new_callable=AsyncMock) as mock_complete:
        mock_complete.return_value = "Texto en espanol."
        result = await translate_body("English text here.", "es")
        assert result == "Texto en espanol."
        system_arg = mock_complete.call_args.kwargs["system"]
        assert "Spanish" in system_arg


@pytest.mark.asyncio
async def test_translate_body_rejects_unknown_language():
    with pytest.raises(ValueError):
        await translate_body("English text here.", "fr")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_translate.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `backend/translate.py`**

```python
from backend.anthropic_client import complete

_LANGUAGE_NAMES = {"pt": "Portuguese", "es": "Spanish"}


async def translate_body(markdown_body: str, target_lang: str) -> str:
    if target_lang not in _LANGUAGE_NAMES:
        raise ValueError(f"Unsupported target language: {target_lang}")

    language = _LANGUAGE_NAMES[target_lang]
    system = (
        f"You translate Pathway GTM blog articles into {language} for their public "
        "site. Preserve all Markdown formatting (bold, links, headings, tables, image "
        "syntax) exactly — translate only the prose content, never the Markdown "
        "syntax, URLs, or image paths. Keep the same tone: measured, direct, no "
        "hype. Return only the translated Markdown, nothing else."
    )
    return await complete(system=system, user=markdown_body)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_translate.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/translate.py backend/tests/test_translate.py
git commit -m "feat: PT/ES translation generation"
```

---

### Task 21: Publish commit (full pipeline orchestration)

**Files:**
- Modify: `backend/api/publish.py` (append commit endpoint)
- Modify: `backend/tests/test_publish_preview.py` → rename usage stays, add new test file
- Test: `backend/tests/test_publish_commit.py`

**Interfaces:**
- Consumes: everything from Tasks 4, 9, 14-20.
- Produces: `POST /api/publish/{id}/commit` → `{"prNumber": int, "crossLinkNotes": list[str]}`.
  Orchestrates: render EN page (Task 16), translate + render PT/ES (Tasks 16+20),
  compute category/nav (Task 14/16), find+propose cross-link resolutions (Task 18, notes
  only — not applied to files), insert listing card + nav links into
  `beyond-the-brief.html` and the immediately-adjacent published article (Task 19),
  create branch, commit every changed file, update the calendar entry's status to
  `published`, open PR. Task 22 reads the PR this creates.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_publish_commit.py`:
```python
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

from backend.main import app
from backend.calendar_store import CalendarEntry
from backend.github_client import FileContent

PUBLISHED_ENTRY = CalendarEntry(
    id="1", title="Pathway's 10-Point GTM Health Check", slug="blog-gtm-health-check",
    wp="Governance & Steering", track="A", source="", category="gtm-readiness",
    format="Resource / Playbook", publish_target="2026-07-23", status="published",
    draft_file="drafts/01-blog-gtm-health-check.md", hero_image=None, teaser="",
)
NEW_ENTRY = CalendarEntry(
    id="2", title="Agility & Coordination", slug="blog-agility-coordination",
    wp="Agility & Coordination", track="B", source="star-hyperion-team-recovery",
    category="gtm-readiness", format="Long-form Insight", publish_target="2026-08-20",
    status="ready-for-review", draft_file="drafts/02-blog-agility-coordination.md",
    hero_image=None, teaser="Two real stories about scaling a team without breaking it.",
)

client = TestClient(app)


@patch("backend.api.publish.translate_body", new_callable=AsyncMock)
@patch("backend.api.publish.find_pending_rows")
@patch("backend.api.publish.GitHubClient.create_branch", new_callable=AsyncMock)
@patch("backend.api.publish.GitHubClient.open_pr", new_callable=AsyncMock)
@patch("backend.api.publish.GitHubClient.put_file", new_callable=AsyncMock)
@patch("backend.api.publish.GitHubClient.get_file", new_callable=AsyncMock)
@patch("backend.api.publish.load_calendar", new_callable=AsyncMock)
def test_commit_publishes_en_pt_es_and_opens_pr(
    mock_load, mock_get_file, mock_put_file, mock_open_pr, mock_create_branch,
    mock_find_pending, mock_translate,
):
    mock_load.return_value = [PUBLISHED_ENTRY, NEW_ENTRY]
    mock_get_file.side_effect = lambda path, ref="main": FileContent(path=path, content="stub", sha="s") \
        if "beyond-the-brief" in path or path == NEW_ENTRY.draft_file else None
    mock_open_pr.return_value = 7
    mock_find_pending.return_value = []
    mock_translate.return_value = "translated body"

    resp = client.post("/api/publish/2/commit")
    assert resp.status_code == 200
    assert resp.json()["prNumber"] == 7

    mock_create_branch.assert_called_once()
    written_paths = [c.args[0] for c in mock_put_file.call_args_list]
    assert "blog-agility-coordination.html" in written_paths
    assert "pt/blog-agility-coordination.html" in written_paths
    assert "es/blog-agility-coordination.html" in written_paths
    assert "beyond-the-brief.html" in written_paths
    assert "drafts/calendar.json" in written_paths
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_publish_commit.py -v`
Expected: FAIL — 404, route doesn't exist yet.

- [ ] **Step 3: Append to `backend/api/publish.py`**

Add these imports at the top of the file:
```python
import json

from backend.calendar_store import CalendarEntry, save_calendar
from backend.cross_links import find_pending_rows, propose_resolution
from backend.page_template import render_page, NavLink
from backend.site_wiring import insert_listing_card, update_nav_links_in_html
from backend.translate import translate_body
```

Append the endpoint:
```python
class CommitResponse(BaseModel):
    prNumber: int
    crossLinkNotes: list[str]


@router.post("/{entry_id}/commit", response_model=CommitResponse)
async def commit(entry_id: str):
    client = _client()
    entries = await load_calendar(client)
    entry = next((e for e in entries if e.id == entry_id), None)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")

    body_file = await client.get_file(entry.draft_file)
    body = body_file.content if body_file else ""

    published = sorted(
        [e for e in entries if e.status == "published" and e.id != entry.id],
        key=lambda e: e.publish_target,
    )
    prev_entry = next((e for e in reversed(published) if e.publish_target < entry.publish_target), None)
    next_entry = next((e for e in published if e.publish_target > entry.publish_target), None)
    prev_link = NavLink(slug=prev_entry.slug, title=prev_entry.title) if prev_entry else None
    next_link = NavLink(slug=next_entry.slug, title=next_entry.title) if next_entry else None

    branch = f"blog/publish-{entry.slug}"
    await client.create_branch(branch)

    files_to_write: dict[str, str] = {
        f"{entry.slug}.html": render_page(entry, body, prev_link, next_link),
    }
    for lang in ("pt", "es"):
        translated_body = await translate_body(body, lang)
        files_to_write[f"{lang}/{entry.slug}.html"] = render_page(
            entry, translated_body, prev_link, next_link
        )

    listing_file = await client.get_file("beyond-the-brief.html")
    if listing_file:
        files_to_write["beyond-the-brief.html"] = insert_listing_card(listing_file.content, entry)

    if prev_entry:
        adjacent_file = await client.get_file(f"{prev_entry.slug}.html")
        if adjacent_file:
            new_link = NavLink(slug=entry.slug, title=entry.title)
            files_to_write[f"{prev_entry.slug}.html"] = update_nav_links_in_html(
                adjacent_file.content, new_link, direction="next"
            )

    cross_link_notes: list[str] = []
    links_file = await client.get_file("drafts/CROSS-LINKS.md")
    if links_file:
        for pending in find_pending_rows(links_file.content, new_slug=entry.slug):
            suggestion = await propose_resolution(pending, entry.title, entry.slug)
            cross_link_notes.append(f"{pending.from_article}: {suggestion}")

    for path, content in files_to_write.items():
        existing = await client.get_file(path, ref=branch) or await client.get_file(path)
        await client.put_file(
            path, content, message=f"content: publish {entry.title}", branch=branch,
            sha=existing.sha if existing else None,
        )

    updated_entries = [
        (entry.model_copy(update={"status": "published"}) if e.id == entry.id else e)
        for e in entries
    ]
    cal_file = await client.get_file("drafts/calendar.json")
    await client.put_file(
        "drafts/calendar.json",
        json.dumps([e.model_dump(by_alias=True) for e in updated_entries], indent=2, ensure_ascii=False),
        message=f"chore: mark {entry.title} published", branch=branch,
        sha=cal_file.sha if cal_file else None,
    )

    pr_body = f"Publishes \"{entry.title}\".\n\n" + (
        "Cross-link follow-ups to consider:\n" + "\n".join(f"- {n}" for n in cross_link_notes)
        if cross_link_notes else "No pending cross-links to resolve."
    )
    pr_number = await client.open_pr(head=branch, title=f"Publish: {entry.title}", body=pr_body)
    return CommitResponse(prNumber=pr_number, crossLinkNotes=cross_link_notes)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_publish_commit.py -v`
Expected: PASS

- [ ] **Step 5: Run the full backend test suite to confirm no regressions**

Run: `.venv/bin/pytest backend/tests/ -v`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/api/publish.py backend/tests/test_publish_commit.py
git commit -m "feat: publish commit — full pipeline orchestration + PR"
```

---

### Task 22: PR review (in-app diff, merge, discard)

**Files:**
- Modify: `backend/api/publish.py` (append endpoints)
- Test: `backend/tests/test_pr_review.py`
- Create: `frontend/src/components/PRDiffView.tsx`
- Modify: `frontend/src/pages/PublishPage.tsx`
- Modify: `frontend/src/api.ts`

**Interfaces:**
- Consumes: `GitHubClient.get_pr_files/merge_pr/discard_pr` (Task 3).
- Produces: `GET /api/publish/{id}/pr/{pr_number}` → `list[PRFile]`,
  `POST /api/publish/{id}/pr/{pr_number}/merge`,
  `POST /api/publish/{id}/pr/{pr_number}/discard`.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_pr_review.py`:
```python
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


@patch("backend.api.publish.GitHubClient.get_pr_files", new_callable=AsyncMock)
def test_get_pr_diff(mock_get_pr_files):
    from backend.github_client import PRFile
    mock_get_pr_files.return_value = [
        PRFile(filename="blog-agility-coordination.html", status="added", additions=120, deletions=0, patch="+...")
    ]
    resp = client.get("/api/publish/2/pr/7")
    assert resp.status_code == 200
    assert resp.json()[0]["filename"] == "blog-agility-coordination.html"


@patch("backend.api.publish.GitHubClient.merge_pr", new_callable=AsyncMock)
def test_merge_pr(mock_merge):
    resp = client.post("/api/publish/2/pr/7/merge")
    assert resp.status_code == 200
    mock_merge.assert_called_once_with(7)


@patch("backend.api.publish.GitHubClient.discard_pr", new_callable=AsyncMock)
def test_discard_pr(mock_discard):
    resp = client.post("/api/publish/2/pr/7/discard", json={"branch": "blog/publish-blog-agility-coordination"})
    assert resp.status_code == 200
    mock_discard.assert_called_once_with(7, branch="blog/publish-blog-agility-coordination")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_pr_review.py -v`
Expected: FAIL — 404s.

- [ ] **Step 3: Append to `backend/api/publish.py`**

```python
class PRFileOut(BaseModel):
    filename: str
    status: str
    additions: int
    deletions: int
    patch: str | None


class DiscardPayload(BaseModel):
    branch: str


@router.get("/{entry_id}/pr/{pr_number}", response_model=list[PRFileOut])
async def pr_diff(entry_id: str, pr_number: int):
    client = _client()
    files = await client.get_pr_files(pr_number)
    return [PRFileOut(**f.__dict__) for f in files]


@router.post("/{entry_id}/pr/{pr_number}/merge")
async def pr_merge(entry_id: str, pr_number: int):
    client = _client()
    await client.merge_pr(pr_number)
    return {"merged": True}


@router.post("/{entry_id}/pr/{pr_number}/discard")
async def pr_discard(entry_id: str, pr_number: int, payload: DiscardPayload):
    client = _client()
    await client.discard_pr(pr_number, branch=payload.branch)
    return {"discarded": True}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_pr_review.py -v`
Expected: PASS

- [ ] **Step 5: Frontend — extend `frontend/src/api.ts`**

```typescript
export interface PRFile {
  filename: string
  status: string
  additions: number
  deletions: number
  patch: string | null
}

export async function commitPublish(id: string): Promise<{ prNumber: number; crossLinkNotes: string[] }> {
  const resp = await fetch(`${BASE}/publish/${id}/commit`, { method: 'POST' })
  if (!resp.ok) throw new Error('Failed to commit publish')
  return resp.json()
}

export async function fetchPrDiff(id: string, prNumber: number): Promise<PRFile[]> {
  const resp = await fetch(`${BASE}/publish/${id}/pr/${prNumber}`)
  if (!resp.ok) throw new Error('Failed to load PR diff')
  return resp.json()
}

export async function mergePr(id: string, prNumber: number): Promise<void> {
  const resp = await fetch(`${BASE}/publish/${id}/pr/${prNumber}/merge`, { method: 'POST' })
  if (!resp.ok) throw new Error('Failed to merge PR')
}

export async function discardPr(id: string, prNumber: number, branch: string): Promise<void> {
  const resp = await fetch(`${BASE}/publish/${id}/pr/${prNumber}/discard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch }),
  })
  if (!resp.ok) throw new Error('Failed to discard PR')
}
```

- [ ] **Step 6: Write `frontend/src/components/PRDiffView.tsx`**

```tsx
import type { PRFile } from '../api'

export default function PRDiffView({ files }: { files: PRFile[] }) {
  return (
    <div>
      {files.map((f) => (
        <div key={f.filename} style={{ border: '1px solid #ddd', marginBottom: 8, padding: 8 }}>
          <strong>{f.filename}</strong> ({f.status}, +{f.additions}/-{f.deletions})
          {f.patch && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{f.patch}</pre>}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: Extend `frontend/src/pages/PublishPage.tsx`**

Replace the file with the full publish → review → merge flow:
```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import PreviewFrame from '../components/PreviewFrame'
import AskForChangesBox from '../components/AskForChangesBox'
import PRDiffView from '../components/PRDiffView'
import {
  previewPublish, reviseHtml, commitPublish, fetchPrDiff, mergePr, discardPr,
  type PRFile,
} from '../api'

export default function PublishPage() {
  const { id } = useParams<{ id: string }>()
  const [html, setHtml] = useState<string | null>(null)
  const [prNumber, setPrNumber] = useState<number | null>(null)
  const [crossLinkNotes, setCrossLinkNotes] = useState<string[]>([])
  const [prFiles, setPrFiles] = useState<PRFile[]>([])
  const [branch, setBranch] = useState('')

  useEffect(() => {
    if (id) previewPublish(id).then(setHtml)
  }, [id])

  if (!id) return null;
  if (!html) return <p>Rendering preview…</p>

  const handleChange = async (instruction: string) => {
    const revised = await reviseHtml(id, html, instruction)
    setHtml(revised)
  }

  const handlePublish = async () => {
    const result = await commitPublish(id)
    setPrNumber(result.prNumber)
    setCrossLinkNotes(result.crossLinkNotes)
    setBranch(`blog/publish-${id}`)
    setPrFiles(await fetchPrDiff(id, result.prNumber))
  }

  const handleMerge = async () => {
    if (prNumber == null) return
    await mergePr(id, prNumber)
    alert('Merged — live on pathwaygtm.com shortly.')
  }

  const handleDiscard = async () => {
    if (prNumber == null) return
    await discardPr(id, prNumber, branch)
    setPrNumber(null)
    setPrFiles([])
  }

  return (
    <div>
      <h1>Preview</h1>
      <PreviewFrame html={html} />
      <AskForChangesBox onSubmit={handleChange} />

      {prNumber == null ? (
        <button style={{ marginTop: 16 }} onClick={handlePublish}>Publish (opens PR)</button>
      ) : (
        <div style={{ marginTop: 16 }}>
          <h2>Review PR #{prNumber}</h2>
          {crossLinkNotes.length > 0 && (
            <div>
              <strong>Cross-link follow-ups:</strong>
              <ul>{crossLinkNotes.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          )}
          <PRDiffView files={prFiles} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleMerge}>Merge &amp; Go Live</button>
            <button onClick={handleDiscard}>Discard</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 8: Build and verify**

Run: `cd frontend && npm run build && echo BUILD_OK`

- [ ] **Step 9: Commit**

```bash
git add backend/api/publish.py backend/tests/test_pr_review.py frontend/src/api.ts \
        frontend/src/components/PRDiffView.tsx frontend/src/pages/PublishPage.tsx
git commit -m "feat: in-app PR review, merge, and discard"
```

---

### Task 23: calendar.json backfill script

**Files:**
- Create: `scripts/backfill_calendar.py`
- Test: `backend/tests/test_backfill_calendar.py`

**Interfaces:**
- Produces: `def parse_readme_table(readme_md: str) -> list[dict]` (pure function,
  testable without touching GitHub) and a `main()` that loads the real
  `drafts/README.md` from `PathwayGTM_website` via `GitHubClient`, combines it with the
  locked calendar in
  `~/Desktop/Claude_Corner/brainstorms/2026-07-02-editorial-calendar-design.md`'s
  11-row table (WP/track/source/category/format columns the README table itself doesn't
  carry), and writes the resulting `drafts/calendar.json` once.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_backfill_calendar.py`:
```python
from scripts.backfill_calendar import parse_readme_table

SAMPLE_README = """# Beyond the Brief — Draft Queue

| # | File | WP | Publish target | Status |
|---|---|---|---|---|
| 1 | [01-blog-gtm-health-check.md](01-blog-gtm-health-check.md) | Cross-WP diagnostic (Module 1) | **PUBLISHED 2026-07-23** | Live |
| 2 | [02-blog-agility-coordination.md](02-blog-agility-coordination.md) | Agility & Coordination | 2026-08-20 | Outline ready |
"""


def test_parse_readme_table_extracts_rows():
    rows = parse_readme_table(SAMPLE_README)
    assert len(rows) == 2
    assert rows[0]["draft_file"] == "drafts/01-blog-gtm-health-check.md"
    assert rows[0]["wp"] == "Cross-WP diagnostic (Module 1)"
    assert rows[0]["publish_target"] == "2026-07-23"
    assert rows[1]["publish_target"] == "2026-08-20"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_backfill_calendar.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `scripts/backfill_calendar.py`**

```python
import asyncio
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.calendar_store import CalendarEntry, CALENDAR_PATH
from backend.github_client import GitHubClient
from backend.config import settings

_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")

# Track/source/category/format for each entry — sourced from the locked calendar table
# in ~/Desktop/Claude_Corner/brainstorms/2026-07-02-editorial-calendar-design.md.
# Not present in drafts/README.md's table, so filled in here by hand, once.
_METADATA = {
    "01-blog-gtm-health-check.md": {"track": "A", "source": "", "category": "gtm-readiness", "format": "Resource / Playbook"},
    "02-blog-agility-coordination.md": {"track": "B", "source": "star-hyperion-team-recovery + star-ericsson-cloud-structure-to-scale", "category": "gtm-readiness", "format": "Long-form Insight"},
    "03-blog-gtm-target-strategy.md": {"track": "B", "source": "star-ericsson-cloud-growth-plan", "category": "gtm-readiness", "format": "Long-form Insight"},
    "04-blog-icp-customer-experience.md": {"track": "C", "source": "JTBD (Ulwick) + Gartner journey-mapping", "category": "gtm-readiness", "format": "Long-form Insight"},
    "05-blog-customer-messaging.md": {"track": "C", "source": "Cognism/HubSpot/House of Revenue/ZoomInfo failure cluster", "category": "gtm-readiness", "format": "Long-form Insight"},
    "06-blog-lead-generation.md": {"track": "B", "source": "star-schreder-lead-qualification", "category": "deal-generation", "format": "Long-form Insight"},
}


def parse_readme_table(readme_md: str) -> list[dict]:
    rows = []
    for line in readme_md.splitlines():
        line = line.strip()
        if not line.startswith("|") or "---" in line or line.startswith("| #"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 5:
            continue
        file_match = re.search(r"\[([^\]]+)\]\(([^)]+)\)", cells[1])
        if not file_match:
            continue
        filename = file_match.group(1)
        date_match = _DATE_RE.search(cells[3])
        rows.append({
            "draft_file": f"drafts/{filename}",
            "wp": cells[2],
            "publish_target": date_match.group(0) if date_match else cells[3],
            "status_text": cells[4],
        })
    return rows


def _status_from_text(status_text: str) -> str:
    if "published" in status_text.lower() or "live" in status_text.lower():
        return "published"
    if "outline" in status_text.lower():
        return "outline"
    return "idea"


async def main():
    client = GitHubClient(settings.GITHUB_TOKEN, settings.GITHUB_OWNER, settings.GITHUB_REPO)
    readme_file = await client.get_file("drafts/README.md")
    rows = parse_readme_table(readme_file.content)

    entries = []
    for i, row in enumerate(rows, start=1):
        filename = row["draft_file"].split("/")[-1]
        meta = _METADATA.get(filename, {"track": "C", "source": "", "category": "gtm-readiness", "format": "Long-form Insight"})
        slug = filename.rsplit(".", 1)[0].split("-", 1)[1]
        entries.append(CalendarEntry(
            id=str(i),
            title=row["wp"],
            slug=slug,
            wp=row["wp"],
            track=meta["track"],
            source=meta["source"],
            category=meta["category"],
            format=meta["format"],
            publish_target=row["publish_target"],
            status=_status_from_text(row["status_text"]),
            draft_file=row["draft_file"],
            hero_image=None,
            teaser="",
        ))

    existing = await client.get_file(CALENDAR_PATH)
    payload = json.dumps([e.model_dump(by_alias=True) for e in entries], indent=2, ensure_ascii=False)
    await client.put_file(
        CALENDAR_PATH, payload, message="chore: backfill calendar.json from README.md",
        branch="main", sha=existing.sha if existing else None,
    )
    print(f"Wrote {len(entries)} entries to {CALENDAR_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest backend/tests/test_backfill_calendar.py -v`
Expected: PASS

- [ ] **Step 5: Run the script once against the real repo**

Run: `.venv/bin/python scripts/backfill_calendar.py`
Expected: `Wrote 6 entries to drafts/calendar.json` (Pedro's `drafts/README.md` currently
lists 6 outlined entries — entries 7-11 from the locked calendar aren't outlined yet, so
they're intentionally not backfilled; add them through the Planner UI once outlined).
Confirm on GitHub that `drafts/calendar.json` and the correct titles/dates now exist on
`main` in `PathwayGTM_website`.

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill_calendar.py backend/tests/test_backfill_calendar.py
git commit -m "feat: one-time calendar.json backfill script"
```

---

### Task 24: Deployment (nginx, systemd, GitHub Actions)

**Files:**
- Create: `infra/nginx.conf`
- Create: `infra/blog-entry.service`
- Create: `scripts/vps-setup.sh`
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- No code interfaces — this task wires the already-tested app onto the VPS, mirroring
  `CareerOutreachCRM`'s deploy shape exactly (see
  `~/Desktop/Claude_Corner/CareerOutreachCRM/docs/SYSADMIN.md`).

- [ ] **Step 1: Write `infra/nginx.conf`**

```nginx
limit_req_zone $binary_remote_addr zone=blog_entry_api:10m rate=30r/s;

server {
    listen 80;
    server_name blog-entry.pathwaygtm.com;
    client_max_body_size 10M;

    add_header X-Frame-Options        SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy        strict-origin-when-cross-origin;

    gzip on;
    gzip_types application/json text/html application/javascript text/css;

    location / {
        proxy_pass         http://127.0.0.1:8006;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    location /api/ {
        limit_req  zone=blog_entry_api burst=30 nodelay;
        proxy_pass http://127.0.0.1:8006;
        proxy_set_header Host            $host;
        proxy_set_header X-Real-IP       $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

- [ ] **Step 2: Write `infra/blog-entry.service`**

```ini
[Unit]
Description=PathwayGTM Blog Entry (editorial planner + writer)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/blog-entry
EnvironmentFile=/opt/blog-entry/backend/.env
ExecStart=/opt/blog-entry/.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8006
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Write `scripts/vps-setup.sh`**

```bash
#!/usr/bin/env bash
# Run once on VPS as root to set up the blog editorial app.
# Assumes repo already cloned to /opt/blog-entry.
set -euo pipefail

APP=/opt/blog-entry

python3 -m venv "$APP/.venv"
"$APP/.venv/bin/pip" install -q --upgrade pip
"$APP/.venv/bin/pip" install -q -r "$APP/requirements.txt"

if [ ! -f "$APP/backend/.env" ]; then
    cp "$APP/.env.example" "$APP/backend/.env"
    echo "-> Fill in $APP/backend/.env before starting the service (GITHUB_TOKEN, ANTHROPIC_API_KEY)"
fi

cp "$APP/infra/blog-entry.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable blog-entry

cp "$APP/infra/nginx.conf" /etc/nginx/sites-available/blog-entry
ln -sf /etc/nginx/sites-available/blog-entry /etc/nginx/sites-enabled/blog-entry
nginx -t && systemctl reload nginx

echo "Done. Run: systemctl start blog-entry"
```

- [ ] **Step 4: Write `.github/workflows/deploy.yml`**

```yaml
name: Deploy to VPS

on:
  push:
    branches: [main]

concurrency:
  group: deploy-blog-entry
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Build frontend
        run: |
          cd frontend
          npm ci
          npm run build
          test -f dist/index.html

      - uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.VPS_SSH_PRIVATE_KEY }}

      - name: Add VPS to known hosts
        run: ssh-keyscan -H 167.233.51.113 >> ~/.ssh/known_hosts

      - name: Rsync backend
        run: |
          rsync -rlgoDz --delete \
            --exclude='.git' \
            --exclude='.env' \
            --exclude='.venv' \
            --exclude='__pycache__' \
            --exclude='frontend/' \
            ./ root@167.233.51.113:/opt/blog-entry/

      - name: Rsync frontend dist
        run: |
          rsync -rlgoDz --delete \
            frontend/dist/ root@167.233.51.113:/opt/blog-entry/frontend/dist/

      - name: Reload nginx
        run: |
          ssh root@167.233.51.113 "
            cp /opt/blog-entry/infra/nginx.conf /etc/nginx/sites-available/blog-entry
            ln -sf /etc/nginx/sites-available/blog-entry /etc/nginx/sites-enabled/blog-entry
            nginx -t && systemctl reload nginx
          "

      - name: Install deps and restart
        run: |
          ssh root@167.233.51.113 "
            cd /opt/blog-entry
            .venv/bin/pip install -q -r requirements.txt
            systemctl restart blog-entry
          "

      - name: Health check
        run: |
          sleep 8
          ssh root@167.233.51.113 \
            "curl -fsS http://localhost:8006/healthz | grep '\"ok\":true'"
```

- [ ] **Step 5: One-time manual VPS + Cloudflare setup**

These steps are outside version control — run them once, by hand:

```bash
# On the VPS
ssh root@167.233.51.113
git clone git@github.com:pilomeida/pathwaygtm-blog-entry.git /opt/blog-entry
bash /opt/blog-entry/scripts/vps-setup.sh
nano /opt/blog-entry/backend/.env   # fill in GITHUB_TOKEN, ANTHROPIC_API_KEY
systemctl start blog-entry
systemctl status blog-entry
```

In Cloudflare (pathwaygtm.com zone):
1. DNS → add an A record: `blog-entry` → `167.233.51.113`, **Proxied** (orange cloud).
2. Zero Trust → Access → Applications → Add an application (Self-hosted) for
   `blog-entry.pathwaygtm.com`, policy: allow only Pedro's email.

In GitHub (`pathwaygtm-blog-entry` repo settings):
3. Add repo secret `VPS_SSH_PRIVATE_KEY` (reuse the existing VPS deploy key already used
   by `CareerOutreachCRM`/`ErgonDealEngine`, if the same key is already trusted on this
   box — check `/root/.ssh/authorized_keys` on the VPS first).

- [ ] **Step 6: Verify end-to-end**

Run: `curl -fsS https://blog-entry.pathwaygtm.com/healthz` (after logging into Cloudflare
Access in a browser first, since curl won't have a session — verify via browser instead
if the curl gets an Access login redirect).
Expected: `{"ok":true}` (or, via browser, the Planner page loads after Access login).

- [ ] **Step 7: Commit**

```bash
git add infra/ scripts/vps-setup.sh .github/workflows/deploy.yml
git commit -m "feat: VPS deployment (nginx, systemd, GitHub Actions)"
git push origin main
```

---

### Task 25: Documentation

**Files:**
- Create: `docs/pathwaygtm-blog-sysadmin.md`
- Create: `docs/pathwaygtm-blog-architecture.md`

**Interfaces:** None — these are reference docs for future sessions, mirroring
`CareerOutreachCRM/docs/SYSADMIN.md`'s structure.

- [ ] **Step 1: Write `docs/pathwaygtm-blog-sysadmin.md`**

Cover, in the same structure as `CareerOutreachCRM/docs/SYSADMIN.md`: VPS host/SSH,
service name/port (`blog-entry`, `8006`), public URL, Cloudflare Access setup (DNS +
Zero Trust application, done manually per Task 24 Step 5 — document it as a checklist so
it's reproducible if ever rebuilt), first-time VPS setup commands, deploy process (push
to `main` → GitHub Actions), service management commands (`systemctl status/restart
blog-entry`, `journalctl -u blog-entry -f`), environment variables
(`GITHUB_TOKEN`/`GITHUB_OWNER`/`GITHUB_REPO`/`ANTHROPIC_API_KEY`/`CLAUDE_MODEL`), and
health check (`curl -fsS http://localhost:8006/healthz`).

- [ ] **Step 2: Write `docs/pathwaygtm-blog-architecture.md`**

Cover: why this app exists and what it replaces (link to
`docs/superpowers/specs/2026-07-03-blog-entry-app-design.md` in `PathwayGTM_website`),
the no-database/GitHub-as-source-of-truth model, the `calendar.json` schema (field list
+ status lifecycle: idea → outline → drafting → ready-for-review → published), how the
publish pipeline works end-to-end (preview → ask-for-changes loop → commit → PR →
in-app merge/discard), the markdown convention from Task 15 (image alt-text variants,
`[[checklist]]` marker, plain tables → `info-table`), and the taxonomy mapping from Task
14. Note explicitly that draft-metadata saves commit straight to `main` while publish
commits always go through a PR — so a future reader understands why those two code paths
differ.

- [ ] **Step 3: Commit**

```bash
git add docs/pathwaygtm-blog-sysadmin.md docs/pathwaygtm-blog-architecture.md
git commit -m "docs: sysadmin and architecture reference"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- Architecture (repo, hosting, Access, GitHub-as-source-of-truth, Anthropic calls) →
  Tasks 1-3, 24.
- Data model (`calendar.json`, README regeneration) → Task 4.
- Planner → Tasks 5-6.
- Writer + assist panel (principles check, cross-links, ask-AI) → Tasks 7-13.
- Publish pipeline (template, taxonomy, translation, cross-link resolution, listing/nav
  wiring, preview/adjust loop, commit+PR, in-app merge/discard) → Tasks 14-22.
- One-time setup + docs → Tasks 23-25.
All spec sections have a task. No gaps found.

**Placeholder scan:** No "TBD"/"TODO"/"similar to Task N" patterns in any step. The one
caveat left in Task 15 Step 4 (mistune table-callback signature check) is an explicit
verification instruction with a concrete fallback action, not an unresolved placeholder.

**Type consistency:** `CalendarEntry` fields are identical across
`backend/calendar_store.py` (Task 4), `frontend/src/types.ts` (Task 2), and every task
that constructs one in tests (Tasks 5, 7, 10-12, 17, 19, 21). `NavLink(slug, title)` is
defined once in `backend/page_template.py` (Task 16) and imported everywhere else that
uses it (Tasks 19, 21) — no redefinition. `complete(system, user, model=None) -> str`
(Task 9) is the only Anthropic entry point; Tasks 10, 11, 12, 17, 18, 20 all import it
rather than re-wrapping the SDK.

---

Plan complete and saved to `docs/superpowers/plans/2026-07-03-blog-entry-app.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
