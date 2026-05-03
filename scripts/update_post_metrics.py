"""
update_post_metrics.py
-----------------------
Helper script that reads the latest LinkedIn metrics snapshot and attempts to
match each scraped post to a markdown file in the `posts/` folder.  When a
match is found, the YAML frontmatter of the markdown file is updated (or
created) with the latest metrics.

Matching strategy (applied in order, first match wins):
  1. Exact date match  — frontmatter `date` == post's `date_published`
  2. Keyword match     — post `text_snippet` words appear in the filename
                         or frontmatter `title`

Frontmatter keys written / updated:
  linkedin_url         : canonical post URL
  linkedin_impressions : view count
  linkedin_reactions   : reaction count
  linkedin_comments    : comment count
  linkedin_shares      : share count
  linkedin_scraped     : ISO date of last scrape

Usage:
  python scripts/update_post_metrics.py [--metrics-file path/to/file.json]

Requirements:
  pip install python-frontmatter
"""

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import frontmatter          # python-frontmatter
except ImportError:
    print(
        "ERROR: 'python-frontmatter' is not installed.\n"
        "  Run: pip install python-frontmatter",
        file=sys.stderr,
    )
    sys.exit(1)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
METRICS_DIR = Path("data/metrics")
POSTS_DIR = Path("posts")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def find_latest_snapshot() -> Path | None:
    """Return the most-recently-modified metrics JSON in data/metrics/."""
    snapshots = sorted(
        METRICS_DIR.glob("linkedin_metrics_*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return snapshots[0] if snapshots else None


def load_metrics(path: Path) -> list[dict]:
    """Load and return the list of posts from a metrics JSON snapshot."""
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    return data.get("posts", [])


def collect_markdown_files() -> list[Path]:
    """Collect all .md and .mdx files under the posts/ directory."""
    if not POSTS_DIR.exists():
        return []
    return list(POSTS_DIR.rglob("*.md")) + list(POSTS_DIR.rglob("*.mdx"))


def normalise(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace — for fuzzy matching."""
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def keyword_overlap(snippet: str, candidate: str, min_matches: int = 3) -> bool:
    """
    Return True if at least `min_matches` significant words from `snippet`
    appear in `candidate`.

    'Significant' means longer than 3 characters (skips stop-words like
    'the', 'and', 'for' etc. without needing an NLP library).
    """
    snippet_words = {w for w in normalise(snippet).split() if len(w) > 3}
    candidate_norm = normalise(candidate)
    if not snippet_words:
        return False
    matches = sum(1 for w in snippet_words if w in candidate_norm)
    return matches >= min_matches


def find_matching_post(
    post: dict,
    md_files: list[Path],
) -> Path | None:
    """
    Try to find the markdown file that corresponds to this LinkedIn post.

    Returns the first matching Path, or None if no match is found.
    """
    date_published = post.get("date_published", "")[:10]  # YYYY-MM-DD
    snippet = post.get("text_snippet", "")

    for md_path in md_files:
        try:
            fm = frontmatter.load(str(md_path))
        except Exception as exc:  # noqa: BLE001
            print(f"  WARNING: could not parse frontmatter in {md_path}: {exc}", file=sys.stderr)
            continue

        # --- Strategy 1: date match ----------------------------------------
        fm_date = str(fm.get("date", ""))[:10]
        if date_published and fm_date == date_published:
            return md_path

        # --- Strategy 2: keyword overlap -----------------------------------
        fm_title = str(fm.get("title", ""))
        # Compare snippet against both the frontmatter title and the file stem
        candidate_text = f"{fm_title} {md_path.stem}"
        if snippet and keyword_overlap(snippet, candidate_text):
            return md_path

    return None


def update_frontmatter(md_path: Path, post: dict, dry_run: bool = False) -> bool:
    """
    Write LinkedIn metrics into the frontmatter of the given markdown file.

    Returns True if the file was modified (or would be in dry-run mode).
    """
    try:
        doc = frontmatter.load(str(md_path))
    except Exception as exc:  # noqa: BLE001
        print(f"  ERROR: could not load {md_path}: {exc}", file=sys.stderr)
        return False

    # Build the metrics block to write
    new_keys = {
        "linkedin_url": post.get("post_url", ""),
        "linkedin_impressions": post.get("impressions", 0),
        "linkedin_reactions": post.get("reactions", 0),
        "linkedin_comments": post.get("comments", 0),
        "linkedin_shares": post.get("shares", 0),
        "linkedin_scraped": post.get("scraped_date", ""),
    }

    # Detect whether anything actually changed
    changed = any(doc.get(k) != v for k, v in new_keys.items())
    if not changed:
        print(f"  → {md_path.name}: no changes needed.")
        return False

    if dry_run:
        print(f"  [DRY RUN] Would update {md_path.name} with: {new_keys}")
        return True

    doc.metadata.update(new_keys)

    try:
        updated_content = frontmatter.dumps(doc)
        md_path.write_text(updated_content, encoding="utf-8")
        print(f"  ✓ Updated {md_path}")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  ERROR: could not write {md_path}: {exc}", file=sys.stderr)
        return False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Update post frontmatter with LinkedIn metrics.")
    parser.add_argument(
        "--metrics-file",
        metavar="PATH",
        help="Path to a specific metrics JSON file (default: latest in data/metrics/)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would change without modifying any files.",
    )
    args = parser.parse_args()

    # --- Locate metrics file -----------------------------------------------
    if args.metrics_file:
        metrics_path = Path(args.metrics_file)
        if not metrics_path.exists():
            print(f"ERROR: specified metrics file not found: {metrics_path}", file=sys.stderr)
            sys.exit(1)
    else:
        metrics_path = find_latest_snapshot()
        if metrics_path is None:
            print(
                "ERROR: No metrics snapshot found in data/metrics/.\n"
                "  Run linkedin_metrics.py first, or pass --metrics-file.",
                file=sys.stderr,
            )
            sys.exit(1)

    print(f"→ Using metrics file: {metrics_path}")
    posts = load_metrics(metrics_path)
    print(f"  {len(posts)} post(s) loaded.")

    # --- Collect markdown files --------------------------------------------
    md_files = collect_markdown_files()
    if not md_files:
        print(f"WARNING: No markdown files found in '{POSTS_DIR}/'. Nothing to update.")
        return
    print(f"→ {len(md_files)} markdown file(s) found in '{POSTS_DIR}/'.")

    # --- Match and update --------------------------------------------------
    matched = 0
    unmatched = 0

    for post in posts:
        url = post.get("post_url", "(no url)")
        md_path = find_matching_post(post, md_files)

        if md_path:
            print(f"\nPost: {url}")
            print(f"  Matched → {md_path}")
            update_frontmatter(md_path, post, dry_run=args.dry_run)
            matched += 1
        else:
            snippet_preview = post.get("text_snippet", "")[:60]
            print(f"  (no match) {snippet_preview!r}")
            unmatched += 1

    print(f"\nSummary: {matched} matched, {unmatched} unmatched out of {len(posts)} post(s).")


if __name__ == "__main__":
    main()
