# LinkedIn Metrics – Setup & Usage Guide

Automated weekly scraping of your LinkedIn post metrics (impressions, reactions,
comments, shares) using Playwright.  Results are saved as JSON snapshots and
appended to a master CSV, with an optional step that writes the metrics back
into the frontmatter of matching markdown posts.

---

## 1. Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.11+ |
| pip | latest |
| Playwright | latest (`pip install playwright`) |

```bash
pip install playwright python-dotenv python-frontmatter
playwright install chromium
```

---

## 2. Add GitHub Secrets

The scraper reads credentials from environment variables.
To run via GitHub Actions you must add them as **Repository Secrets**:

1. Open your repository on GitHub.
2. Go to **Settings → Secrets and variables → Actions**.
3. Click **New repository secret** for each of the following:

| Secret name | Value |
|---|---|
| `LINKEDIN_EMAIL` | Your LinkedIn login e-mail address |
| `LINKEDIN_PASSWORD` | Your LinkedIn login password |

> **Tip:** If your account uses two-factor authentication (2FA), log in once
> manually from the same IP, complete the challenge, then re-run the workflow.
> LinkedIn typically remembers trusted devices/sessions for several weeks.

---

## 3. Run the Scraper Manually

### From your local machine

```bash
# Option A: export env vars inline
LINKEDIN_EMAIL="you@example.com" LINKEDIN_PASSWORD="s3cr3t" \
  python scripts/linkedin_metrics.py

# Option B: create a .env file (never commit this file!)
echo "LINKEDIN_EMAIL=you@example.com"    >> .env
echo "LINKEDIN_PASSWORD=s3cr3t"          >> .env
python scripts/linkedin_metrics.py
```

### Trigger the GitHub Actions workflow manually

1. Go to your repository → **Actions** tab.
2. Select **LinkedIn Metrics Scraper** in the left sidebar.
3. Click **Run workflow → Run workflow**.

---

## 4. What Data Gets Saved and Where

```
data/
└── metrics/
    ├── linkedin_metrics_2024-05-06.json   ← daily snapshot (one per run)
    ├── linkedin_metrics_2024-05-13.json
    └── all_metrics.csv                    ← master file (upserted each run)
```

### JSON snapshot (`linkedin_metrics_YYYY-MM-DD.json`)

One file per run.  Example structure:

```json
{
  "scraped_date": "2024-05-06",
  "posts": [
    {
      "scraped_date": "2024-05-06",
      "date_published": "2024-04-28",
      "post_url": "https://www.linkedin.com/posts/your-slug_activity-123",
      "impressions": 4200,
      "reactions": 87,
      "comments": 12,
      "shares": 5,
      "text_snippet": "First 120 characters of your post…"
    }
  ]
}
```

### Master CSV (`all_metrics.csv`)

All posts, de-duplicated by `post_url`.  New runs update existing rows in place
and append rows for newly discovered posts.

| Column | Description |
|---|---|
| `scraped_date` | Date of the most recent scrape for this post |
| `date_published` | When the post was originally published |
| `post_url` | Canonical LinkedIn URL (no query params) |
| `impressions` | Total views (requires Creator Mode) |
| `reactions` | Total emoji reactions |
| `comments` | Comment count |
| `shares` | Repost / share count |
| `text_snippet` | First 120 characters of post body |

---

## 5. Update Post Frontmatter (Optional)

If you keep blog / newsletter posts as markdown files in a `posts/` directory,
`update_post_metrics.py` will find the matching file and write the metrics into
its YAML frontmatter.

```bash
# Update all matched posts using the latest snapshot
python scripts/update_post_metrics.py

# Preview what would change without writing anything
python scripts/update_post_metrics.py --dry-run

# Point at a specific snapshot
python scripts/update_post_metrics.py --metrics-file data/metrics/linkedin_metrics_2024-05-06.json
```

Frontmatter keys written / updated:

```yaml
---
title: "My great post"
date: 2024-04-28
linkedin_url: https://www.linkedin.com/posts/…
linkedin_impressions: 4200
linkedin_reactions: 87
linkedin_comments: 12
linkedin_shares: 5
linkedin_scraped: 2024-05-06
---
```

---

## 6. Schedule (GitHub Actions)

The workflow (`.github/workflows/linkedin_metrics.yml`) runs automatically
**every Monday at 09:00 UTC**.  Edit the cron expression to change the schedule:

```yaml
on:
  schedule:
    - cron: "0 9 * * 1"   # Mon 09:00 UTC
```

After each successful run, new/updated data files are committed back to the
repository automatically by the `github-actions[bot]` user.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `LINKEDIN_EMAIL or LINKEDIN_PASSWORD not set` | Secrets missing | Add secrets (§ 2) |
| Script hangs on login / redirects to `/checkpoint` | 2FA or CAPTCHA triggered | Log in manually once from the same location, then retry |
| `0 posts found` | LinkedIn changed DOM selectors | Open an issue; selectors in `extract_posts()` may need updating |
| CSV grows unboundedly | By design — each post is keyed by URL | Delete `all_metrics.csv` and re-run to reset |
| `python-frontmatter not installed` | Missing dependency | `pip install python-frontmatter` |

---

## 8. Notes on LinkedIn's Terms of Service

Automated scraping of LinkedIn may violate their [User Agreement](https://www.linkedin.com/legal/user-agreement).
This tooling is intended for **personal analytics on your own content only**.
Use responsibly, keep request rates low, and do not resell or republish the data.
