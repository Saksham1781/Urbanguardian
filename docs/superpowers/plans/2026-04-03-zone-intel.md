# Zone Intel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Zone Intel panel that classifies cities and neighbourhoods into Red/Yellow/Green crime zones using GNews + NewsData.io, auto-filled from route analysis and searchable manually.

**Architecture:** New `POST /zones` endpoint in FastAPI reuses existing `fetch_crime_news` and a new `score_location_safety` function. Node backend proxies with a 1-hour MongoDB ZoneCache. Frontend adds a `ZonePanel` component wired into the existing sidebar/panel pattern.

**Tech Stack:** Python FastAPI + Pydantic, Node/Express + Mongoose, Next.js 15 + React 18, Tailwind CSS, Framer Motion, Playwright

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `services/ai-service/app/models/schemas.py` | Add ZoneRequest, ZoneResult, ZoneResponse |
| Modify | `services/ai-service/app/utils/safety_scorer.py` | Add `score_location_safety()` |
| Create | `services/ai-service/app/routers/zones.py` | `POST /zones` FastAPI endpoint |
| Modify | `services/ai-service/app/main.py` | Include zones router |
| Create | `services/backend/src/models/ZoneCache.js` | MongoDB ZoneCache schema with 1h TTL |
| Create | `services/backend/src/controllers/zoneController.js` | Cache check + AI proxy logic |
| Create | `services/backend/src/routes/zones.js` | Express router for `/api/zones` |
| Modify | `services/backend/src/server.js` | Mount `/api/zones` |
| Modify | `apps/web/src/components/map/SafeRouteChatPanel.tsx` | Add `routeAreas` to `AnalysisPayload` |
| Create | `apps/web/src/components/map/ZonePanel.tsx` | Zone Intel panel UI component |
| Modify | `apps/web/src/components/map/Sidebar.tsx` | Add zone shield icon (6th button) |
| Modify | `apps/web/src/app/map/page.tsx` | Wire ZonePanel + pendingZoneLocations state |
| Modify | `tests/site.spec.js` | Add 2 zone Playwright tests |

---

## Task 1: AI Schemas — ZoneRequest, ZoneResult, ZoneResponse

**Files:**
- Modify: `services/ai-service/app/models/schemas.py`

- [ ] **Step 1: Add zone schemas at the end of the file**

Open `services/ai-service/app/models/schemas.py`. Append after the existing `AnalysisResponse` class:

```python
class ZoneRequest(BaseModel):
    locations: list[str]


class ZoneResult(BaseModel):
    location: str
    zone: str            # "red" | "yellow" | "green"
    score: float         # 40–90
    riskLevel: str       # "low" | "moderate" | "high" | "critical"
    topIncidents: list[CrimeIncident]
    summary: str
    articlesAnalyzed: int


class ZoneResponse(BaseModel):
    zones: list[ZoneResult]
    totalLocations: int
```

- [ ] **Step 2: Verify the file parses correctly**

```bash
cd E:/vizilare/urban-gaurdian/services/ai-service
python -c "from app.models.schemas import ZoneRequest, ZoneResult, ZoneResponse; print('schemas OK')"
```

Expected output: `schemas OK`

- [ ] **Step 3: Commit**

```bash
cd E:/vizilare/urban-gaurdian
git add services/ai-service/app/models/schemas.py
git commit -m "feat(ai): add ZoneRequest, ZoneResult, ZoneResponse schemas"
```

---

## Task 2: AI Safety Scorer — `score_location_safety`

**Files:**
- Modify: `services/ai-service/app/utils/safety_scorer.py`

- [ ] **Step 1: Update the import line at the top of safety_scorer.py**

Change:
```python
from app.models.schemas import RouteSafetyResult, CrimeIncident
```
To:
```python
from app.models.schemas import RouteSafetyResult, CrimeIncident, ZoneResult
```

- [ ] **Step 2: Add `score_location_safety` after `score_route_safety`**

Add this function after the closing of `score_route_safety` and before `_is_irrelevant`:

```python
def score_location_safety(location: str, articles: list[dict]) -> ZoneResult:
    """
    Score a single city/neighbourhood's safety from a list of crime articles.
    Reuses the same penalty/decay logic as score_route_safety.
    Returns a ZoneResult with zone = "red" | "yellow" | "green".
    """
    if not articles:
        return ZoneResult(
            location=location,
            zone="yellow",
            score=55.0,
            riskLevel="moderate",
            topIncidents=[],
            summary="Insufficient data for precise classification",
            articlesAnalyzed=0,
        )

    score = 100.0
    incidents: list[CrimeIncident] = []

    for article in articles:
        text = article.get("title", "") + " " + article.get("description", "")
        if _is_irrelevant(text):
            continue
        severity = _classify_severity(text)
        hours_ago = article.get("hoursAgo", 9999)
        time_decay = math.exp(-0.003 * hours_ago)
        score -= SEVERITY_PENALTY.get(severity, 5) * time_decay
        incidents.append(CrimeIncident(
            title=article.get("title", ""),
            description=article.get("description", ""),
            source=article.get("source", "Unknown"),
            publishedAt=article.get("publishedAt", ""),
            hoursAgo=hours_ago,
            severity=severity,
            location=location,
        ))

    score = max(40.0, min(90.0, score))

    if score >= 70:
        zone, risk_level = "green", "low"
    elif score >= 55:
        zone, risk_level = "yellow", "moderate"
    else:
        zone, risk_level = "red", "high"

    top_incidents = sorted(incidents, key=lambda i: i.hoursAgo)[:3]
    summary = (
        f"Analyzed {len(articles)} articles. Found {len(incidents)} relevant crime incidents."
        if incidents
        else f"Analyzed {len(articles)} articles. No crime incidents matched criteria."
    )

    return ZoneResult(
        location=location,
        zone=zone,
        score=round(score, 1),
        riskLevel=risk_level,
        topIncidents=top_incidents,
        summary=summary,
        articlesAnalyzed=len(articles),
    )
```

- [ ] **Step 3: Verify it imports and runs**

```bash
cd E:/vizilare/urban-gaurdian/services/ai-service
python -c "
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path('.').resolve().parents[1] / '.env')
from app.utils.safety_scorer import score_location_safety
result = score_location_safety('TestCity', [])
print('zone:', result.zone, '| score:', result.score)
"
```

Expected output: `zone: yellow | score: 55.0`

- [ ] **Step 4: Commit**

```bash
cd E:/vizilare/urban-gaurdian
git add services/ai-service/app/utils/safety_scorer.py
git commit -m "feat(ai): add score_location_safety for zone classification"
```

---

## Task 3: AI Zones Router + Register in main.py

**Files:**
- Create: `services/ai-service/app/routers/zones.py`
- Modify: `services/ai-service/app/main.py`

- [ ] **Step 1: Create `zones.py` router**

Create `services/ai-service/app/routers/zones.py`:

```python
from fastapi import APIRouter
from app.models.schemas import ZoneRequest, ZoneResponse
from app.utils.news_fetcher import fetch_crime_news
from app.utils.safety_scorer import score_location_safety

router = APIRouter()


@router.post("/zones", response_model=ZoneResponse)
async def classify_zones(request: ZoneRequest):
    """
    Classify each location into a Red / Yellow / Green crime zone.
    Reuses fetch_crime_news (with 4-level fallback) and score_location_safety.
    """
    locations = [loc.strip() for loc in request.locations if loc.strip()]
    if not locations:
        return ZoneResponse(zones=[], totalLocations=0)

    news_by_location = await fetch_crime_news(locations)

    zones = []
    for location in locations:
        articles = news_by_location.get(location, [])
        zone_result = score_location_safety(location, articles)
        zones.append(zone_result)

    return ZoneResponse(zones=zones, totalLocations=len(zones))
```

- [ ] **Step 2: Register the router in main.py**

In `services/ai-service/app/main.py`, add the import and include after the existing `analysis` router:

```python
from app.routers import analysis, zones   # ← change this line

# ...existing code...

app.include_router(analysis.router)
app.include_router(zones.router)          # ← add this line
```

- [ ] **Step 3: Restart AI service and test the endpoint**

Kill existing uvicorn and restart:
```bash
wmic process where "CommandLine like '%uvicorn%'" delete 2>nul
cd E:/vizilare/urban-gaurdian/services/ai-service
uvicorn app.main:app --port 8001 > /tmp/ai_zones.log 2>&1 &
```

Wait 5 seconds, then test:
```bash
sleep 5 && curl -s -X POST http://localhost:8001/zones \
  -H "Content-Type: application/json" \
  -d '{"locations": ["Delhi", "Noida, Uttar Pradesh"]}' \
  | python -c "import sys,json; d=json.load(sys.stdin); [print(z['location'], z['zone'], z['score']) for z in d['zones']]"
```

Expected output (values vary):
```
Delhi red 42.3
Noida, Uttar Pradesh yellow 58.7
```

- [ ] **Step 4: Commit**

```bash
cd E:/vizilare/urban-gaurdian
git add services/ai-service/app/routers/zones.py services/ai-service/app/main.py
git commit -m "feat(ai): add POST /zones endpoint with zone classification"
```

---

## Task 4: Backend — ZoneCache MongoDB Model

**Files:**
- Create: `services/backend/src/models/ZoneCache.js`

- [ ] **Step 1: Create the model**

Create `services/backend/src/models/ZoneCache.js`:

```javascript
const mongoose = require("mongoose");

const incidentSchema = new mongoose.Schema({
  title:       { type: String, default: "" },
  description: { type: String, default: "" },
  source:      { type: String, default: "Unknown" },
  publishedAt: { type: String, default: "" },
  hoursAgo:    { type: Number, default: 9999 },
  severity:    { type: String, default: "low" },
  location:    { type: String, default: "" },
}, { _id: false });

const zoneCacheSchema = new mongoose.Schema({
  location:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  zone:             { type: String, enum: ["red", "yellow", "green"], required: true },
  score:            { type: Number, required: true },
  riskLevel:        { type: String, required: true },
  topIncidents:     { type: [incidentSchema], default: [] },
  summary:          { type: String, default: "" },
  articlesAnalyzed: { type: Number, default: 0 },
  cachedAt:         { type: Date, default: Date.now },
  expiresAt:        { type: Date, required: true, index: { expires: 0 } },
});

module.exports = mongoose.model("ZoneCache", zoneCacheSchema);
```

- [ ] **Step 2: Verify the model loads**

```bash
cd E:/vizilare/urban-gaurdian/services/backend
node -e "
require('dotenv').config({ path: require('path').resolve('../../../.env') });
const ZoneCache = require('./src/models/ZoneCache');
console.log('ZoneCache model OK, collection:', ZoneCache.collection.name);
process.exit(0);
"
```

Expected output: `ZoneCache model OK, collection: zonecaches`

- [ ] **Step 3: Commit**

```bash
cd E:/vizilare/urban-gaurdian
git add services/backend/src/models/ZoneCache.js
git commit -m "feat(backend): add ZoneCache MongoDB model with 1h TTL"
```

---

## Task 5: Backend — Zone Controller

**Files:**
- Create: `services/backend/src/controllers/zoneController.js`

- [ ] **Step 1: Create the controller**

Create `services/backend/src/controllers/zoneController.js`:

```javascript
const axios = require("axios");
const { isDBConnected } = require("../utils/db");
const ZoneCache = require("../models/ZoneCache");

const AI_SERVICE_URL = `http://localhost:${process.env.PYTHON_PORT || 8001}`;

async function classifyZones(req, res) {
  try {
    const { locations } = req.body;

    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return res.status(400).json({ error: "locations array is required" });
    }

    // Normalise: lowercase + trim + deduplicate
    const normalised = [...new Set(locations.map((l) => l.toLowerCase().trim()))].filter(Boolean);

    // Split into cached and uncached
    let cachedZones = [];
    let uncachedLocations = normalised;

    if (isDBConnected()) {
      const cached = await ZoneCache.find({
        location: { $in: normalised },
        expiresAt: { $gt: new Date() },
      });

      cachedZones = cached.map((doc) => ({
        location: doc.location,
        zone: doc.zone,
        score: doc.score,
        riskLevel: doc.riskLevel,
        topIncidents: doc.topIncidents,
        summary: doc.summary,
        articlesAnalyzed: doc.articlesAnalyzed,
      }));

      const cachedLocationSet = new Set(cached.map((c) => c.location));
      uncachedLocations = normalised.filter((l) => !cachedLocationSet.has(l));
    }

    // Fetch uncached locations from AI service
    let freshZones = [];
    if (uncachedLocations.length > 0) {
      const aiResponse = await axios.post(`${AI_SERVICE_URL}/zones`, {
        locations: uncachedLocations,
      });
      freshZones = aiResponse.data.zones || [];

      // Save fresh results to ZoneCache
      if (isDBConnected()) {
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await Promise.all(
          freshZones.map((z) =>
            ZoneCache.findOneAndUpdate(
              { location: z.location.toLowerCase().trim() },
              { ...z, location: z.location.toLowerCase().trim(), cachedAt: new Date(), expiresAt },
              { upsert: true, new: true }
            )
          )
        );
      }
    }

    // Merge cached + fresh, preserve original order
    const zoneMap = {};
    [...cachedZones, ...freshZones].forEach((z) => {
      zoneMap[z.location.toLowerCase().trim()] = z;
    });

    const zones = normalised.map((loc) => zoneMap[loc]).filter(Boolean);

    res.json({ zones, totalLocations: zones.length });
  } catch (error) {
    console.error("Zone classification error:", error.message);
    res.status(500).json({ error: "Failed to classify zones", details: error.message });
  }
}

module.exports = { classifyZones };
```

- [ ] **Step 2: Commit**

```bash
cd E:/vizilare/urban-gaurdian
git add services/backend/src/controllers/zoneController.js
git commit -m "feat(backend): add zone controller with MongoDB caching"
```

---

## Task 6: Backend — Zone Route + Mount in server.js

**Files:**
- Create: `services/backend/src/routes/zones.js`
- Modify: `services/backend/src/server.js`

- [ ] **Step 1: Create the Express router**

Create `services/backend/src/routes/zones.js`:

```javascript
const express = require("express");
const router = express.Router();
const { classifyZones } = require("../controllers/zoneController");

// POST /api/zones  { locations: string[] }
router.post("/", classifyZones);

module.exports = router;
```

- [ ] **Step 2: Mount the router in server.js**

In `services/backend/src/server.js`, add after the existing route requires:

```javascript
const zoneRoutes = require("./routes/zones");   // ← add this line
```

And mount after the existing routes:

```javascript
app.use("/api/zones", zoneRoutes);              // ← add this line
```

The routes block should look like:
```javascript
app.use("/api/routes", routeRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/zones", zoneRoutes);
```

- [ ] **Step 3: Restart the backend and test end-to-end**

```bash
wmic process where "CommandLine like '%node src/server%'" delete 2>nul
sleep 2
cd E:/vizilare/urban-gaurdian/services/backend
node src/server.js > /tmp/backend_zones.log 2>&1 &
sleep 3
curl -s -X POST http://localhost:5000/api/zones \
  -H "Content-Type: application/json" \
  -d '{"locations": ["Delhi", "Mumbai"]}' \
  | python -c "import sys,json; d=json.load(sys.stdin); [print(z['location'], z['zone'], z['score']) for z in d['zones']]"
```

Expected output (values vary, zones will be red/yellow/green):
```
delhi red 42.1
mumbai yellow 61.4
```

- [ ] **Step 4: Commit**

```bash
cd E:/vizilare/urban-gaurdian
git add services/backend/src/routes/zones.js services/backend/src/server.js
git commit -m "feat(backend): mount POST /api/zones route"
```

---

## Task 7: Frontend — Update AnalysisPayload + Create ZonePanel

**Files:**
- Modify: `apps/web/src/components/map/SafeRouteChatPanel.tsx`
- Create: `apps/web/src/components/map/ZonePanel.tsx`

- [ ] **Step 1: Add `routeAreas` to AnalysisPayload in SafeRouteChatPanel.tsx**

Find the `AnalysisPayload` interface (around line 33) and add `routeAreas`:

```tsx
export interface AnalysisPayload {
  sentinelRoutes: RouteResult[];
  geoRoutes: RouteGeoJSON[];
  origin: [number, number];
  destination: [number, number];
  newsCount: number;
  routeAreas: string[];           // ← add this line
}
```

- [ ] **Step 2: Populate routeAreas in the onRoutesAnalyzed call**

In `handleAnalyze` inside `SafeRouteChatPanel.tsx`, find the `onRoutesAnalyzed({...})` call (around line 203) and add `routeAreas`:

```tsx
// Collect all unique route areas from raw routes
const allAreas = (rawRoutes as { routeAreas?: string[] }[])
  .flatMap((r) => r.routeAreas ?? []);
const uniqueAreas = [...new Set(allAreas)];

onRoutesAnalyzed({
  sentinelRoutes,
  geoRoutes,
  origin: originCoords,
  destination: destCoords,
  newsCount: analysis.newsArticlesFound ?? 0,
  routeAreas: uniqueAreas,         // ← add this line
});
```

- [ ] **Step 3: Create ZonePanel.tsx**

Create `apps/web/src/components/map/ZonePanel.tsx`:

```tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import RadarPulse from "@/components/ui/RadarPulse";
import EncryptedText from "@/components/ui/EncryptedText";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

// ── Types ──────────────────────────────────────────────────────────────────

interface ZoneIncident {
  title: string;
  severity: string;
  hoursAgo: number;
}

interface ZoneResult {
  location: string;
  zone: "red" | "yellow" | "green";
  score: number;
  riskLevel: string;
  topIncidents: ZoneIncident[];
  summary: string;
  articlesAnalyzed: number;
}

interface ZonePanelProps {
  pendingLocations: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function zoneColor(zone: ZoneResult["zone"]) {
  if (zone === "green") return { badge: "text-urban-green", border: "border-urban-green/30", bg: "bg-urban-green/5", dot: "bg-urban-green" };
  if (zone === "yellow") return { badge: "text-yellow-400", border: "border-yellow-400/30", bg: "bg-yellow-400/5", dot: "bg-yellow-400" };
  return { badge: "text-red-400", border: "border-red-500/30", bg: "bg-red-500/5", dot: "bg-red-400" };
}

function zoneLabel(zone: ZoneResult["zone"]) {
  if (zone === "green") return "GREEN ZONE";
  if (zone === "yellow") return "YELLOW ZONE";
  return "RED ZONE";
}

/** Group a flat list of zone results by their city (last comma-separated part). */
function groupByCity(zones: ZoneResult[]): { city: string; zones: ZoneResult[] }[] {
  const cityMap = new Map<string, ZoneResult[]>();

  for (const z of zones) {
    const parts = z.location.split(",").map((s) => s.trim());
    const city = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    if (!cityMap.has(city)) cityMap.set(city, []);
    cityMap.get(city)!.push(z);
  }

  return Array.from(cityMap.entries()).map(([city, zs]) => ({ city, zones: zs }));
}

/** Get the representative score for a city group. */
function cityScore(group: { city: string; zones: ZoneResult[] }): number {
  const exact = group.zones.find(
    (z) => z.location.toLowerCase().trim() === group.city.toLowerCase().trim()
  );
  if (exact) return exact.score;
  const avg = group.zones.reduce((s, z) => s + z.score, 0) / group.zones.length;
  return Math.round(avg * 10) / 10;
}

function cityZone(score: number): ZoneResult["zone"] {
  if (score >= 70) return "green";
  if (score >= 55) return "yellow";
  return "red";
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ZonePanel({ pendingLocations }: ZonePanelProps) {
  const [zones, setZones] = useState<ZoneResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const prevPendingRef = useRef<string>("");

  // Auto-fill from route analysis
  useEffect(() => {
    const key = pendingLocations.join(",");
    if (!pendingLocations.length || key === prevPendingRef.current) return;
    prevPendingRef.current = key;
    fetchZones(pendingLocations, "append");
  }, [pendingLocations]);

  async function fetchZones(locations: string[], mode: "prepend" | "append") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/zones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locations }),
      });
      if (!res.ok) throw new Error("Zone fetch failed");
      const data = await res.json();
      const fresh: ZoneResult[] = data.zones ?? [];
      setZones((prev) => {
        const existingLocs = new Set(prev.map((z) => z.location.toLowerCase()));
        const newOnes = fresh.filter((z) => !existingLocs.has(z.location.toLowerCase()));
        return mode === "prepend" ? [...newOnes, ...prev] : [...prev, ...newOnes];
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load zone data");
    } finally {
      setLoading(false);
    }
  }

  function handleSearch() {
    const loc = searchValue.trim();
    if (!loc) return;
    fetchZones([loc], "prepend");
    setSearchValue("");
  }

  function toggleExpand(city: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(city) ? next.delete(city) : next.add(city);
      return next;
    });
  }

  const groups = groupByCity(zones);

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4 }}
      className="w-[390px] bg-urban-surface border-l border-urban-border flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="p-6 pb-5 border-b border-urban-border flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-urban-green pulse-dot" />
          <p className="text-[10px] font-mono text-urban-muted uppercase tracking-[0.2em]">
            <EncryptedText text="ZONE INTEL — CRIME CLASSIFICATION" speed={30} />
          </p>
        </div>
        <h2 className="text-2xl font-bold text-white mb-1.5">Zone Intel</h2>
        <p className="text-sm text-urban-muted leading-relaxed">
          Real-time crime zone classification by city and neighbourhood.
        </p>
      </div>

      {/* Search */}
      <div className="p-4 border-b border-urban-border flex-shrink-0 flex gap-2">
        <input
          type="text"
          placeholder="Search city or area..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          disabled={loading}
          className="flex-1 bg-urban-card border border-urban-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-urban-muted focus:outline-none focus:border-urban-green/50 disabled:opacity-50 transition-colors"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !searchValue.trim()}
          className="px-4 py-2.5 bg-urban-green text-urban-bg text-xs font-bold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-[0_0_16px_rgba(0,230,118,0.3)] transition-all"
        >
          SCAN
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && (
          <div className="flex flex-col items-center gap-4 py-8">
            <RadarPulse size={64} />
            <p className="text-xs font-mono text-urban-green tracking-wider animate-pulse">
              SCANNING CRIME DATABASE...
            </p>
          </div>
        )}

        {error && (
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && zones.length === 0 && (
          <div className="text-center py-12 text-urban-muted text-sm">
            <p className="mb-1">No zones loaded.</p>
            <p className="text-xs opacity-60">Analyze a route or search a city above.</p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {groups.map((group) => {
            const score = cityScore(group);
            const zone = cityZone(score);
            const colors = zoneColor(zone);
            const isExpanded = expanded.has(group.city);
            const hasNeighbourhoods = group.zones.some(
              (z) => z.location.toLowerCase().trim() !== group.city.toLowerCase().trim()
            );
            const neighbourhoods = group.zones.filter(
              (z) => z.location.toLowerCase().trim() !== group.city.toLowerCase().trim()
            );
            const cityResult = group.zones.find(
              (z) => z.location.toLowerCase().trim() === group.city.toLowerCase().trim()
            );
            const topIncident = cityResult?.topIncidents[0] ?? group.zones.flatMap((z) => z.topIncidents)[0];

            return (
              <motion.div
                key={group.city}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden`}
              >
                {/* City card */}
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                      <span className="text-white font-semibold capitalize">{group.city}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-mono font-bold ${colors.badge}`}>
                        {zoneLabel(zone)}
                      </span>
                      <span className="text-xs text-urban-muted font-mono">
                        {score} / 90
                      </span>
                    </div>
                  </div>

                  {topIncident && (
                    <p className="text-xs text-urban-muted leading-relaxed">
                      <span className={`${colors.badge} mr-1`}>▸</span>
                      {topIncident.title.slice(0, 80)}{topIncident.title.length > 80 ? "…" : ""}
                      <span className="opacity-50 ml-1">({Math.round(topIncident.hoursAgo)}h ago)</span>
                    </p>
                  )}

                  {cityResult && (
                    <p className="text-[11px] text-urban-muted/70 leading-relaxed">
                      {cityResult.summary}
                    </p>
                  )}

                  {hasNeighbourhoods && (
                    <button
                      onClick={() => toggleExpand(group.city)}
                      className="text-[11px] font-mono text-urban-muted hover:text-white transition-colors"
                    >
                      {isExpanded ? "▲" : "▼"} {neighbourhoods.length} neighbourhood{neighbourhoods.length !== 1 ? "s" : ""}
                    </button>
                  )}
                </div>

                {/* Neighbourhood rows */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="border-t border-urban-border/50 divide-y divide-urban-border/30"
                    >
                      {neighbourhoods.map((n) => {
                        const nc = zoneColor(n.zone);
                        return (
                          <div key={n.location} className="px-4 py-2.5 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`w-1.5 h-1.5 rounded-full ${nc.dot}`} />
                              <span className="text-sm text-urban-muted capitalize">
                                {n.location.split(",")[0].trim()}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-mono font-bold ${nc.badge}`}>
                                {zoneLabel(n.zone)}
                              </span>
                              <span className="text-[10px] text-urban-muted font-mono">
                                {n.score} / 90
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
cd E:/vizilare/urban-gaurdian
git add apps/web/src/components/map/SafeRouteChatPanel.tsx apps/web/src/components/map/ZonePanel.tsx
git commit -m "feat(frontend): add ZonePanel component and routeAreas to AnalysisPayload"
```

---

## Task 8: Frontend — Sidebar Icon + page.tsx Wiring

**Files:**
- Modify: `apps/web/src/components/map/Sidebar.tsx`
- Modify: `apps/web/src/app/map/page.tsx`

- [ ] **Step 1: Add zone shield icon to sidebarIcons array in Sidebar.tsx**

In `apps/web/src/components/map/Sidebar.tsx`, add a new entry to the `sidebarIcons` array after the `"ai"` entry:

```tsx
  {
    id: "zone",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V7L12 2z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
```

Also update the `title` attribute logic. Find the button's `title` prop:

```tsx
title={item.id === "ai" ? "SafeRoute AI" : item.id}
```

Change it to:

```tsx
title={item.id === "ai" ? "SafeRoute AI" : item.id === "zone" ? "Zone Intel" : item.id}
```

- [ ] **Step 2: Wire ZonePanel in page.tsx**

In `apps/web/src/app/map/page.tsx`:

**Add import** at the top with the other component imports:
```tsx
import ZonePanel from "@/components/map/ZonePanel";
```

**Add state** inside `MapPage` after the `safetyIndex` state:
```tsx
const [pendingZoneLocations, setPendingZoneLocations] = useState<string[]>([]);
```

**Update `handleRoutesAnalyzed`** to capture routeAreas:
```tsx
function handleRoutesAnalyzed(payload: AnalysisPayload) {
  setRoutes(payload.sentinelRoutes);
  setMapRoutes(payload.geoRoutes);
  setMapOrigin(payload.origin);
  setMapDest(payload.destination);
  if (payload.sentinelRoutes[0]) {
    setSafetyIndex(payload.sentinelRoutes[0].safetyScore);
  }
  setPendingZoneLocations(payload.routeAreas);  // ← add this line
  setActivePanel("grid");
}
```

**Update the right panel JSX** (currently a ternary `activePanel === "ai" ? ... : ...`). Replace it with:
```tsx
{activePanel === "ai" ? (
  <SafeRouteChatPanel onRoutesAnalyzed={handleRoutesAnalyzed} />
) : activePanel === "zone" ? (
  <ZonePanel pendingLocations={pendingZoneLocations} />
) : (
  <SentinelPanel routes={routes} />
)}
```

- [ ] **Step 3: Verify the frontend compiles**

```bash
cd E:/vizilare/urban-gaurdian/apps/web
npx tsc --noEmit 2>&1 | head -20 || echo "Type check done"
```

Expected: no errors (or only pre-existing unrelated warnings)

- [ ] **Step 4: Commit**

```bash
cd E:/vizilare/urban-gaurdian
git add apps/web/src/components/map/Sidebar.tsx apps/web/src/app/map/page.tsx
git commit -m "feat(frontend): wire ZonePanel into sidebar and map page"
```

---

## Task 9: Playwright Tests

**Files:**
- Modify: `tests/site.spec.js`

- [ ] **Step 1: Add two zone tests to site.spec.js**

Append these two tests after the last existing test in `tests/site.spec.js`:

```javascript
// ── Zone Intel ─────────────────────────────────────────────────────────────
test("zone panel opens when zone icon clicked", async ({ page }) => {
  await gotoMap(page);

  const zoneBtn = page.locator('button[title="Zone Intel"]');
  await expect(zoneBtn).toBeVisible({ timeout: 10000 });
  await zoneBtn.click();

  await expect(page.getByRole("heading", { name: "Zone Intel" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByPlaceholder(/Search city or area/i)).toBeVisible();

  await page.screenshot({ path: "screenshots/playwright-zone-panel.png", fullPage: false });
});

test("zone panel shows zones after route analysis", async ({ page }) => {
  test.setTimeout(120000);
  await gotoMap(page);

  // Run a full route analysis first
  await page.locator('button[title="SafeRoute AI"]').click();
  await expect(page.getByRole("heading", { name: "SafeRoute AI" })).toBeVisible({ timeout: 5000 });
  await page.getByPlaceholder(/Origin/i).fill("Greater Noida, India");
  await page.getByPlaceholder(/Destination/i).fill("Bulandshahr, India");
  await page.getByRole("button", { name: /Analyze Route/i }).click();
  await expect(page.getByRole("heading", { name: "Sentinel Paths" })).toBeVisible({ timeout: 60000 });

  // Switch to Zone Intel panel
  await page.locator('button[title="Zone Intel"]').click();
  await expect(page.getByRole("heading", { name: "Zone Intel" })).toBeVisible({ timeout: 5000 });

  // At least one zone card should appear (RED ZONE / YELLOW ZONE / GREEN ZONE)
  await expect(
    page.getByText(/RED ZONE|YELLOW ZONE|GREEN ZONE/).first()
  ).toBeVisible({ timeout: 30000 });

  await page.screenshot({ path: "screenshots/playwright-zone-results.png", fullPage: false });
});
```

- [ ] **Step 2: Run the full Playwright suite**

```bash
cd E:/vizilare/urban-gaurdian
npx playwright test --reporter=list 2>&1
```

Expected: **14/14 passed**

- [ ] **Step 3: Commit**

```bash
cd E:/vizilare/urban-gaurdian
git add tests/site.spec.js
git commit -m "test: add Playwright tests for Zone Intel panel"
```

---

## Self-Review Checklist

- [x] **Schema coverage**: ZoneRequest/ZoneResult/ZoneResponse added in Task 1, used in Tasks 2, 3, 5, 7
- [x] **score_location_safety**: defined in Task 2, called in Task 3 zones router
- [x] **Backend caching**: ZoneCache model (Task 4), controller checks cache before calling AI (Task 5)
- [x] **Auto-fill flow**: routeAreas added to AnalysisPayload (Task 7), set in page state (Task 8), passed as pendingLocations prop to ZonePanel (Task 8), ZonePanel useEffect triggers fetch (Task 7)
- [x] **Manual search**: SCAN button in ZonePanel calls `/api/zones` for single location (Task 7)
- [x] **Grouping by city**: `groupByCity` helper + city score logic in ZonePanel (Task 7)
- [x] **Sidebar icon**: zone shield icon added with title "Zone Intel" (Task 8)
- [x] **Type consistency**: `ZoneResult`, `ZoneIncident`, `AnalysisPayload.routeAreas` all consistent across tasks
- [x] **Error states**: loading/error/empty all handled in ZonePanel (Task 7)
- [x] **Playwright tests**: 2 tests added in Task 9
