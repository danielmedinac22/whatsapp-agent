/**
 * LinkedIn Metrics Scraper
 *
 * Logs into LinkedIn, navigates to the authenticated user's profile,
 * scrapes the last 10 posts, and saves results to:
 *   - data/metrics/YYYY-MM-DD.json  (today's snapshot)
 *   - data/metrics/all-metrics.json (running historical record)
 *
 * Required environment variables:
 *   LINKEDIN_EMAIL    — LinkedIn account email
 *   LINKEDIN_PASSWORD — LinkedIn account password
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[linkedin-metrics] ${new Date().toISOString()} — ${msg}`);
}

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log(`Created directory: ${dir}`);
  }
}

/**
 * Merge today's posts into the all-time metrics file.
 * Keyed by post URL so re-runs update rather than duplicate entries.
 */
function mergeIntoAllMetrics(allMetricsPath, todaysPosts) {
  let existing = {};

  if (fs.existsSync(allMetricsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(allMetricsPath, 'utf-8'));
    } catch (e) {
      log(`Warning: could not parse ${allMetricsPath}, starting fresh. (${e.message})`);
    }
  }

  for (const post of todaysPosts) {
    existing[post.url] = post;
  }

  fs.writeFileSync(allMetricsPath, JSON.stringify(existing, null, 2), 'utf-8');
  log(`all-metrics.json updated — total unique posts tracked: ${Object.keys(existing).length}`);
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

async function run() {
  const email = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;

  if (!email || !password) {
    console.error('[linkedin-metrics] ERROR: LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set.');
    process.exit(1);
  }

  const dataDir = path.resolve(__dirname, '..', 'data', 'metrics');
  ensureDir(dataDir);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await context.newPage();

  try {
    // ------------------------------------------------------------------
    // 1. Log in
    // ------------------------------------------------------------------
    log('Navigating to LinkedIn login page…');
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle' });

    log('Filling credentials…');
    await page.fill('#username', email);
    await page.fill('#password', password);
    await page.click('[data-litms-control-urn="login-submit"]');

    // Wait for the feed or security challenge
    await page.waitForURL(/linkedin\.com\/(feed|checkpoint)/, { timeout: 30_000 });

    if (page.url().includes('checkpoint')) {
      throw new Error(
        'LinkedIn triggered a security checkpoint. Manual intervention required.'
      );
    }

    log('Logged in successfully.');

    // ------------------------------------------------------------------
    // 2. Discover the authenticated user's profile URL
    // ------------------------------------------------------------------
    log('Fetching own profile URL…');
    await page.goto('https://www.linkedin.com/in/me/', { waitUntil: 'networkidle' });
    await page.waitForURL(/linkedin\.com\/in\/[^/]+\/?/, { timeout: 15_000 });

    const profileUrl = page.url().replace(/\/$/, '');
    log(`Profile URL: ${profileUrl}`);

    // ------------------------------------------------------------------
    // 3. Navigate to the "Recent Activity" / posts feed for this profile
    // ------------------------------------------------------------------
    const activityUrl = `${profileUrl}/recent-activity/all/`;
    log(`Navigating to activity feed: ${activityUrl}`);
    await page.goto(activityUrl, { waitUntil: 'networkidle' });

    // Scroll a couple of times to load more posts
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(2000);
    }

    // ------------------------------------------------------------------
    // 4. Scrape up to 10 posts
    // ------------------------------------------------------------------
    log('Scraping posts…');

    const posts = await page.evaluate(() => {
      /**
       * LinkedIn's activity feed uses different DOM structures over time.
       * We look for feed items generically and pull what we can.
       */
      const results = [];

      // Each activity item is wrapped in a <div> that contains a social-detail block
      const items = document.querySelectorAll(
        '.profile-creator-shared-feed-update__container, ' +
        '[data-urn*="activity"], ' +
        '.feed-shared-update-v2'
      );

      for (const item of Array.from(items).slice(0, 10)) {
        try {
          // Post text
          const textEl =
            item.querySelector('.feed-shared-update-v2__description') ||
            item.querySelector('.feed-shared-text') ||
            item.querySelector('.attributed-text-segment-list__content');
          const text = textEl ? textEl.innerText.trim() : '';

          // Likes / reactions
          const likesEl =
            item.querySelector('.social-details-social-counts__reactions-count') ||
            item.querySelector('[aria-label*="reaction"]') ||
            item.querySelector('.social-details-social-counts__count-value');
          const likesRaw = likesEl ? likesEl.innerText.trim() : '0';
          const likes = parseInt(likesRaw.replace(/[^0-9]/g, '') || '0', 10);

          // Comments
          const commentsEl =
            item.querySelector('.social-details-social-counts__comments') ||
            item.querySelector('[aria-label*="comment"]');
          const commentsRaw = commentsEl ? commentsEl.innerText.trim() : '0';
          const comments = parseInt(commentsRaw.replace(/[^0-9]/g, '') || '0', 10);

          // Date / timestamp
          const dateEl =
            item.querySelector('.feed-shared-actor__sub-description') ||
            item.querySelector('time') ||
            item.querySelector('.update-components-actor__sub-description');
          const date = dateEl ? (dateEl.getAttribute('datetime') || dateEl.innerText.trim()) : '';

          // Post URL
          const linkEl =
            item.querySelector('a[href*="/posts/"]') ||
            item.querySelector('a[href*="activity"]');
          const url = linkEl ? linkEl.href : window.location.href;

          results.push({ url, text, likes, comments, date, scrapedAt: new Date().toISOString() });
        } catch (_) {
          // Skip malformed items
        }
      }

      return results;
    });

    log(`Scraped ${posts.length} post(s).`);

    if (posts.length === 0) {
      log('Warning: No posts found. The page structure may have changed.');
    }

    // ------------------------------------------------------------------
    // 5. Persist results
    // ------------------------------------------------------------------
    const snapshot = {
      date: today(),
      profileUrl,
      scrapedAt: new Date().toISOString(),
      posts,
    };

    // Daily snapshot file
    const dailyPath = path.join(dataDir, `${today()}.json`);
    fs.writeFileSync(dailyPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    log(`Daily snapshot saved → ${dailyPath}`);

    // All-time merged file
    const allMetricsPath = path.join(dataDir, 'all-metrics.json');
    mergeIntoAllMetrics(allMetricsPath, posts);

    log('Done ✓');
  } catch (err) {
    console.error(`[linkedin-metrics] FATAL: ${err.message}`);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
