import { test, expect } from "@playwright/test";
import { BasePage } from "../../pages/basePage.js";
import { activityFeed } from "../../selectors/copperSelectors.js";
import {
  parseActivityTimestamp,
  classifyActivityHeader,
} from "../../utils/activityParser.js";
import { fixtureUrl } from "./helpers.js";

/**
 * Feed extraction against fixtures mirroring the real Copper DOM, plus the
 * regression guard for the silent-failure hazard.
 *
 * These exercise the selectors and extraction directly rather than through
 * ActivityFeedPage, which navigates to a live app route.
 */
test.describe("activity feed extraction", () => {
  test("locates the feed container and its items", async ({ page }) => {
    await page.goto(fixtureUrl("activity-feed.html"));
    const bp = new BasePage(page);
    const container = await bp.resolve(activityFeed.list, { timeout: 1_000 });
    const items = activityFeed.item.primary(container);
    expect(await items.count()).toBe(3);
  });

  test("reads the ISO timestamp from the datetime attribute, not the rendered text", async ({ page }) => {
    await page.goto(fixtureUrl("activity-feed.html"));
    const bp = new BasePage(page);
    const container = await bp.resolve(activityFeed.list, { timeout: 1_000 });
    const first = activityFeed.item.primary(container).nth(0);

    const iso = await bp.attrOf(activityFeed.timestamp.primary(first), "datetime");
    const rendered = await bp.textOf(activityFeed.timestamp.primary(first));

    expect(parseActivityTimestamp(iso)).toBe("2026-07-24T21:30:39.000Z");
    // The visible text has no date and is locale-dependent — unusable alone.
    expect(rendered).toBe("2:30 PM");
    expect(parseActivityTimestamp(rendered)).toBeNull();
  });

  test("extracts actor and classifies type and channel", async ({ page }) => {
    await page.goto(fixtureUrl("activity-feed.html"));
    const bp = new BasePage(page);
    const container = await bp.resolve(activityFeed.list, { timeout: 1_000 });
    const items = activityFeed.item.primary(container);

    const header0 = await bp.textOf(activityFeed.header.primary(items.nth(0)));
    const actor0 = await bp.textOf(activityFeed.actorLink.primary(items.nth(0)));
    expect(actor0).toBe("You");
    const meta0 = classifyActivityHeader(header0, actor0);
    expect(meta0.type).toBe("phone_call");
    expect(meta0.channel).toBe("phone");
    expect(meta0.actorKind).toBe("self");

    // Second item's actor is the contact, not the rep.
    const actor1 = await bp.textOf(activityFeed.actorLink.primary(items.nth(1)));
    expect(actor1).toBe("Jim Halpert");
    const meta1 = classifyActivityHeader(
      await bp.textOf(activityFeed.header.primary(items.nth(1))),
      actor1,
    );
    expect(meta1.actorKind).toBe("other");
  });

  test("marks system entries so they are not read as buyer signal", async ({ page }) => {
    await page.goto(fixtureUrl("activity-feed.html"));
    const bp = new BasePage(page);
    const container = await bp.resolve(activityFeed.list, { timeout: 1_000 });
    const third = activityFeed.item.primary(container).nth(2);
    const meta = classifyActivityHeader(
      await bp.textOf(activityFeed.header.primary(third)),
      await bp.textOf(activityFeed.actorLink.primary(third)),
    );
    expect(meta.actorKind).toBe("system");
    expect(meta.type).toBe("record_created");
  });

  test("an empty feed still resolves its container (confirmed_empty)", async ({ page }) => {
    // An empty feed container renders with zero height, so it is attached but
    // NOT visible. Demanding visibility here would report a contact who simply
    // has no activity as a selector failure — the inverse of the hazard.
    await page.goto(fixtureUrl("activity-feed-empty.html"));
    const bp = new BasePage(page);
    const container = await bp.resolve(activityFeed.list, { timeout: 1_000, state: "attached" });
    expect(await activityFeed.item.primary(container).count()).toBe(0);
  });

  /**
   * THE REGRESSION GUARD. If this ever passes by returning an empty list
   * instead of throwing, the silent-failure hazard is back: every contact would
   * score Cold whenever Copper renames a class.
   */
  test("a broken feed selector THROWS rather than yielding an empty list", async ({ page }) => {
    await page.goto(fixtureUrl("activity-feed-broken.html"));
    const bp = new BasePage(page);
    await expect(
      bp.resolve(activityFeed.list, { timeout: 500, state: "attached" }),
    ).rejects.toThrow(/activity feed list/i);
  });
});
