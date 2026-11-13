# Zone Map Overlays — Design Spec
**Date:** 2026-04-04
**Project:** Urban Guardians
**Status:** Approved

---

## Overview

When a user searches a city or area in the Zone Intel panel, the map should:
1. **Fly to** that location immediately on SCAN
2. **Auto-expand** into real neighborhoods via Mapbox Places API
3. **Fetch zone scores** for each neighborhood from the existing `/api/zones` endpoint (GNews + NewsData.io)
4. **Render colored overlays** on the map — glow circle + inner dot per neighborhood, colored by zone

Zone colors are derived purely from crime news data. Each neighborhood is scored independently using the same `score_location_safety()` formula, so scores are directly comparable across localities within the same city.

---

## Scoring & Color Assignment

| Score | Zone | Map Color | Label |
|-------|------|-----------|-------|
| 70–90 | green | `#00e676` | GREEN ZONE |
| 55–69 | yellow | `#ffb300` | YELLOW ZONE |
| 40–54 | red | `#ff3d57` | RED ZONE |

Scores come from `score_location_safety()` — same penalty/decay formula for every location, so neighborhood colors are meaningful relative to each other. No hardcoded values.

---

## Architecture & Data Flow

```
User types "Delhi" → SCAN clicked
  │
  ├─ 1. geocodeLocation("Delhi")
  │       → Mapbox Geocoding API
  │       → { lng, lat, bbox }
  │       → onFlyTo(lng, lat, zoom=11)    ← map flies immediately
  │
  ├─ 2. getNeighborhoods(bbox, "Delhi")
  │       → Mapbox Places API (types=neighborhood,locality, limit=10)
  │       → ["Connaught Place, Delhi", "Paharganj, Delhi", ...]
  │
  ├─ 3. POST /api/zones
  │       → locations: ["Delhi", ...neighborhoods]
  │       → Node backend: dedup + ZoneCache check
  │       → AI service: fetch_crime_news() [GNews + NewsData.io]
  │       → score_location_safety() per location
  │       → ZoneResult[] with zone, score, topIncidents
  │
  ├─ 4. geocodeLocation() per ZoneResult
  │       → { lng, lat } for each neighborhood
  │
  └─ 5. onZoneMarkersUpdate(ZoneMarker[])
          → MapView renders circle layers
```

**Clicking a zone card in the panel:**
- Calls `onFlyTo(lng, lat, zoom=13)` for that specific location

**Auto-fill from route analysis:**
- `pendingLocations` already populated → same flow as manual scan
- `flyTo` fits bounds to show all zone markers

---

## New Files

### `apps/web/src/utils/mapboxGeo.ts`

Two exported functions:

```ts
interface GeoResult {
  lng: number
  lat: number
  bbox?: [number, number, number, number]  // [west, south, east, north]
}

export async function geocodeLocation(name: string): Promise<GeoResult | null>
```
Calls `GET https://api.mapbox.com/geocoding/v5/mapbox.places/{name}.json?types=place,locality,neighborhood&limit=1&access_token=...`
Returns center + bbox, or null on failure.

```ts
export async function getNeighborhoods(
  bbox: [number, number, number, number],
  cityName: string
): Promise<string[]>
```
Calls `GET https://api.mapbox.com/geocoding/v5/mapbox.places/{cityName}.json?types=neighborhood,locality&bbox={bbox}&limit=10&access_token=...`
Returns array of `"Neighborhood, City"` strings. Falls back to `[]` on failure.

---

## Modified Files

### `apps/web/src/components/map/MapView.tsx`

Add `zoneMarkers` prop:

```ts
interface ZoneMarker {
  location: string
  zone: "red" | "yellow" | "green"
  score: number
  lng: number
  lat: number
  topIncident?: string
}

interface MapViewProps {
  routes?: RouteGeoJSON[]
  origin?: [number, number]
  destination?: [number, number]
  zoneMarkers?: ZoneMarker[]
  flyTo?: { lng: number; lat: number; zoom: number } | null
}
```

**Zone marker rendering** — for each marker, add two Mapbox circle layers:
- `zone-glow-{i}`: radius 28, zone color, opacity 0.2
- `zone-dot-{i}`: radius 10, zone color, opacity 0.85

**Hover popup** — `mouseenter` on `zone-dot-{i}` shows a `mapboxgl.Popup` with:
```
{location}
{zone label} — {score}/90
▸ {topIncident}  (if available)
```

**Clear on update** — before drawing new markers, remove all existing `zone-glow-*` and `zone-dot-*` layers/sources and close any open popup.

**flyTo effect** — separate `useEffect` watching the `flyTo` prop:
```ts
useEffect(() => {
  if (!flyTo || !map.current) return
  map.current.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: flyTo.zoom, duration: 1200 })
}, [flyTo])
```

### `apps/web/src/components/map/ZonePanel.tsx`

Add to `ZonePanelProps`:
```ts
interface ZonePanelProps {
  pendingLocations: string[]
  onFlyTo: (lng: number, lat: number, zoom: number) => void
  onZoneMarkersUpdate: (markers: ZoneMarker[]) => void
}
```

**fetchZones flow changes:**
1. Before POST /api/zones: `geocodeLocation(searchTerm)` → call `onFlyTo(lng, lat, 11)`
2. If geocoded bbox available: `getNeighborhoods(bbox, cityName)` → append to locations list
3. After zone results: `geocodeLocation()` each result → build `ZoneMarker[]` → call `onZoneMarkersUpdate(markers)`

**Card click** — each city/neighbourhood card gets an `onClick` that calls `onFlyTo(lng, lat, 13)` (coords stored alongside zone data after geocoding).

### `apps/web/src/app/map/page.tsx`

Add state:
```ts
const [zoneMarkers, setZoneMarkers] = useState<ZoneMarker[]>([])
const [mapFlyTo, setMapFlyTo] = useState<{ lng: number; lat: number; zoom: number } | null>(null)
```

Pass to components:
```tsx
<MapView
  routes={mapRoutes}
  origin={mapOrigin}
  destination={mapDest}
  zoneMarkers={zoneMarkers}
  flyTo={mapFlyTo}
/>

<ZonePanel
  pendingLocations={pendingZoneLocations}
  onFlyTo={(lng, lat, zoom) => setMapFlyTo({ lng, lat, zoom })}
  onZoneMarkersUpdate={setZoneMarkers}
/>
```

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Mapbox Places returns 0 neighborhoods | Use only the searched city as one marker |
| `geocodeLocation()` returns null for a result | Skip that marker silently |
| Zone fetch fails | Panel shows error message, no map change |
| `flyTo` called before map is ready | Ignored safely (map ref null check) |
| Location already in ZoneCache | Served instantly, map still updates |

---

## Out of Scope

- Polygon boundary shapes (admin boundaries require Mapbox Boundaries paid tier)
- Zone history or animation between time periods
- Clicking a map marker to open the panel card
