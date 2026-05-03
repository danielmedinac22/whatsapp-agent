"""
linkedin_metrics.py
--------------------
Scrape post metrics from LinkedIn using Playwright (async API).

Metrics captured per post:
  - post_url       : canonical URL of the post
  - date_published : ISO-8601 date string extracted from the post
  - impressions    : view count (requires Creator Mode analytics)
  - reactions      : total emoji reactions
  - comments       : comment count
  - shares         : repost / share count
  - text_snippet   : first 120 chars of the post body (for matching)

Output:
  data/metrics/linkedin_metrics_YYYY-MM-DD.json   – today's snapshot
  data/metrics/all_metrics.csv                     – running master file

Environment variables required:
  LINKEDIN_EMAIL    – LinkedIn login e-mail
  LINKEDIN_PASSWORD – LinkedIn login password

Usage:
  pip install playwright python-dotenv
  playwright install chromium
  python scripts/linkedin_metrics.py
"""

import asyncio
import csv
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path

from playwright.async_api import async_playwright, TimeoutError as PWTimeoutError

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
LINKEDIN_EMAIL = os.environ.get("LINKEDIN_EMAIL", "")
LINKEDIN_PASSWORD = os.environ.get("LINKEDIN_PASSWORD", "")

OUTPUT_DIR = Path("data/metrics")
TODAY_STR = date.today().isoformat()          # e.g. 2024-05-01
SNAPSHOT_FILE = OUTPUT_DIR / f"linkedin_metrics_{TODAY_STR}.json"
MASTER_CSV = OUTPUT_DIR / "all_metrics.csv"

CSV_FIELDNAMES = [
    "scraped_date",
    "date_published",
    "post_url",
    "impressions",
    "reactions",
    "comments",
    "shares",
    "text_snippet",
]

# How long (ms) to wait for page elements before giving up
TIMEOUT_MS = 15_000

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def ensure_output_dir() -> None:
    """Create output directory if it doesn't exist."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def clean_number(raw: str) -> int:
    """
    Convert LinkedIn's formatted numbers to int.
    Examples: '1,234' -> 1234  |  '2.1K' -> 2100  |  '' -> 0
    """
    if not raw:
        return 0
    raw = raw.strip().replace(",", "").replace("\u00a0", "")
    try:
        if raw.lower().endswith("k"):
            return int(float(raw[:-1]) * 1_000)
        if raw.lower().endswith("m"):
            return int(float(raw[:-1]) * 1_000_000)
        return int(raw)
    except ValueError:
        return 0


def load_existing_csv() -> dict[str, dict]:
    """
    Load the master CSV into a dict keyed by post_url so we can upsert rows.
    Returns an empty dict if the file doesn't exist yet.
    """
    records: dict[str, dict] = {}
    if MASTER_CSV.exists():
        with MASTER_CSV.open(newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                records[row["post_url"]] = row
    return records


def save_master_csv(records: dict[str, dict]) -> None:
    """Write the full set of records back to the master CSV."""
    with MASTER_CSV.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_FIELDNAMES)
        writer.writeheader()
        writer.writerows(records.values())


# ---------------------------------------------------------------------------
# LinkedIn scraping
# ---------------------------------------------------------------------------

async def login(page) -> bool:
    """
    Navigate to LinkedIn and log in with email / password.
    Returns True on success, False if login failed or credentials are missing.
    """
    if not LINKEDIN_EMAIL or not LINKEDIN_PASSWORD:
        print("ERROR: LINKEDIN_EMAIL or LINKEDIN_PASSWORD env vars not set.", file=sys.stderr)
        return False

    print("→ Navigating to LinkedIn login page …")
    await page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded")

    # Fill credentials
    try:
        await page.fill('input[name="session_key"]', LINKEDIN_EMAIL, timeout=TIMEOUT_MS)
        await page.fill('input[name="session_password"]', LINKEDIN_PASSWORD, timeout=TIMEOUT_MS)
        await page.click('button[type="submit"]', timeout=TIMEOUT_MS)
    except PWTimeoutError:
        print("ERROR: Login form elements not found — LinkedIn layout may have changed.", file=sys.stderr)
        return False

    # Wait for redirect away from /login
    try:
        await page.wait_for_url(lambda url: "/login" not in url, timeout=20_000)
    except PWTimeoutError:
        # Could be a 2FA / CAPTCHA page — log a hint and bail out
        current = page.url
        if "checkpoint" in current or "challenge" in current:
            print(
                "WARNING: LinkedIn is asking for additional verification (2FA / CAPTCHA).\n"
                "  • Complete the challenge manually once, then re-run the script.\n"
                "  • Storing a valid auth cookie/storage-state can help avoid future challenges.",
                file=sys.stderr,
            )
        else:
            print(f"ERROR: Login did not complete. Current URL: {current}", file=sys.stderr)
        return False

    print(f"✓ Logged in successfully ({page.url})")
    return True


async def get_my_profile_slug(page) -> str:
    """
    Retrieve the current user's profile slug (vanity URL) from the /me redirect.
    Returns the slug string, e.g. 'john-doe-123'.
    """
    await page.goto("https://www.linkedin.com/in/me/", wait_until="domcontentloaded")
    # LinkedIn redirects /in/me/ to the actual profile URL
    await page.wait_for_url(lambda url: "/in/me" not in url, timeout=TIMEOUT_MS)
    # URL pattern: https://www.linkedin.com/in/<slug>/
    slug = page.url.rstrip("/").split("/in/")[-1]
    print(f"✓ Profile slug: {slug}")
    return slug


async def navigate_to_activity(page, slug: str) -> None:
    """Open the 'All activity' posts feed for the given profile slug."""
    activity_url = f"https://www.linkedin.com/in/{slug}/recent-activity/all/"
    print(f"→ Opening activity feed: {activity_url}")
    await page.goto(activity_url, wait_until="domcontentloaded")
    await page.wait_for_timeout(3_000)   # allow feed to hydrate


async def scroll_to_load_posts(page, max_scrolls: int = 10) -> None:
    """
    Scroll down the activity feed to trigger lazy-loading of older posts.
    Stops early if no new content appears after a scroll.
    """
    print(f"→ Scrolling feed (up to {max_scrolls} times) to load posts …")
    prev_height = await page.evaluate("document.body.scrollHeight")
    for i in range(max_scrolls):
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await page.wait_for_timeout(2_500)
        new_height = await page.evaluate("document.body.scrollHeight")
        if new_height == prev_height:
            print(f"  ↳ No more content after {i + 1} scroll(s).")
            break
        prev_height = new_height


async def extract_posts(page) -> list[dict]:
    """
    Parse post cards currently visible on the activity feed.

    LinkedIn's HTML structure changes regularly; this function targets the
    most stable selectors and falls back gracefully when elements are absent.
    """
    posts: list[dict] = []

    # Each activity item lives inside a container with this test-id
    # (verified as of early 2024 — adjust if LinkedIn updates the DOM)
    post_containers = await page.query_selector_all(
        'div[data-urn], '
        'li.profile-creator-shared-feed-update__container, '
        'div.feed-shared-update-v2'
    )

    print(f"  Found {len(post_containers)} post container(s) on the page.")

    for container in post_containers:
        try:
            record: dict = {
                "scraped_date": TODAY_STR,
                "date_published": "",
                "post_url": "",
                "impressions": 0,
                "reactions": 0,
                "comments": 0,
                "shares": 0,
                "text_snippet": "",
            }

            # --- Post URL --------------------------------------------------
            # Prefer the permalink anchor (contains /activity/ in its href)
            link_el = await container.query_selector('a[href*="/activity/"], a[href*="/posts/"]')
            if link_el:
                href = await link_el.get_attribute("href")
                if href:
                    record["post_url"] = href.split("?")[0]  # strip query params

            # Skip if we can't form a URL (likely not a real post card)
            if not record["post_url"]:
                continue

            # --- Date published --------------------------------------------
            time_el = await container.query_selector("time, span.feed-shared-actor__sub-description")
            if time_el:
                # <time datetime="2024-04-10T12:00:00.000Z"> is ideal
                dt_attr = await time_el.get_attribute("datetime")
                if dt_attr:
                    record["date_published"] = dt_attr[:10]  # keep YYYY-MM-DD
                else:
                    record["date_published"] = (await time_el.inner_text()).strip()

            # --- Post text snippet ----------------------------------------
            text_el = await container.query_selector(
                'span[dir="ltr"], '
                'div.feed-shared-update-v2__description, '
                'div.update-components-text'
            )
            if text_el:
                raw_text = (await text_el.inner_text()).strip()
                record["text_snippet"] = raw_text[:120]

            # --- Reactions -------------------------------------------------
            reaction_el = await container.query_selector(
                'span.social-details-social-counts__reactions-count, '
                'button[aria-label*="reaction"] span, '
                'li.social-details-social-counts__item--reactions span'
            )
            if reaction_el:
                record["reactions"] = clean_number(await reaction_el.inner_text())

            # --- Comments --------------------------------------------------
            comment_el = await container.query_selector(
                'button[aria-label*="comment"] span.social-details-social-counts__comments, '
                'li.social-details-social-counts__item--comments span, '
                'span[aria-label*="comment"]'
            )
            if comment_el:
                record["comments"] = clean_number(await comment_el.inner_text())

            # --- Shares / Reposts ------------------------------------------
            share_el = await container.query_selector(
                'button[aria-label*="repost"] span, '
                'li.social-details-social-counts__item--reposts span'
            )
            if share_el:
                record["shares"] = clean_number(await share_el.inner_text())

            # --- Impressions -----------------------------------------------
            # Impressions are only shown to post authors in Creator Mode;
            # they appear as a small "X impressions" label beneath the post.
            impressions_el = await container.query_selector(
                'span[aria-label*="impression"], '
                'a.feed-shared-statistics__impression-count, '
                'span.feed-shared-statistics-bar__impressions-count'
            )
            if impressions_el:
                record["impressions"] = clean_number(await impressions_el.inner_text())

            posts.append(record)

        except Exception as exc:  # noqa: BLE001
            # Log and continue — one broken card shouldn't abort the whole run
            print(f"  WARNING: Could not parse a post card: {exc}", file=sys.stderr)

    return posts


async def scrape_analytics_page(page, slug: str, posts: list[dict]) -> None:
    """
    Optional: open the Creator Analytics dashboard to backfill impressions
    for posts where we couldn't get the count from the feed.

    This page is only accessible if the account has Creator Mode enabled.
    Silently skips if the page is unavailable.
    """
    analytics_url = f"https://www.linkedin.com/analytics/creator/content/?profileUrn=urn%3Ali%3Afsi_profile%3A{slug}"
    print("→ Attempting to open Creator Analytics for impression data …")
    try:
        await page.goto(analytics_url, wait_until="domcontentloaded", timeout=20_000)
        await page.wait_for_timeout(3_000)

        # Check if analytics page actually loaded (non-creator accounts get redirected)
        if "analytics" not in page.url:
            print("  ↳ Creator Analytics not available for this account — skipping.")
            return

        print("  ↳ Creator Analytics page loaded. (Per-post impression parsing not yet implemented.)")
        # TODO: parse the analytics table rows and merge impression counts
        #       back into the `posts` list by matching URLs.

    except PWTimeoutError:
        print("  ↳ Analytics page timed out — skipping.", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001
        print(f"  ↳ Analytics page error: {exc}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def save_snapshot(posts: list[dict]) -> None:
    """Write today's posts to a dated JSON snapshot file."""
    with SNAPSHOT_FILE.open("w", encoding="utf-8") as fh:
        json.dump({"scraped_date": TODAY_STR, "posts": posts}, fh, indent=2, ensure_ascii=False)
    print(f"✓ Snapshot saved → {SNAPSHOT_FILE}")


def upsert_master_csv(posts: list[dict]) -> None:
    """
    Merge scraped posts into the master CSV.
    Existing rows (matched by post_url) are updated; new ones are appended.
    """
    existing = load_existing_csv()
    updated = 0
    added = 0
    for post in posts:
        url = post["post_url"]
        if url in existing:
            existing[url].update(post)
            updated += 1
        else:
            existing[url] = post
            added += 1
    save_master_csv(existing)
    print(f"✓ Master CSV updated → {MASTER_CSV}  ({added} added, {updated} updated)")


# ---------------------------------------------------------------------------
# Main entry-point
# ---------------------------------------------------------------------------

async def main() -> None:
    ensure_output_dir()

    async with async_playwright() as pw:
        # Launch Chromium in headless mode (set headless=False locally for debugging)
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="en-US",
        )
        page = await context.new_page()

        try:
            # 1. Login
            logged_in = await login(page)
            if not logged_in:
                sys.exit(1)

            # 2. Discover profile slug
            slug = await get_my_profile_slug(page)

            # 3. Open activity feed and scroll to load posts
            await navigate_to_activity(page, slug)
            await scroll_to_load_posts(page, max_scrolls=8)

            # 4. Extract post metrics from feed cards
            posts = await extract_posts(page)
            print(f"✓ Extracted metrics for {len(posts)} post(s).")

            if not posts:
                print("WARNING: No posts found. LinkedIn may have changed its DOM structure.", file=sys.stderr)

            # 5. Attempt to enrich with creator analytics (impressions)
            await scrape_analytics_page(page, slug, posts)

            # 6. Persist results
            save_snapshot(posts)
            upsert_master_csv(posts)

        except KeyboardInterrupt:
            print("\nInterrupted by user.")
        except Exception as exc:  # noqa: BLE001
            print(f"FATAL: {exc}", file=sys.stderr)
            raise
        finally:
            await browser.close()

    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
