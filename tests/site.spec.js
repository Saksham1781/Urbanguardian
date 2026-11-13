const { test, expect } = require("@playwright/test");

const BASE = "http://localhost:3001";
const BACKEND = "http://localhost:5000";
const AI = "http://localhost:8001";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Navigate to the map page reliably.
 *  Mapbox continuously loads tiles so "networkidle" never fires within 20s.
 *  We use "domcontentloaded" and then wait for the canvas to appear instead.
 */
async function gotoMap(page, timeout = 30000) {
  await page.goto(`${BASE}/map`, { waitUntil: "domcontentloaded", timeout });
  // Wait for Mapbox canvas — signals the map has initialised
  await page.locator("canvas").waitFor({ state: "visible", timeout });
}

// ── API health ─────────────────────────────────────────────────────────────
test("backend health endpoint returns ok", async ({ request }) => {
  const res = await request.get(`${BACKEND}/api/health`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
});

test("AI service health endpoint returns ok", async ({ request }) => {
  const res = await request.get(`${AI}/health`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
});

// ── Home page ──────────────────────────────────────────────────────────────
test("home page loads and shows hero text", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/urban guardians/i);

  // Hero heading
  await expect(page.locator("h1")).toContainText("AI-Powered Safety");

  // CTA button linking to /map
  const analyzeBtn = page.getByRole("link", { name: /analyze my route/i });
  await expect(analyzeBtn).toBeVisible();
  await expect(analyzeBtn).toHaveAttribute("href", "/map");
});

test("home page features section is present", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#features").scrollIntoViewIfNeeded();
  await expect(page.locator("#features")).toBeVisible();
  await expect(page.locator("#features")).toContainText("Route Analysis");
  await expect(page.locator("#features")).toContainText("Safety Scoring");
});

test("navbar is present on home page", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await expect(page.locator("nav, header")).toBeVisible();
});

// ── Map page ───────────────────────────────────────────────────────────────
test("map page loads without crashing", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await gotoMap(page);

  await expect(page.locator("body")).not.toContainText("404");
  await expect(page.locator("body")).not.toContainText("Internal Server Error");
});

test("Mapbox canvas renders on map page", async ({ page }) => {
  await gotoMap(page);
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15000 });
});

test("map page sentinel panel shows route cards", async ({ page }) => {
  await gotoMap(page);
  await expect(page.getByText(/route/i).first()).toBeVisible({ timeout: 10000 });
});

// ── Screenshot ─────────────────────────────────────────────────────────────
test("capture home page screenshot", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: "screenshots/playwright-home.png", fullPage: true });
});

test("capture map page screenshot", async ({ page }) => {
  await gotoMap(page);
  await page.waitForTimeout(3000); // let Mapbox finish loading tiles
  await page.screenshot({ path: "screenshots/playwright-map.png", fullPage: false });
});

test("SafeRoute AI panel opens when AI icon clicked", async ({ page }) => {
  await gotoMap(page);

  const aiBtn = page.locator('button[title="SafeRoute AI"]');
  await expect(aiBtn).toBeVisible({ timeout: 10000 });
  await aiBtn.click();

  await expect(page.getByRole("heading", { name: "SafeRoute AI" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByPlaceholder(/Origin/i)).toBeVisible();
  await expect(page.getByPlaceholder(/Destination/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Analyze Route/i })).toBeVisible();

  await page.screenshot({ path: "screenshots/playwright-ai-panel.png", fullPage: false });
});

test("SafeRoute AI analyzes a real route end-to-end", async ({ page }) => {
  test.setTimeout(120000); // geocoding + AI analysis + panel switch needs up to 2 min
  await gotoMap(page);

  await page.locator('button[title="SafeRoute AI"]').click();
  await expect(page.getByRole("heading", { name: "SafeRoute AI" })).toBeVisible({ timeout: 5000 });

  await page.getByPlaceholder(/Origin/i).fill("Greater Noida, India");
  await page.getByPlaceholder(/Destination/i).fill("Bulandshahr, India");

  await page.getByRole("button", { name: /Analyze Route/i }).click();

  // Wait for Sentinel Paths heading (AI analysis switches panels)
  await expect(page.getByRole("heading", { name: "Sentinel Paths" })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("RECOMMENDED").first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".pulse-dot").first()).toBeVisible();

  await page.screenshot({ path: "screenshots/playwright-ai-result.png", fullPage: false });
});

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

  // Wait for analysis to complete (panel switches to grid)
  await expect(page.getByRole("heading", { name: "Sentinel Paths" })).toBeVisible({ timeout: 90000 });

  // Switch to zone panel — it should auto-fill from routeAreas
  await page.locator('button[title="Zone Intel"]').click();
  await expect(page.getByRole("heading", { name: "Zone Intel" })).toBeVisible({ timeout: 5000 });

  // Wait for zone cards with RED ZONE / YELLOW ZONE / GREEN ZONE text
  await expect(
    page.locator("text=/RED ZONE|YELLOW ZONE|GREEN ZONE/").first()
  ).toBeVisible({ timeout: 60000 });

  await page.screenshot({ path: "screenshots/playwright-zone-result.png", fullPage: false });
});

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
