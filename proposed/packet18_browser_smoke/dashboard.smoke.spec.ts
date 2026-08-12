/**
 * Browser smoke tests — Packet 18 §18.5: "Add browser smoke coverage for
 * feed failures, public denial, operator navigation, and module unavailable
 * states."
 *
 * STATUS AS OF 2026-08-12: written, NOT executed, NOT wired into any CI or
 * build step. See README.md in this folder before running or trusting this
 * file.
 *
 * Written in Playwright syntax because it's the most standard convention
 * for this kind of test, NOT because it's confirmed to match whatever the
 * project's existing "Packet/TypeScript suite: 45 tests across 12 suites"
 * (mentioned in Packet 18's baseline) actually uses — that suite was not
 * found anywhere in the local canonical project folder during this session,
 * so it may live elsewhere, or under different tooling. If it turns out to
 * use something other than Playwright, treat this file as a spec to port,
 * not a drop-in addition.
 */

import { test, expect } from '@playwright/test';

// Point this at a real running instance before running anything here.
// `.\start-northstar.ps1` starts one at http://localhost:4180 by default.
// DO NOT point this at the live northstarenergy.ca deployment — the
// "worker can still raise help" test below creates a real check-in record.
const BASE_URL = process.env.NORTHSTAR_SMOKE_BASE_URL ?? 'http://localhost:4180';

test.describe('operator navigation', () => {
  test('switching tabs shows exactly one active section', async ({ page }) => {
    await page.goto(`${BASE_URL}/northstar-clean.html`);
    await expect(page.locator('.section.active')).toHaveCount(1);

    await page.locator('[data-tab="flows"]').click();
    await expect(page.locator('#flows.section.active')).toBeVisible();
    await expect(page.locator('.section.active')).toHaveCount(1);
  });

  test('every declared nav tab has exactly one corresponding section', async ({ page }) => {
    await page.goto(`${BASE_URL}/northstar-clean.html`);
    const tabs = await page.locator('#sideNav button[data-tab]').all();
    expect(tabs.length).toBeGreaterThan(0);
    for (const tab of tabs) {
      const id = await tab.getAttribute('data-tab');
      await expect(page.locator(`#${id}.section`)).toHaveCount(1);
    }
  });
});

test.describe('module-unavailable states are explicit, not a misleading blank panel', () => {
  test('Flows shows a planned/offline message, not an empty placeholder', async ({ page }) => {
    // Regression test for the fix made in this same session: the Flows tab
    // used to render a bare "WATER MANAGEMENT / FLOWS" label with nothing
    // explaining why. It now says PLANNED and points at the scope decision.
    await page.goto(`${BASE_URL}/northstar-clean.html`);
    await page.locator('[data-tab="flows"]').click();
    const panel = page.locator('#flows .panel');
    await expect(panel).toContainText(/planned/i);
    await expect(panel).toContainText(/DECISION_LOG/);
  });

  test('Field Staff shows an explicit unavailable state, not a silently empty board, when the check-in feed fails', async ({ page }) => {
    await page.route('**/api/checkins*', (route) => route.fulfill({ status: 500, body: 'error' }));
    await page.goto(`${BASE_URL}/northstar-clean.html`);
    await expect(page.locator('#staffHeading')).toContainText(/FEED UNAVAILABLE/i);
    // This exact phrase matters: it's the safety caveat from
    // northstar-clean.html's staffUnavailable() — an empty board must never
    // read as "confirmed nobody is on site".
    await expect(page.locator('#staffGroups')).toContainText(/not confirmation that nobody is on site/i);
  });

  test('Weather shows retrying cards, not blank cards, when the weather feed fails', async ({ page }) => {
    await page.route('**/api/weather*', (route) => route.fulfill({ status: 500, body: 'error' }));
    await page.goto(`${BASE_URL}/northstar-clean.html`);
    await page.locator('[data-tab="weather"]').click();
    await expect(page.locator('.weather-unavailable').first()).toBeVisible();
    await expect(page.locator('.weather-unavailable').first()).toContainText(/FEED WAITING/i);
  });
});

test.describe('public-host denial (end-to-end smoke check, not a replacement for the Python suite)', () => {
  // tests/test_api_workflows.py already covers this exact behaviour at the
  // Python/unit level (test_forged_access_header_cannot_open_the_roster_on_the_public_host,
  // test_forged_access_header_cannot_clear_a_distress_call). Duplicating it
  // here is still worth having as an end-to-end check against a real running
  // server, not a substitute for that suite.
  //
  // CAVEAT NOT VERIFIED: this relies on Playwright's request client letting
  // a caller override the `Host` header. That is generally true for Node
  // HTTP clients (unlike a browser's own `fetch`, which blocks it), but this
  // has not been confirmed against this specific Playwright version. If
  // these two tests fail with something that looks like the Host override
  // was silently ignored, that's the first thing to check — not necessarily
  // a real regression in ieso_backend.py.

  test('roster read is refused when the request claims to arrive on the public check-in host, forged header or not', async ({ request }) => {
    const withoutHeader = await request.get(`${BASE_URL}/api/checkins`, {
      headers: { Host: 'checkin.northstarenergy.ca' },
    });
    expect(withoutHeader.status()).toBe(403);

    const withForgedHeader = await request.get(`${BASE_URL}/api/checkins`, {
      headers: { Host: 'checkin.northstarenergy.ca', 'Cf-Access-Jwt-Assertion': 'forged' },
    });
    expect(withForgedHeader.status()).toBe(403);
  });

  test('a worker can still raise help on the public check-in host (creates a real record — local/test server only)', async ({ request }) => {
    const created = await request.post(`${BASE_URL}/api/checkins`, {
      data: { name: 'Playwright Smoke Test Worker', site: 'Playwright Smoke Test Site' },
    });
    expect(created.ok()).toBeTruthy();
    const record = await created.json();

    const helpResponse = await request.post(`${BASE_URL}/api/checkins/${record.id}/help`, {
      headers: { Host: 'checkin.northstarenergy.ca' },
      data: { actor: 'worker' },
    });
    expect(helpResponse.status()).toBe(200);

    // Clearing that same alarm from the public host must still be refused —
    // this is the distress-call-clearing bug the 2026-08-11 audit found.
    const resolveResponse = await request.post(`${BASE_URL}/api/checkins/${record.id}/help/resolve`, {
      headers: { Host: 'checkin.northstarenergy.ca' },
      data: { actor: 'attacker' },
    });
    expect(resolveResponse.status()).toBe(403);
  });
});
