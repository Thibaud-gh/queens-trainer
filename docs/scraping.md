# Scraping the LinkedIn Queens archive

**Update:** a verified SVG importer now works against actual public pages and
does not need Playwright. Use [recent-history.md](recent-history.md). The
generic browser scraper below remains available but its earlier sandbox
limitations and dependency issues are historical notes.

`scripts/scrape-archive.ts` fills the gap between our last imported board
(#616, published 2026-01-06) and today by visiting a third-party archive site
and reading each board's colour-region layout straight off the rendered
page. It's meant to be run **locally, on your own machine** — see
[Important limitation](#important-limitation-this-sandbox-could-not-verify-the-real-site) below for why.

## Setup

```sh
npm install
npx playwright install chromium   # only needed if Playwright hasn't downloaded
                                   # a browser yet; skip if `npx playwright --version`
                                   # already reports a working install
```

The script imports `chromium` from the `playwright` package. If your
environment already has a Chromium build (e.g. at a fixed path used by CI),
point `PW_CHROMIUM` at its executable instead of downloading a second copy:

```sh
export PW_CHROMIUM=/path/to/chromium
```

## Running it

First, open the archive site once in a normal browser and look at a puzzle
page's URL. Most day-by-day archives use one of two shapes:

- **A listing page** that links to every puzzle (`--base` mode): the script
  loads it, scans every same-origin link for a puzzle number (`#617`,
  `/617`, `queens-617`, a publish date, …), and visits the ones in range.
- **A predictable URL per number** (`--url-template` mode): if the puzzle
  number appears directly in the URL (e.g. `/puzzle/617`), skip discovery
  entirely and template it.

```sh
# Discovery mode: find links to every puzzle from a listing page.
npm run scrape:archive -- --base https://www.archivedqueens.com --from 617 --to 860

# Direct mode: you already know the URL shape.
npm run scrape:archive -- \
  --url-template "https://www.archivedqueens.com/puzzle/{n}" \
  --from 617 --to 860

# A second archive, if the first is missing some days:
npm run scrape:archive -- --base https://linkedinzip.solutions/archive/queens/ --from 617 --to 860
```

Useful flags (`npm run scrape:archive -- --help` prints the full list):

- `--only-missing` (**default: on**) — skip any puzzle number already present
  in the output file, so re-running the script after a previous partial run
  (or after transcribing failures by hand) only fetches what's still
  missing. Pass `--no-only-missing` to re-fetch and overwrite numbers you
  already have.
- `--shots <dir>` — where screenshots are saved, one PNG per visited page
  (`li-<n>.png`), default `scripts/shots`. These are your evidence trail:
  every accepted board *and* every failure gets one.
- `--headless false` — watch the browser while it works, useful the first
  time you point this at a new site to sanity-check what it's finding.
- `--delay-ms 800` (default) — a polite pause between page visits. Raise it
  if the site rate-limits you.
- `--list-selector <css>` — narrow link discovery to a specific container
  (e.g. `--list-selector ".archive-list a"`) if the page has a lot of
  unrelated links.

The script never touches the network beyond the pages it's told to visit,
and never runs `playwright install` itself.

## How extraction works

Rather than hard-coding CSS selectors for one specific site's markup (which
breaks the moment the site redesigns), the script tries a few generic
"sources of truth" on each page, in order, and uses whichever one it finds:

1. **Embedded JSON** — a `<script>` tag containing an N×N array of region
   labels (a common pattern for React/Next.js sites that hydrate from
   server-rendered state).
2. **`data-*` attributes** — cells marked up with `data-region`,
   `data-color`, or `data-cell`.
3. **Colour geometry** (the fallback, and the one most likely to fire on an
   unknown site) — it looks for the largest group of same-sized leaf
   elements with a solid background colour, checks that they tile into a
   clean N×N grid (4 ≤ N ≤ 16), and requires exactly N distinct colours —
   one per region.

Whatever it finds is then independently re-validated in Node before being
trusted: `validateRegions` (square board, exactly N connected regions) and
`countSolutions(puzzle, 2) === 1` (a legal Queens puzzle has exactly one
solution). Only boards that pass both, and whose layout isn't a duplicate of
one we already have (checked via `symmetricCanonicalKey`, which ignores
rotation/reflection and region relabelling), are merged into
`src/data/linkedin-puzzles.json`.

## When a page fails

A page can fail for reasons the heuristics can't recover from — a
JavaScript-rendered canvas/SVG board with no DOM grid at all, an unusual
colour scheme, a genuinely ambiguous or malformed board, or a site quirk. In
that case:

1. The script logs the number, URL, and reason at the end (`Failed pages:
   …`) and leaves that puzzle out of the JSON.
2. The screenshot it took right before extraction (`scripts/shots/li-<n>.png`
   by default) is kept, so you have a picture of the actual board.
3. Transcribe it by hand using the in-app Editor (build the region grid by
   eye from the screenshot), or, if you prefer working in a text file, write
   the grid as a simple text/character grid and run:

   ```sh
   npm run import:text -- path/to/transcribed-puzzle.txt
   ```

   (see that script's own `--help` for the exact text format).

Because `--only-missing` is on by default, re-running `scrape:archive` later
won't re-attempt numbers you've already transcribed by hand and merged in —
only genuinely missing ones.

## Important limitation: this sandbox could not verify the real site

This scraper was built and tested entirely against a local fixture site
(`scripts/fixtures/fake-archive/`, served by the test's own tiny HTTP
server) — **both `archivedqueens.com` and `linkedinzip.solutions` are
blocked by this sandbox's network policy** (`net::ERR_TUNNEL_CONNECTION_FAILED`),
so their real markup was never observed. There is no site-specific
selector to get wrong here because none was written: the colour-geometry
heuristic in §"How extraction works" is the intended path for reading an
unfamiliar site, and it's exactly what the test exercises. When you run this
for real:

- Start with a handful of numbers and `--headless false` to watch it work
  and check the accepted boards' colours/date match what you see on-screen.
- If extraction fails on every page, try `--headless false` and look at
  what's actually rendered — a site that draws the board in `<canvas>` or
  SVG rather than styled `<div>`s won't have a DOM colour-grid to find at
  all, and would need a bespoke reader (not attempted here).
- Screenshots are your safety net either way: nothing is written to
  `src/data/linkedin-puzzles.json` without passing `validateRegions` and
  `countSolutions(puzzle, 2) === 1` first.
