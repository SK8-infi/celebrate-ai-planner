# 🎉 Celebrate: AI planning assistant for celebrations

> **PromptWars · Challenge 5: Celebration & Event Planner**

Celebrate turns a few details about a wedding, birthday or community event into a complete,
personalised plan: a **budget split**, a **dated timeline**, a **vendor checklist** and **creative
ideas**. Google Gemini generates the plan, and the user can refine it through conversation.

## What it does

| Challenge need                        | How Celebrate delivers it                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Weddings, birthdays, community events | Event-aware planning: ceremonies and traditions for weddings, age and interests for birthdays, permits, volunteers and safety for community events, plus "other celebrations"   |
| Budgets                               | Gemini proposes a category split that suits the location and budget per guest. The server turns it into exact amounts that always add up to the total                           |
| Timelines                             | Tasks become real calendar dates counted back from the event. Late tasks are flagged **Do now**, and one click exports every date to Google, Outlook or Apple Calendar (`.ics`) |
| Vendor checklists                     | Prioritised bookings with book-by dates and "what to ask" tips. Ticking off vendors shows progress, which is saved in the browser                                               |
| Personalised ideas                    | Theme, décor, food and activity ideas drawn from the stated preferences, culture, season and location                                                                           |
| Iteration                             | **Refine with AI** revises the current plan from plain-language feedback such as "cut costs by 20%"                                                                             |
| Inclusion                             | Plans in six languages. Every plan considers guest accessibility (step-free access, seating, diets) and low-waste choices                                                       |

## How GenAI is used

1. **Structured generation:** `gemini-3.6-flash` returns JSON constrained by `responseJsonSchema`.
   That schema is generated from the same Zod schema that validates the response
   ([src/schemas.js](src/schemas.js)), so the contract and the validation can never drift apart.
2. **AI for judgement, code for arithmetic:** the model chooses categories, shares, tasks, lead
   times and ideas. Deterministic code ([src/plan.js](src/plan.js)) computes amounts (using the
   largest-remainder method) and calendar dates. The prompt states facts the model would otherwise
   have to derive, such as days remaining and budget per guest.
3. **Conversational refinement:** the client sends the current plan and the user's feedback. The
   server re-validates both, so the API stays stateless and scales horizontally.
4. **Guardrails:** a fixed system instruction, user data passed as JSON inside delimited tags with
   `<` and `>` escaped (so it cannot close a tag), schema-constrained output, strict validation, and
   a friendly message when Gemini blocks a prompt.
5. **Latency and resilience:** low thinking level and an LRU cache for identical prompts. If a
   model is overloaded, slow or returns an unusable plan, the planner moves on to the next model
   (`gemini-3.5-flash-lite` by default) instead of re-asking the busy one. Each attempt has a
   30-second deadline that Gemini also enforces, and requests are cancelled when the browser
   disconnects. Measured live: a plan takes about 6 seconds on `gemini-3.6-flash` and 4 seconds on
   Flash-Lite.

## Architecture

```mermaid
flowchart LR
  UI["Browser UI<br/>public/ (vanilla JS)"] -- "POST /api/plan" --> API["Hono app<br/>src/app.js"]
  API --> V["Zod validation<br/>src/schemas.js"]
  API --> P["Planner<br/>src/planner.js"]
  P --> C[("LRU cache")]
  P -- "structured output" --> G["Google Gemini<br/>@google/genai"]
  P --> M["Budget and date maths<br/>src/plan.js"]
```

```text
src/
  server.js      entry point: config, Gemini client, HTTP server, graceful shutdown
  app.js         routes, security headers, validation, error handling
  planner.js     Gemini call, response validation, caching, error mapping
  prompt.js      system instruction and prompt builder
  schemas.js     Zod schemas (request and AI response) and the Gemini JSON Schema
  plan.js        exact budget split and calendar scheduling
  rate-limit.js  per-client fixed-window rate limiter
  cache.js       LRU cache with expiry
  config.js      validated environment configuration
  dates.js       UTC calendar-day helpers
  errors.js      AppError with a user-safe message
public/          index.html, styles.css, js/ (main, app, render, ics)
test/            node:test suites: unit, integration, UI and accessibility
```

## Quick start

Requires Node.js 22.12 or later and a [Gemini API key](https://aistudio.google.com/apikey).

```bash
npm ci
cp .env.example .env    # then set GEMINI_API_KEY
npm run dev             # http://localhost:8080
```

| Script         | Purpose                                                                |
| -------------- | ---------------------------------------------------------------------- |
| `npm run dev`  | Start with auto-reload, loading `.env`                                 |
| `npm start`    | Start in production mode                                               |
| `npm test`     | Run all tests; fails unless every line, branch and function is covered |
| `npm run lint` | Biome lint and format check (`npm run format` applies fixes)           |

| Variable                       | Default                                  | Purpose                                                                                |
| ------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`               | (required)                               | Gemini API key                                                                         |
| `GEMINI_MODELS`                | `gemini-3.6-flash,gemini-3.5-flash-lite` | Models to try, in order (each must support structured output)                          |
| `PORT`                         | `8080`                                   | HTTP port                                                                              |
| `RATE_LIMIT_PER_MINUTE`        | `10`                                     | Plan requests allowed per client per minute                                            |
| `GLOBAL_RATE_LIMIT_PER_MINUTE` | `120`                                    | Plan requests allowed per minute across all clients (caps AI spending)                 |
| `TRUSTED_PROXIES`              | `0`                                      | Proxies that append to `X-Forwarded-For`: `1` on Cloud Run, `2` behind a load balancer |

## Testing

Runs on Node's built-in test runner with no network access or API key: Gemini is replaced by a
test double.

- **Unit:** schemas, budget and date maths, prompt building, cache, rate limiter, configuration.
- **Service:** planner behaviour for success, caching, model fallback, malformed or incomplete AI
  output, blocked prompts, timeouts, quota errors, outages and abandoned requests.
- **HTTP integration:** the real Hono app via `app.request()`, covering validation errors,
  405/413/415/429 responses, security headers, ETag revalidation, compression and path traversal.
- **UI:** the real `index.html` and frontend modules in jsdom, covering validation and focus
  management, error reporting, rendering, persistence (including bookings kept across
  refinements), refinement and calendar export.
- **Accessibility:** axe-core with every WCAG 2.0–2.2 A, AA and AAA rule plus best practices,
  run both before and after a plan renders, and tests for help text, abbreviations, link names
  and undo.

115 tests cover 100% of lines, branches and functions in both the server and the browser code.
`npm test` enforces this as a hard threshold, and CI also runs lint and `npm audit`.

## Security

Reported vulnerabilities are handled as described in [SECURITY.md](SECURITY.md).

- **Secrets:** the Gemini key stays on the server (in Secret Manager in production) and never
  reaches the browser or the logs.
- **Browser hardening:** a strict Content Security Policy (`default-src 'self'`, no inline script
  or style) with **Trusted Types enforced**; the UI builds DOM nodes with text only and never uses
  `innerHTML`. HSTS for two years, `frame-ancestors 'none'` and `X-Frame-Options: DENY`,
  `nosniff`, `no-referrer`, COOP/COEP/CORP and a restrictive Permissions-Policy.
- **Input validation:** strict Zod schemas reject unknown keys (including `__proto__`), check
  lengths, ranges and enums, and refuse control characters and bidirectional overrides. The API
  accepts JSON only (415) with a 64 KB body limit (413).
- **Cross-site requests:** the API refuses requests that browsers mark as coming from another site,
  answers no CORS preflights, and sends `Cache-Control: no-store`, so plans (personal data) are
  never cached.
- **AI safety:** user data reaches Gemini only inside delimited, escaped blocks; the output is
  schema-constrained, validated again before use, and rendered as text.
- **Abuse and cost:** per-client and global rate limits (429 with `Retry-After`) cap AI spending
  even when requests come from many addresses. The client address is taken from a configured
  number of trusted proxy hops, so it cannot be forged. All in-memory structures are bounded.
- **Static files** are served from an in-memory map of known files, so no request can reach the
  file system.
- **Errors:** clients get safe messages; details go to structured logs with a request ID.
- **Privacy:** there is no database. Plans live only in the user's browser.
- **Supply chain:** four runtime dependencies kept on patched releases, npm install scripts
  disabled, lockfile with verified registry signatures (`npm audit signatures` in CI), `npm audit`,
  CodeQL security analysis, Dependabot, CI actions and container base images pinned to digests,
  and a distroless, non-root container.

## Design

A neo-brutalist interface built entirely in [public/styles.css](public/styles.css), with no images
or web fonts: thick ink borders, hard offset shadows, flat bright colour blocks and chunky system
type with monospace accents.

- **One token set, two schemes.** Colours, lines and shadows are custom properties that flip for
  dark mode. Bright surfaces (yellow, pink, cyan, lime, violet) always carry dark ink, so they keep
  their contrast in both schemes.
- **Layout that explains itself.** On wide screens the form sits beside a board that previews what
  a plan contains, then becomes the plan: fact chips with a countdown, a colour-coded budget,
  dated timeline stickers, a tickable checklist and idea cards.
- **Accessible by construction.** Custom radios and checkboxes are real inputs styled with
  `appearance: none`. Decorative emoji are hidden from screen readers, rotations stay within a
  degree or two, and motion only runs when the user has not asked for reduced motion.

## Accessibility (WCAG 2.2 AAA)

Built and measured against Level AAA wherever it applies. There is no audio, video, time limit or
sign-in, so the criteria for those do not apply.

- **Perceivable:** text contrast of at least 7:1 and control edges and focus rings of at least 3:1,
  in light and dark schemes; status is never shown by colour alone. AI text is tagged with the
  plan's language. Lines stay under 80 characters with generous line and paragraph spacing, and
  the layout reflows at 320 px, at 200% text and with extra text spacing.
- **Operable:** everything works with a keyboard, with a skip link and a 3 px focus ring.
  Every pointer target is at least 44 × 44 px. Motion runs only when the user has not asked for
  reduced motion, and the loading spinner stops within five seconds. Section links read
  "Budget section" and so on, and the page title names the current plan.
- **Understandable:** every field has a visible label and help text, and errors are explained
  inline with focus moved to the first problem. Abbreviations (AI, PDF) are marked up and, with
  unusual words, explained in a glossary. Gemini is asked for plain language a 12-year-old can
  follow. Replacing a plan can always be undone, and starting over asks first.
- **Robust:** semantic landmarks and headings, native inputs (custom-styled with
  `appearance: none`), live regions for progress and errors, and support for
  `prefers-color-scheme`, `prefers-contrast`, `prefers-reduced-motion` and `forced-colors`.

## Efficiency

- **Static files from memory.** [src/assets.js](src/assets.js) reads `public/` once at startup and
  pre-compresses each file with Brotli (maximum quality) and gzip. Serving a file costs no disk
  access and no compression. Measured against the previous disk-and-compress setup, static
  responses are about 2× faster: twice the requests per second, half the latency.
- **Cache once, keep for a year.** Asset URLs carry a version derived from the file contents, so
  browsers cache them as `immutable`. A repeat visit makes a single request (the HTML, usually a
  304) instead of seven. Any change produces new URLs, so caches can never go stale.
- **Small payload.** No framework, build step, web fonts or images: the whole first visit is about
  13 KB with Brotli, with module preloading so the scripts download in parallel.
- **Fewer, faster AI calls.** Low thinking level, a 100-entry LRU cache with a one-hour expiry,
  fallback to a faster model instead of retrying an overloaded one, and cancellation of abandoned
  requests. API responses are gzip-compressed.
- **Lean in the browser.** Locale formatters are created once, the calendar export computes UTF-8
  lengths without allocating buffers, and events are handled by delegation.
- Stateless instances with bounded in-memory structures (cache, rate limiter, assets), so they
  scale out on Cloud Run.

## Deploy to Google Cloud Run

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com
printf '%s' "$GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=-
gcloud run deploy celebrate --source . --region asia-south1 --allow-unauthenticated \
  --max-instances 3 --set-secrets GEMINI_API_KEY=gemini-api-key:latest \
  --set-env-vars TRUSTED_PROXIES=1
```

The Cloud Run service account needs the `roles/secretmanager.secretAccessor` role on the secret.
`--max-instances` caps cost under load. If you put an external Application Load Balancer in front
of the service, set `TRUSTED_PROXIES=2`, since the balancer adds its own address.

## License

[MIT](LICENSE)
