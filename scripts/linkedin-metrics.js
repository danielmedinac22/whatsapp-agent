/**
 * LinkedIn Metrics Scraper
 *
 * Logs into LinkedIn, navigates to the user's activity/posts page,
 * scrapes the last ~10 posts (content, date, likes, comments, reposts),
 * and saves results to:
 *   - data/metrics/YYYY-MM-DD.json  (today's snapshot)
 *   - data/metrics/all-metrics.json (cumulative, merged by post)
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// ── Config ────────────────────────────────────────────────────────────────────
const LINKEDIN_EMAIL = process.env.LINKEDIN_EMAIL;
const LINKEDIN_PASSWORD = process.env.LINKEDIN_PASSWORD;
const DATA_DIR = path.resolve(__dirname, "../data/metrics");
const ALL_METRICS_FILE = path.join(DATA_DIR, "all-metrics.json");
const MAX_POSTS = 10;

if (!LINKEDIN_EMAIL || !LINKEDIN_PASSWORD) {
  console.error(
    "❌  LINKEDIN_EMAIL and LINKEDIN_PASSWORD environment variables are required."
  );
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function todayDateString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Merge today's posts into the cumulative all-metrics store.
 * Posts are keyed by their LinkedIn post URL (or a content hash as fallback).
 */
function mergeMetrics(allMetrics, todayPosts, scrapeDate) {
  const updated = { ...allMetrics };
  for (const post of todayPosts) {
    const key = post.url || `${scrapeDate}__${post.content.slice(0, 60)}`;
    updated[key] = {
      ...(updated[key] || {}),
      ...post,
      lastScraped: scrapeDate,
    };
  }
  return updated;
}

// ── Parse a reaction/count string like "1,234" → 1234 ────────────────────────
function parseCount(text) {
  if (!text) return 0;
  const clean = text.replace(/[^\d]/g, "");
  return clean ? parseInt(clean, 10) : 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log("🚀 Starting LinkedIn metrics scraper…");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  try {
    // ── 1. Login ─────────────────────────────────────────────────────────────
    console.log("🔐 Navigating to LinkedIn login page…");
    await page.goto("https://www.linkedin.com/login", {
      waitUntil: "domcontentloaded",
    });

    // Fill email
    await page.waitForSelector("#username", { timeout: 15000 });
    await page.fill("#username", LINKEDIN_EMAIL);
    console.log("   ✔ Email filled");

    // Fill password
    await page.waitForSelector("#password", { timeout: 10000 });
    await page.fill("#password", LINKEDIN_PASSWORD);
    console.log("   ✔ Password filled");

    // Submit
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
      page.click('[data-litms-control-urn="login-submit"], button[type="submit"]'),
    ]);

    // Detect login failure (wrong credentials, captcha, checkpoint)
    const currentUrl = page.url();
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/checkpoint") ||
      currentUrl.includes("/authwall")
    ) {
      throw new Error(
        `Login failed or checkpoint triggered. Current URL: ${currentUrl}`
      );
    }
    console.log("   ✔ Logged in successfully");

    // ── 2. Navigate to user's posts/activity page ─────────────────────────────
    // Resolve profile URL first so we can build the activity link
    console.log("🔍 Resolving profile URL…");
    await page.goto("https://www.linkedin.com/in/me/", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    // LinkedIn redirects /in/me/ to the actual vanity URL
    const profileUrl = page.url().replace(/\/$/, "");
    console.log(`   Profile URL: ${profileUrl}`);

    const activityUrl = `${profileUrl}/recent-activity/all/`;
    console.log(`📋 Navigating to activity page: ${activityUrl}`);
    await page.goto(activityUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Give dynamic content a moment to load
    await page.waitForTimeout(3000);

    // Scroll down a couple of times to load more posts
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await page.waitForTimeout(1500);
    }

    // ── 3. Scrape posts ───────────────────────────────────────────────────────
    console.log("📊 Scraping posts…");

    const posts = await page.evaluate((maxPosts) => {
      const results = [];

      // LinkedIn renders feed items inside various container selectors;
      // we try a broad selector that covers most layouts.
      const feedItems = Array.from(
        document.querySelectorAll(
          [
            ".profile-creator-shared-feed-update__container",
            ".feed-shared-update-v2",
            '[data-urn*="activity"]',
          ].join(", ")
        )
      );

      for (const item of feedItems.slice(0, maxPosts)) {
        // ── Content text ──────────────────────────────────────────────────────
        const contentEl =
          item.querySelector(".feed-shared-update-v2__description") ||
          item.querySelector(".feed-shared-text") ||
          item.querySelector("[data-test-id='main-feed-activity-card__commentary']") ||
          item.querySelector(".attributed-text-segment-list__content");
        const content = contentEl ? contentEl.innerText.trim() : "";

        // ── Date / timestamp ──────────────────────────────────────────────────
        const timeEl =
          item.querySelector("time") ||
          item.querySelector(".feed-shared-actor__sub-description time") ||
          item.querySelector(".update-components-actor__sub-description time");
        const date =
          timeEl?.getAttribute("datetime") || timeEl?.innerText?.trim() || "";

        // ── Post URL ─────────────────────────────────────────────────────────
        const linkEl =
          item.querySelector(
            'a[href*="/feed/update/"], a[href*="activity-"]'
          ) ||
          item.querySelector(".feed-shared-update-v2__control-menu-trigger");
        const url = linkEl?.href || "";

        // ── Reaction / like count ─────────────────────────────────────────────
        const reactionsEl =
          item.querySelector(
            ".social-details-social-counts__reactions-count"
          ) ||
          item.querySelector(".social-details-social-counts__social-proof-text") ||
          item.querySelector('[data-test-id="social-actions__reaction-count"]') ||
          item.querySelector(".social-counts-reactions");
        const likesRaw = reactionsEl?.innerText?.trim() || "0";

        // ── Comments count ────────────────────────────────────────────────────
        const commentsEl =
          item.querySelector(
            "button.social-details-social-counts__comments"
          ) ||
          item.querySelector(
            '[data-test-id="social-actions__comments"]'
          ) ||
          item.querySelector(".social-details-social-counts__item--right-aligned");
        const commentsRaw = commentsEl?.innerText?.trim() || "0";

        // ── Reposts / shares count ────────────────────────────────────────────
        // LinkedIn doesn't always expose reposts publicly; we try anyway.
        const repostsEl =
          item.querySelector(
            ".social-details-social-counts__item--reposts"
          ) ||
          item.querySelector('[aria-label*="repost"]') ||
          item.querySelector('[aria-label*="share"]');
        const repostsRaw = repostsEl?.innerText?.trim() || "0";

        if (content || url) {
          results.push({
            content,
            date,
            url,
            likesRaw,
            commentsRaw,
            repostsRaw,
          });
        }
      }

      return results;
    }, MAX_POSTS);

    // Parse raw count strings into numbers
    const parsedPosts = posts.map((p) => ({
      content: p.content,
      date: p.date,
      url: p.url,
      likes: parseCount(p.likesRaw),
      comments: parseCount(p.commentsRaw),
      reposts: parseCount(p.repostsRaw),
    }));

    console.log(`   ✔ Found ${parsedPosts.length} posts`);

    // ── 4. Save results ───────────────────────────────────────────────────────
    const today = todayDateString();
    ensureDir(DATA_DIR);

    // Daily snapshot
    const dailyFile = path.join(DATA_DIR, `${today}.json`);
    const dailyPayload = { scrapeDate: today, posts: parsedPosts };
    saveJson(dailyFile, dailyPayload);
    console.log(`💾 Saved daily snapshot → ${dailyFile}`);

    // Cumulative all-metrics
    const allMetrics = loadJson(ALL_METRICS_FILE, {});
    const merged = mergeMetrics(allMetrics, parsedPosts, today);
    saveJson(ALL_METRICS_FILE, merged);
    console.log(`💾 Updated cumulative metrics → ${ALL_METRICS_FILE}`);

    console.log("✅ Done!");
  } catch (err) {
    console.error("❌ Scraper error:", err);
    // Take a screenshot for debugging when running in CI
    try {
      const screenshotPath = path.join(DATA_DIR, `error-${todayDateString()}.png`);
      ensureDir(DATA_DIR);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.error(`   Screenshot saved → ${screenshotPath}`);
    } catch {
      // Ignore screenshot errors
    }
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
