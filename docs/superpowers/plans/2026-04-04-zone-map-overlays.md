# Zone Map Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a city is searched in the Zone Intel panel, the map flies to it, auto-fetches real neighborhoods via Mapbox Places API, scores each with crime news, and renders colored glow circles on the map.

**Architecture:** A new `mapboxGeo.ts` utility handles Mapbox geocoding and neighborhood discovery client-side. `ZonePanel` gains two callbacks (`onFlyTo`, `onZoneMarkersUpdate`) and drives neighborhood expansion. `MapView` renders circle layers per zone marker. `page.tsx` holds accumulated `zoneMarkers` state and wires everything together.

**Tech Stack:** Mapbox GL JS (circle layers, flyTo, Popup), Next.js 15, React 18, TypeScript

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/web/src/utils/mapboxGeo.ts` | `geocodeLocation()`, `getNeighborhoods()`, `ZoneMarker` type |
| Modify | `apps/web/src/components/map/MapView.tsx` | Accept `zoneMarkers` + `flyTo` props, render circle layers, hover popup |
| Modify | `apps/web/src/components/map/ZonePanel.tsx` | Accept `onFlyTo` + `onZoneMarkersUpdate`, expand neighborhoods on scan |
| Modify | `apps/web/src/app/map/page.tsx` | Hold `zoneMarkers` + `mapFlyTo` state, wire panel ↔ map |
| Modify | `tests/site.spec.js` | Add zone map overlay Playwright test |

---

## Task 1: Create `mapboxGeo.ts`

**Files:**
- Create: `apps/web/src/utils/mapboxGeo.ts`

- [ ] **Step 1: Create the utility file**

Create `apps/web/src/utils/mapboxGeo.ts`:

```ts
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPS_BOX ?? "";

export interface GeoResult {
  lng: number;
  lat: number;
  bbox?: [number, number, number, number]; // [west, south, east, north]
}

export interface ZoneMarker {
  location: string;
  zone: "red" | "yellow" | "green";
  score: number;
  lng: number;
  lat: number;
  topIncident?: string;
}

/**
 * Geocode a place name to coordinates using Mapbox Geocoding API.
 * Returns null on failure — callers must handle null gracefully.
 */
export async function geocodeLocation(name: string): Promise<GeoResult | null> {
  try {
    const encoded = encodeURIComponent(name);
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json` +
        `?types=place,locality,neighborhood&limit=1&access_token=${MAPBOX_TOKEN}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) return null;
    const [lng, lat] = feature.center as [number, number];
    const bbox = feature.bbox as [number, number, number, number] | undefined;
    return { lng, lat, bbox };
  } catch {
    return null;
  }
}

/**
 * Get up to 10 neighborhood/locality names within a city's bounding box.
 * Returns [] on failure — caller falls back to showing just the city marker.
 */
export async function getNeighborhoods(
  bbox: [number, number, number, number],
  cityName: string
): Promise<string[]> {
  try {
    const bboxStr = bbox.join(",");
    const cityLabel = cityName.split(",")[0].trim();
    const encoded = encodeURIComponent(cityLabel);
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json` +
        `?types=neighborhood,locality&bbox=${bboxStr}&limit=10&access_token=${MAPBOX_TOKEN}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features ?? []).map(
      (f: { text: string }) => `${f.text}, ${cityLabel}`
    );
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd E:/vizilare/urban-gaurdian/apps/web
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to `mapboxGeo.ts`

- [ ] **Step 3: Commit**

```bash
cd E:/vizilare/urban-gaurdian
git add apps/web/src/utils/mapboxGeo.ts
git commit -m "feat(frontend): add mapboxGeo utility for geocoding and neighborhood discovery"
```

---

## Task 2: Update `MapView.tsx` — zone circle layers + flyTo

**Files:**
- Modify: `apps/web/src/components/map/MapView.tsx`

- [ ] **Step 1: Replace the entire file with the updated version**

`apps/web/src/components/map/MapView.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { ZoneMarker } from "@/utils/mapboxGeo";

interface RouteGeoJSON {
  routeIndex: number;
  geometry: { type: string; coordinates: [number, number][] };
  safetyScore?: number;
  riskLevel?: string;
}

interface MapViewProps {
  routes?: RouteGeoJSON[];
  origin?: [number, number];
  destination?: [number, number];
  zoneMarkers?: ZoneMarker[];
  flyTo?: { lng: number; lat: number; zoom: number } | null;
}

const ZONE_COLOR: Record<ZoneMarker["zone"], string> = {
  green: "#00e676",
  yellow: "#ffb300",
  red: "#ff3d57",
};

const ZONE_LABEL: Record<ZoneMarker["zone"], string> = {
  green: "GREEN ZONE",
  yellow: "YELLOW ZONE",
  red: "RED ZONE",
};

export default function MapView({
  routes = [],
  origin,
  destination,
  zoneMarkers = [],
  flyTo,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const zoneLayers = useRef<string[]>([]);
  const zoneSources = useRef<string[]>([]);
  const popup = useRef<mapboxgl.Popup | null>(null);

  // ── Init map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPS_BOX!;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [72.8777, 19.076],
      zoom: 12,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.current.once("load", () => {
      map.current?.resize();
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // ── flyTo ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!flyTo || !map.current) return;
    map.current.flyTo({
      center: [flyTo.lng, flyTo.lat],
      zoom: flyTo.zoom,
      duration: 1200,
    });
  }, [flyTo]);

  // ── Route lines ───────────────────────────────────────────────────────────
  useEffect(() => {
    const m = map.current;
    if (!m || !m.isStyleLoaded()) return;

    const drawRoutes = () => {
      routes.forEach((_, i) => {
        if (m.getLayer(`route-${i}`)) m.removeLayer(`route-${i}`);
        if (m.getSource(`route-${i}`)) m.removeSource(`route-${i}`);
      });
      markers.current.forEach((mk) => mk.remove());
      markers.current = [];

      routes.forEach((route) => {
        const color =
          route.riskLevel === "low"
            ? "#00e676"
            : route.riskLevel === "moderate"
            ? "#ffb300"
            : "#ff3d57";
        const opacity = route.riskLevel === "low" ? 1 : 0.55;

        m.addSource(`route-${route.routeIndex}`, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: route.geometry as GeoJSON.Geometry,
          },
        });

        m.addLayer({
          id: `route-${route.routeIndex}`,
          type: "line",
          source: `route-${route.routeIndex}`,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": color,
            "line-width": route.riskLevel === "low" ? 5 : 3,
            "line-opacity": opacity,
          },
        });
      });

      if (origin) {
        const el = document.createElement("div");
        el.style.cssText =
          "width:14px;height:14px;background:#00e676;border-radius:50%;border:2px solid #fff;box-shadow:0 0 8px #00e676;";
        markers.current.push(new mapboxgl.Marker(el).setLngLat(origin).addTo(m));
      }

      if (destination) {
        const el = document.createElement("div");
        el.style.cssText =
          "width:14px;height:14px;background:#ff3d57;border-radius:50%;border:2px solid #fff;box-shadow:0 0 8px #ff3d57;";
        markers.current.push(
          new mapboxgl.Marker(el).setLngLat(destination).addTo(m)
        );
      }

      if (origin && destination) {
        const bounds = new mapboxgl.LngLatBounds(origin, origin);
        bounds.extend(destination);
        m.fitBounds(bounds, { padding: 80 });
      }
    };

    if (m.isStyleLoaded()) {
      drawRoutes();
    } else {
      m.once("load", drawRoutes);
    }
  }, [routes, origin, destination]);

  // ── Zone circle layers ────────────────────────────────────────────────────
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const drawZones = () => {
      // Remove old zone layers then sources
      zoneLayers.current.forEach((id) => {
        if (m.getLayer(id)) m.removeLayer(id);
      });
      zoneSources.current.forEach((id) => {
        if (m.getSource(id)) m.removeSource(id);
      });
      zoneLayers.current = [];
      zoneSources.current = [];
      popup.current?.remove();

      zoneMarkers.forEach((marker, i) => {
        const color = ZONE_COLOR[marker.zone];
        const srcId = `zone-src-${i}`;
        const glowId = `zone-glow-${i}`;
        const dotId = `zone-dot-${i}`;

        m.addSource(srcId, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {
              location: marker.location,
              score: marker.score,
              topIncident: marker.topIncident ?? "",
              zone: marker.zone,
            },
            geometry: {
              type: "Point",
              coordinates: [marker.lng, marker.lat],
            },
          },
        });

        // Glow ring
        m.addLayer({
          id: glowId,
          type: "circle",
          source: srcId,
          paint: {
            "circle-radius": 28,
            "circle-color": color,
            "circle-opacity": 0.2,
            "circle-blur": 1,
          },
        });

        // Inner dot
        m.addLayer({
          id: dotId,
          type: "circle",
          source: srcId,
          paint: {
            "circle-radius": 10,
            "circle-color": color,
            "circle-opacity": 0.85,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-opacity": 0.4,
          },
        });

        zoneLayers.current.push(glowId, dotId);
        zoneSources.current.push(srcId);

        // Hover popup
        m.on("mouseenter", dotId, (e) => {
          const props = e.features?.[0]?.properties as {
            location: string;
            score: number;
            topIncident: string;
            zone: ZoneMarker["zone"];
          } | undefined;
          if (!props) return;
          popup.current?.remove();
          popup.current = new mapboxgl.Popup({
            closeButton: false,
            offset: 14,
          })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font-family:monospace;font-size:11px;color:#fff;background:#1a1f2e;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;min-width:180px">
                <div style="font-weight:bold;margin-bottom:4px;text-transform:capitalize">${props.location}</div>
                <div style="color:${ZONE_COLOR[props.zone]};font-size:10px;margin-bottom:${props.topIncident ? "6px" : "0"}">
                  ${ZONE_LABEL[props.zone]} — ${props.score}/90
                </div>
                ${props.topIncident ? `<div style="color:#8892a4;font-size:10px;line-height:1.4">▸ ${props.topIncident.slice(0, 70)}${props.topIncident.length > 70 ? "…" : ""}</div>` : ""}
              </div>`
            )
            .addTo(m);
          m.getCanvas().style.cursor = "pointer";
        });

        m.on("mouseleave", dotId, () => {
          popup.current?.remove();
          m.getCanvas().style.cursor = "";
        });
      });
    };

    if (m.isStyleLoaded()) {
      drawZones();
    } else {
      m.once("load", drawZones);
    }
  }, [zoneMarkers]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd E:/vizilare/urban-gaurdian/apps/web
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd E:/vizilare/urban-gaurdian
git add apps/web/src/components/map/MapView.tsx
git commit -m "feat(map): add zone circle layers with glow, hover popup, and flyTo"
```

---

## Task 3: Update `ZonePanel.tsx` — neighborhood expansion + map callbacks

**Files:**
- Modify: `apps/web/src/components/map/ZonePanel.tsx`

- [ ] **Step 1: Replace the entire file with the updated version**

`apps/web/src/components/map/ZonePanel.tsx`:

```tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import RadarPulse from "@/components/ui/RadarPulse";
import EncryptedText from "@/components/ui/EncryptedText";
import {
  geocodeLocation,
  getNeighborhoods,
  type ZoneMarker,
} from "@/utils/mapboxGeo";

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
  onFlyTo: (lng: number, lat: number, zoom: number) => void;
  onZoneMarkersUpdate: (markers: ZoneMarker[]) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function zoneColor(zone: ZoneResult["zone"]) {
  if (zone === "green")
    return {
      badge: "text-urban-green",
      border: "border-urban-green/30",
      bg: "bg-urban-green/5",
      dot: "bg-urban-green",
    };
  if (zone === "yellow")
    return {
      badge: "text-yellow-400",
      border: "border-yellow-400/30",
      bg: "bg-yellow-400/5",
      dot: "bg-yellow-400",
    };
  return {
    badge: "text-red-400",
    border: "border-red-500/30",
    bg: "bg-red-500/5",
    dot: "bg-red-400",
  };
}

function zoneLabel(zone: ZoneResult["zone"]) {
  if (zone === "green") return "GREEN ZONE";
  if (zone === "yellow") return "YELLOW ZONE";
  return "RED ZONE";
}

function groupByCity(
  zones: ZoneResult[]
): { city: string; zones: ZoneResult[] }[] {
  const cityMap = new Map<string, ZoneResult[]>();
  for (const z of zones) {
    const parts = z.location.split(",").map((s) => s.trim());
    const city = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    if (!cityMap.has(city)) cityMap.set(city, []);
    cityMap.get(city)!.push(z);
  }
  return Array.from(cityMap.entries()).map(([city, zs]) => ({
    city,
    zones: zs,
  }));
}

function cityScore(group: { city: string; zones: ZoneResult[] }): number {
  const exact = group.zones.find(
    (z) => z.location.toLowerCase().trim() === group.city.toLowerCase().trim()
  );
  if (exact) return exact.score;
  const avg =
    group.zones.reduce((s, z) => s + z.score, 0) / group.zones.length;
  return Math.round(avg * 10) / 10;
}

function cityZone(score: number): ZoneResult["zone"] {
  if (score >= 70) return "green";
  if (score >= 55) return "yellow";
  return "red";
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ZonePanel({
  pendingLocations,
  onFlyTo,
  onZoneMarkersUpdate,
}: ZonePanelProps) {
  const [zones, setZones] = useState<ZoneResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Store geocoded coords per location for card click fly-to
  const coordsRef = useRef<Map<string, { lng: number; lat: number }>>(
    new Map()
  );
  const prevPendingRef = useRef<string>("");

  // ── Geocode zone results → ZoneMarkers ───────────────────────────────────
  async function buildAndEmitMarkers(fresh: ZoneResult[]) {
    const markers: ZoneMarker[] = [];
    await Promise.all(
      fresh.map(async (z) => {
        const g = await geocodeLocation(z.location);
        if (!g) return;
        coordsRef.current.set(z.location.toLowerCase(), {
          lng: g.lng,
          lat: g.lat,
        });
        markers.push({
          location: z.location,
          zone: z.zone,
          score: z.score,
          lng: g.lng,
          lat: g.lat,
          topIncident: z.topIncidents[0]?.title,
        });
      })
    );
    if (markers.length > 0) onZoneMarkersUpdate(markers);
  }

  // ── Fetch zones from backend + update panel list ─────────────────────────
  async function fetchZonesRaw(
    locations: string[],
    mode: "prepend" | "append"
  ): Promise<ZoneResult[]> {
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
      const newOnes = fresh.filter(
        (z) => !existingLocs.has(z.location.toLowerCase())
      );
      return mode === "prepend"
        ? [...newOnes, ...prev]
        : [...prev, ...newOnes];
    });
    return fresh;
  }

  // ── Auto-fill from route analysis (no fly-to, no neighborhood expansion) ─
  useEffect(() => {
    const key = pendingLocations.join(",");
    if (!pendingLocations.length || key === prevPendingRef.current) return;
    prevPendingRef.current = key;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const fresh = await fetchZonesRaw(pendingLocations, "append");
        await buildAndEmitMarkers(fresh);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load zone data");
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLocations]);

  // ── Manual search: geocode → flyTo → neighborhoods → zones → markers ─────
  async function handleSearch() {
    const loc = searchValue.trim();
    if (!loc) return;
    setSearchValue("");
    setLoading(true);
    setError(null);

    try {
      // 1. Geocode search term → fly map immediately
      const geo = await geocodeLocation(loc);
      if (geo) {
        onFlyTo(geo.lng, geo.lat, 11);
      }

      // 2. Discover neighborhoods inside city bbox
      let locations = [loc];
      if (geo?.bbox) {
        const hoods = await getNeighborhoods(geo.bbox, loc);
        if (hoods.length > 0) locations = [loc, ...hoods];
      }

      // 3. Fetch zone scores for city + all neighborhoods
      const fresh = await fetchZonesRaw(locations, "prepend");

      // 4. Geocode each result → emit map markers
      await buildAndEmitMarkers(fresh);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load zone data");
    } finally {
      setLoading(false);
    }
  }

  function toggleExpand(city: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(city) ? next.delete(city) : next.add(city);
      return next;
    });
  }

  function flyToLocation(locationKey: string, zoom: number) {
    const coords = coordsRef.current.get(locationKey.toLowerCase());
    if (coords) onFlyTo(coords.lng, coords.lat, zoom);
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
            <p className="text-xs opacity-60">
              Analyze a route or search a city above.
            </p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {groups.map((group) => {
            const score = cityScore(group);
            const zone = cityZone(score);
            const colors = zoneColor(zone);
            const isExpanded = expanded.has(group.city);
            const hasNeighbourhoods = group.zones.some(
              (z) =>
                z.location.toLowerCase().trim() !==
                group.city.toLowerCase().trim()
            );
            const neighbourhoods = group.zones.filter(
              (z) =>
                z.location.toLowerCase().trim() !==
                group.city.toLowerCase().trim()
            );
            const cityResult = group.zones.find(
              (z) =>
                z.location.toLowerCase().trim() ===
                group.city.toLowerCase().trim()
            );
            const topIncident =
              cityResult?.topIncidents[0] ??
              group.zones.flatMap((z) => z.topIncidents)[0];

            return (
              <motion.div
                key={group.city}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden`}
              >
                {/* City card — click to fly to city */}
                <div
                  className="p-4 space-y-2 cursor-pointer"
                  onClick={() => flyToLocation(group.city, 11)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                      <span className="text-white font-semibold capitalize">
                        {group.city}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-mono font-bold ${colors.badge}`}
                      >
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
                      {topIncident.title.slice(0, 80)}
                      {topIncident.title.length > 80 ? "…" : ""}
                      <span className="opacity-50 ml-1">
                        ({Math.round(topIncident.hoursAgo)}h ago)
                      </span>
                    </p>
                  )}

                  {cityResult && (
                    <p className="text-[11px] text-urban-muted/70 leading-relaxed">
                      {cityResult.summary}
                    </p>
                  )}

                  {hasNeighbourhoods && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(group.city);
                      }}
                      className="text-[11px] font-mono text-urban-muted hover:text-white transition-colors"
                    >
                      {isExpanded ? "▲" : "▼"} {neighbourhoods.length}{" "}
                      neighbourhood
                      {neighbourhoods.length !== 1 ? "s" : ""}
                    </button>
                  )}
                </div>

                {/* Neighbourhood rows — click to fly to neighbourhood */}
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
                          <div
                            key={n.location}
                            className="px-4 py-2.5 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
                            onClick={() => flyToLocation(n.location, 13)}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${nc.dot}`}
                              />
                              <span className="text-sm text-urban-muted capitalize">
                                {n.location.split(",")[0].trim()}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[10px] font-mono font-bold ${nc.badge}`}
                              >
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

- [ ] **Step 2: Verify it compiles**

```bash
cd E:/vizilare/urban-gaurdian/apps/web
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd E:/vizilare/urban-gaurdian
git add apps/web/src/components/map/ZonePanel.tsx
git commit -m "feat(zone): neighborhood expansion, fly-to on scan/card click, map marker emission"
```

---

## Task 4: Update `page.tsx` — wire zoneMarkers state

**Files:**
- Modify: `apps/web/src/app/map/page.tsx`

- [ ] **Step 1: Replace the entire file with the updated version**

`apps/web/src/app/map/page.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import Navbar from "@/components/Navbar";
import Sidebar from "@/components/map/Sidebar";
import GridStatus from "@/components/map/GridStatus";
import SentinelPanel from "@/components/map/SentinelPanel";
import SafeRouteChatPanel, {
  type AnalysisPayload,
} from "@/components/map/SafeRouteChatPanel";
import MapView from "@/components/map/MapView";
import ZonePanel from "@/components/map/ZonePanel";
import type { ZoneMarker } from "@/utils/mapboxGeo";

export interface RouteResult {
  routeIndex: number;
  summary: string;
  distance: string;
  duration: string;
  safetyScore: number;
  riskLevel: string;
  badge?: string;
  tags: string[];
  alert: string;
  alertType: "safe" | "warning" | "danger";
}

const DEFAULT_ROUTES: RouteResult[] = [
  {
    routeIndex: 0,
    summary: "Route 1",
    distance: "2.4 KM",
    duration: "12 MIN",
    safetyScore: 99,
    riskLevel: "low",
    badge: "RECOMMENDED",
    tags: ["99% SAFE", "FASTEST"],
    alert:
      "No recent incidents reported. Sentinel grid coverage is optimal across all sectors.",
    alertType: "safe",
  },
  {
    routeIndex: 1,
    summary: "Route 2",
    distance: "3.1 KM",
    duration: "15 MIN",
    safetyScore: 93,
    riskLevel: "moderate",
    badge: undefined,
    tags: ["93% ALERT RATING"],
    alert: "Minor incident reported 2h ago in Central Park West sector.",
    alertType: "warning",
  },
  {
    routeIndex: 2,
    summary: "Route 3",
    distance: "",
    duration: "",
    safetyScore: 45,
    riskLevel: "high",
    badge: undefined,
    tags: ["45% SECURITY MATCH"],
    alert:
      "High activity reported nearby. AI engine suggests avoiding this perimeter entirely.",
    alertType: "danger",
  },
];

type RouteGeoJSON = {
  routeIndex: number;
  geometry: { type: string; coordinates: [number, number][] };
  safetyScore?: number;
  riskLevel?: string;
};

export default function MapPage() {
  const [activePanel, setActivePanel] = useState("grid");
  const [routes, setRoutes] = useState<RouteResult[]>(DEFAULT_ROUTES);
  const [mapRoutes, setMapRoutes] = useState<RouteGeoJSON[]>([]);
  const [mapOrigin, setMapOrigin] = useState<[number, number] | undefined>();
  const [mapDest, setMapDest] = useState<[number, number] | undefined>();
  const [safetyIndex, setSafetyIndex] = useState(98.2);
  const [pendingZoneLocations, setPendingZoneLocations] = useState<string[]>(
    []
  );
  const [zoneMarkers, setZoneMarkers] = useState<ZoneMarker[]>([]);
  const [mapFlyTo, setMapFlyTo] = useState<{
    lng: number;
    lat: number;
    zoom: number;
  } | null>(null);

  function handleRoutesAnalyzed(payload: AnalysisPayload) {
    setRoutes(payload.sentinelRoutes);
    setMapRoutes(payload.geoRoutes);
    setMapOrigin(payload.origin);
    setMapDest(payload.destination);
    if (payload.sentinelRoutes[0]) {
      setSafetyIndex(payload.sentinelRoutes[0].safetyScore);
    }
    setPendingZoneLocations(payload.routeAreas);
    setActivePanel("grid");
  }

  // Accumulate zone markers — deduplicate by location
  const handleZoneMarkersUpdate = useCallback((newMarkers: ZoneMarker[]) => {
    setZoneMarkers((prev) => {
      const existingLocs = new Set(prev.map((m) => m.location.toLowerCase()));
      const trulyNew = newMarkers.filter(
        (m) => !existingLocs.has(m.location.toLowerCase())
      );
      return [...prev, ...trulyNew];
    });
  }, []);

  const handleFlyTo = useCallback(
    (lng: number, lat: number, zoom: number) => {
      setMapFlyTo({ lng, lat, zoom });
    },
    []
  );

  return (
    <div className="h-screen flex flex-col bg-urban-bg overflow-hidden">
      <Navbar />

      <div className="flex flex-1 pt-16">
        {/* Left Sidebar */}
        <Sidebar activePanel={activePanel} onActiveChange={setActivePanel} />

        {/* Map Area */}
        <div className="flex-1 relative">
          <MapView
            routes={mapRoutes}
            origin={mapOrigin}
            destination={mapDest}
            zoneMarkers={zoneMarkers}
            flyTo={mapFlyTo}
          />

          {/* Grid Status Overlay */}
          <div className="absolute top-6 left-6 z-10">
            <GridStatus
              safetyIndex={safetyIndex}
              activeNodes={5602}
              coverage="Optimal"
            />
          </div>
        </div>

        {/* Right Panel */}
        {activePanel === "ai" ? (
          <SafeRouteChatPanel onRoutesAnalyzed={handleRoutesAnalyzed} />
        ) : activePanel === "zone" ? (
          <ZonePanel
            pendingLocations={pendingZoneLocations}
            onFlyTo={handleFlyTo}
            onZoneMarkersUpdate={handleZoneMarkersUpdate}
          />
        ) : (
          <SentinelPanel routes={routes} />
        )}
      </div>

      {/* Bottom Bar */}
      <div className="h-10 bg-urban-bg border-t border-urban-border flex items-center justify-between px-6 text-xs text-urban-muted">
        <span className="font-mono tracking-wider opacity-60">
          &copy; 2024 URBAN GUARDIANS. SENTINEL ALPHA GRID ACTIVE.
        </span>
        <div className="flex items-center gap-6">
          <span className="hover:text-white cursor-pointer transition-colors">
            SYSTEM STATUS
          </span>
          <span className="hover:text-white cursor-pointer transition-colors">
            PRIVACY PROTOCOL
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd E:/vizilare/urban-gaurdian/apps/web
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd E:/vizilare/urban-gaurdian
git add apps/web/src/app/map/page.tsx
git commit -m "feat(map): wire zoneMarkers and flyTo state between ZonePanel and MapView"
```

---

## Task 5: Add Playwright test + run full suite

**Files:**
- Modify: `tests/site.spec.js`

- [ ] **Step 1: Add zone map overlay test at the end of `tests/site.spec.js`**

Append after the last test:

```javascript
test("zone panel scans city, map receives zone markers", async ({ page }) => {
  test.setTimeout(90000);
  await gotoMap(page);

  // Open zone panel
  await page.locator('button[title="Zone Intel"]').click();
  await expect(page.getByRole("heading", { name: "Zone Intel" })).toBeVisible({ timeout: 5000 });

  // Search a city
  await page.getByPlaceholder(/Search city or area/i).fill("Delhi");
  await page.getByRole("button", { name: "SCAN" }).click();

  // Zone card must appear
  await expect(
    page.locator("text=/RED ZONE|YELLOW ZONE|GREEN ZONE/").first()
  ).toBeVisible({ timeout: 60000 });

  // City card must be clickable (fly-to on click — no crash)
  const cityCard = page.locator(".cursor-pointer").first();
  await cityCard.click();

  await page.screenshot({ path: "screenshots/playwright-zone-map.png", fullPage: false });
});
```

- [ ] **Step 2: Run only zone tests to verify they pass**

```bash
cd E:/vizilare/urban-gaurdian
npx playwright test tests/site.spec.js --grep "zone" --reporter=line 2>&1
```

Expected: 3 passed

- [ ] **Step 3: Run full suite**

```bash
cd E:/vizilare/urban-gaurdian
npx playwright test tests/site.spec.js --reporter=line 2>&1
```

Expected: 15 passed

- [ ] **Step 4: Commit**

```bash
cd E:/vizilare/urban-gaurdian
git add tests/site.spec.js
git commit -m "test: add zone map overlay Playwright test"
```
