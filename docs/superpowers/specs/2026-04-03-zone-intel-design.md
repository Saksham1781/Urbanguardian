# Zone Intel Feature — Design Spec
**Date:** 2026-04-03  
**Project:** Urban Guardians  
**Status:** Approved

---

## Overview

Add a **Zone Intel** panel to the map interface that classifies cities and neighborhoods into Red / Yellow / Green crime zones based on real-time news data. Zones are auto-filled when a route is analyzed and can also be searched manually.

---

## Zone Thresholds

| Zone | Score Range | Meaning |
|------|-------------|---------|
| 🟢 Green | 70–90 | Low crime activity |
| 🟡 Yellow | 55–69 | Moderate crime activity |
| 🔴 Red | 40–54 | High crime activity |

Score range is always 40–90 (matching the existing safety scorer clamp).

---

## Architecture & Data Flow

```
User (ZonePanel)
    │
    ├─ [Auto] Route analyzed → routeAreas extracted → POST /api/zones
    └─ [Manual] User types city/area → POST /api/zones
          │
          ▼
    Node Backend: POST /api/zones
    ├─ Accepts: { locations: ["Delhi", "Connaught Place, Delhi", ...] }
    ├─ Deduplicates locations (lowercase trim)
    ├─ Checks MongoDB ZoneCache (1h TTL) per location
    ├─ Uncached locations → POST http://localhost:8001/zones
    │       │
    │       ▼
    │   FastAPI AI Service: POST /zones
    │   ├─ fetch_crime_news(locations)  ← reuses existing fetcher
    │   ├─ score_location_safety() ← adapts existing scorer
    │   ├─ classify zone from score
    │   └─ return ZoneResponse[]
    │
    ├─ Saves results to MongoDB ZoneCache
    └─ Returns to frontend: ZoneResult[]

Frontend ZonePanel:
    ├─ City-level cards (badge + score + top incident)
    └─ Expandable neighborhoods under each city card
```

---

## New Files

| Layer | File | Purpose |
|-------|------|---------|
| AI | `services/ai-service/app/routers/zones.py` | `POST /zones` endpoint |
| AI | `services/ai-service/app/models/schemas.py` | Add ZoneRequest, ZoneResult, ZoneResponse |
| Backend | `services/backend/src/routes/zones.js` | Express router for `/api/zones` |
| Backend | `services/backend/src/controllers/zoneController.js` | Cache check + AI proxy |
| Backend | `services/backend/src/models/ZoneCache.js` | MongoDB ZoneCache schema |
| Frontend | `apps/web/src/components/map/ZonePanel.tsx` | Zone Intel panel component |

**Modified files:**
- `services/backend/src/server.js` — mount `/api/zones` router
- `services/ai-service/app/main.py` — include zones router
- `services/ai-service/app/utils/safety_scorer.py` — add `score_location_safety(location, articles)` function
- `apps/web/src/components/map/Sidebar.tsx` — add zone icon (6th button)
- `apps/web/src/app/map/page.tsx` — wire ZonePanel, handle auto-fill on route analysis
- `apps/web/src/components/map/SafeRouteChatPanel.tsx` — add `routeAreas: string[]` to `AnalysisPayload`, emit all routeAreas via `onRoutesAnalyzed`
- `tests/site.spec.js` — add 2 zone tests

---

## Data Schemas

### AI Service (Pydantic) — additions to `schemas.py`

```python
class ZoneRequest(BaseModel):
    locations: list[str]

class ZoneResult(BaseModel):
    location: str
    zone: str                      # "red" | "yellow" | "green"
    score: float                   # 40–90
    riskLevel: str                 # "low" | "moderate" | "high" | "critical"
    topIncidents: list[CrimeIncident]   # top 3, reuses existing type
    summary: str                   # 1-line reasoning
    articlesAnalyzed: int

class ZoneResponse(BaseModel):
    zones: list[ZoneResult]
    totalLocations: int
```

### MongoDB — ZoneCache model

```js
{
  location:         String,   // lowercase, indexed unique
  zone:             String,   // "red" | "yellow" | "green"
  score:            Number,
  riskLevel:        String,
  topIncidents:     Array,
  summary:          String,
  articlesAnalyzed: Number,
  cachedAt:         Date,
  expiresAt:        Date      // 1-hour TTL index
}
```

### Frontend TypeScript

```ts
interface ZoneResult {
  location: string
  zone: "red" | "yellow" | "green"
  score: number
  riskLevel: string
  topIncidents: { title: string; severity: string; hoursAgo: number }[]
  summary: string
  articlesAnalyzed: number
}
```

---

## AI Service: `POST /zones`

Reuses `fetch_crime_news` and adapts `score_route_safety` into `score_location_safety`:

```python
@router.post("/zones", response_model=ZoneResponse)
async def classify_zones(request: ZoneRequest):
    news = await fetch_crime_news(request.locations)
    zones = []
    for location in request.locations:
        articles = news.get(location, [])
        result = score_location_safety(location, articles)
        zones.append(result)
    return ZoneResponse(zones=zones, totalLocations=len(zones))
```

`score_location_safety(location, articles)` — same penalty/decay logic as `score_route_safety` but operates on a single location string instead of a RouteInput. Returns a `ZoneResult` with zone derived from score:
- score ≥ 70 → `"green"`
- score ≥ 55 → `"yellow"`  
- else → `"red"`

---

## Backend: `POST /api/zones`

```
Request:  { locations: string[] }
Response: { zones: ZoneResult[] }
```

Flow:
1. Normalise: lowercase + trim all locations, deduplicate
2. Split into cached (ZoneCache hit, not expired) and uncached
3. For uncached: POST to AI `/zones`
4. Save AI results to ZoneCache
5. Merge cached + fresh results, return

---

## Frontend: ZonePanel Layout

```
┌─────────────────────────────────────────┐
│ ◈ ZONE INTEL                            │
│ Real-time crime zone classification     │
├─────────────────────────────────────────┤
│ [Search city or area...      ] [SCAN]   │
├─────────────────────────────────────────┤
│ 🔴 Delhi                      42 / 90  │
│   High crime activity detected          │
│   ▸ Murder case filed... (12h ago)      │
│   ▼ 3 neighbourhoods                    │
│     ├ 🔴 Paharganj          41 / 90    │
│     ├ 🟡 Connaught Place    61 / 90    │
│     └ 🟢 Dwarka             74 / 90    │
├─────────────────────────────────────────┤
│ 🟡 Faridabad                  58 / 90  │
│   Moderate risk — proceed with caution  │
│   ▸ Assault reported... (8h ago)        │
└─────────────────────────────────────────┘
```

**Behaviour:**
- **Auto-fill:** when `onRoutesAnalyzed` fires, `routeAreas` are passed to `ZonePanel` via a new `pendingLocations` prop. Panel groups them by city (split on last comma) and calls `POST /api/zones`.
- **Manual search:** user types city/area → calls `POST /api/zones` for that single location → card prepended to list.
- **Sidebar:** new shield icon added as 6th button. `activePanel === "zone"` renders `ZonePanel`.
- **Grouping:** locations sharing the same city (last part after comma) are nested under a city card. If the city itself is in the result list (e.g. `"Delhi"`), use its score directly. Otherwise city score = average of its neighborhoods' scores.
- **Loading:** `RadarPulse` spinner while fetching (matches existing UI pattern).
- **Empty state:** "No zones loaded. Analyze a route or search a city."

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| 0 articles after all fallbacks | Zone defaults to Yellow, summary = `"Insufficient data for precise classification"` |
| Both APIs rate-limited | Return cached result if available; else Yellow with `"Data sources temporarily unavailable"` |
| Invalid/unknown city | 200 with score=90, zone=green, summary=`"No crime data found — treat as unverified"` |
| No routeAreas from route | ZonePanel stays empty, no auto-fill attempted |
| ZoneCache hit | Return instantly without calling AI |

---

## Playwright Tests (additions to `site.spec.js`)

1. **`zone panel opens when zone icon clicked`** — click zone sidebar button, assert panel heading "Zone Intel" visible and search input visible.
2. **`zone panel shows zones after route analysis`** — run full route analysis (Greater Noida → Bulandshahr), switch to zone panel, assert at least one zone card with RED/YELLOW/GREEN text visible.

---

## Out of Scope

- Map polygon overlays for zones (panel list only)
- Pre-seeding a static city database
- Zone history / trends over time
