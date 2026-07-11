# Claude Keeper — Promotion Kit

Ready-to-post copy for launching Claude Keeper across dev communities.

**Canonical link (use everywhere):** <https://aicodedoctor.github.io/claude-keeper/>
**Tagline:** *Never babysit a usage limit again.*

**Demo assets** (in `docs/assets/`, regenerate with `npm run demo` + the raster pipeline):
- `demo.svg` — animated, for GitHub README / the site (animates as an embedded `<img>`).
- `demo.gif` — animated raster (760×470, ~0.5 MB) for platforms that reject SVG: **Dev.to, Reddit, Discord, Product Hunt, X**.
- `demo.png` — single hero still (end state) for **Dev.to cover images** and OpenGraph.

**One honest framing to keep in every post:** Claude Keeper does **not** bypass or
game usage limits and never touches the Anthropic API. It waits for the *legitimate*
reset and types `continue` for you — exactly what you'd do by hand. That honesty is
the differentiator against sketchy "limit bypass" scripts and keeps you on the right
side of Anthropic's ToS.

---

## Launch order (recommended)

1. **Record a demo GIF first** (see storyboard below). This tool is visual; text undersells it.
2. **Day 1, Tue–Thu ~8–10am ET:** post Show HN + r/ClaudeAI the same morning. Reply to every comment fast.
3. **Day 1–2:** X/Twitter thread, Anthropic Discord showcase.
4. **Day 2–3:** publish the Dev.to article (evergreen SEO).
5. **After a few GitHub stars:** Product Hunt.

---

## 1. Show HN (Hacker News)

**Title:** `Show HN: Claude Keeper – auto-resume Claude Code after a usage-limit reset`

> I kept losing long Claude Code runs to the Pro-plan usage limits — I'd hit the
> 5-hour or weekly cap, walk away, and come back hours later to a session that had
> been idle the whole time because nobody typed "continue" at the reset.
>
> Claude Keeper hosts the `claude` CLI inside an embedded terminal (real PTY — ConPTY
> on Windows, forkpty on macOS/Linux), watches the output for the limit message,
> parses the reset time (timezone-aware), waits until reset + a 1-minute safety
> buffer, then types `continue` + Enter into the still-open session. If the CLI died
> or the app restarted mid-wait, it relaunches `claude --continue` first. It survives
> app restart and laptop sleep because the wait state is persisted to disk.
>
> To be clear about what it is NOT: it does not bypass limits, patch anything, or
> touch the Anthropic API. It only reads terminal output and waits for the legitimate
> reset — exactly what you'd do by hand.
>
> Stack: Electron + xterm.js, core state machine kept Electron-free and pure so the
> whole thing is unit-tested against a deterministic mock CLI (no real `claude` needed
> to run the suite). MIT. Signed builds for Win/macOS/Linux.
>
> https://aicodedoctor.github.io/claude-keeper/
>
> Happy to answer questions on the detection heuristics — matching the limit message
> robustly across Claude's build-to-build wording/glyph changes was the fiddliest part.

*Post Tue–Thu, ~8–10am ET. The "what it is NOT" paragraph pre-empts the top comment.*

---

## 2. Reddit — r/ClaudeAI (cross-post to r/ClaudeCode)

**Title:** `I built a free tool that auto-resumes Claude Code after you hit a usage limit — no more babysitting the reset timer`

> You know the drill: you're deep in a long Claude Code session, you hit the 5-hour or
> weekly limit, and the work just... stops. Reset is in 3 hours. You either sit there
> watching a clock or you forget and lose the evening.
>
> **Claude Keeper** is a small desktop app that fixes exactly this. It runs the
> `claude` CLI inside its own terminal, notices when you've hit the limit, reads the
> reset time, waits it out (+ a 1-min safety buffer), and then types `continue` for
> you into the same session. Restart your laptop or let it sleep mid-wait — it picks
> right back up.
>
> A few things I want to be upfront about:
> - It does **not** bypass or game the limits. It waits for the real reset. It never touches the API.
> - Works on Windows, macOS, and Linux.
> - Free and open source (MIT). Signed installers.
> - Everything's configurable: the resume prompt, safety buffer, detection patterns, working dir.
>
> Site + installers + source: https://aicodedoctor.github.io/claude-keeper/
>
> Would love feedback from anyone running long agentic sessions — especially edge
> cases in the limit-message wording, since Anthropic tweaks it between builds.

*r/ClaudeAI allows free/OSS self-promo if you're transparent and engage. Lead with the pain. Don't make it link-only.*

---

## 3. X / Twitter thread

> 1/ Lost another Claude Code run to the usage limit while you were away? I built a
> free tool so you never babysit the reset timer again. 🧵
>
> 2/ Claude Keeper hosts the `claude` CLI in an embedded terminal, detects when you
> hit the 5h/weekly/session cap, and reads the reset time straight from the output.
>
> 3/ It waits for the *real* reset (+ a 1-min buffer), then types `continue` back into
> the live session. Restart or sleep your laptop mid-wait — it resumes anyway (state's on disk).
>
> 4/ Important: it does NOT bypass limits or touch the API. It just automates the
> wait-and-continue you'd do by hand. Waiting for the legitimate reset, nothing sketchy.
>
> 5/ Free, MIT, signed builds for Windows/macOS/Linux. Built on Electron + xterm.js,
> fully unit-tested against a mock CLI.
>
> ⭐ https://aicodedoctor.github.io/claude-keeper/

---

## 4. Anthropic Discord — #showcase / community channel

> Sharing a little OSS thing I built to scratch my own itch 👇
>
> **Claude Keeper** — a desktop app that hosts Claude Code in an embedded terminal and
> auto-resumes your session after a usage limit resets. Hit the 5h/weekly cap, walk
> away, and it types `continue` for you at the reset (+ a 1-min buffer). Survives
> laptop sleep and app restart.
>
> It just waits for the legitimate reset — no API calls, no limit bypassing. Free, MIT,
> Win/Mac/Linux. Would love feedback from anyone running long agentic sessions!
>
> https://aicodedoctor.github.io/claude-keeper/

---

## 5. Product Hunt

**Name:** Claude Keeper
**Tagline (60 char max):** `Never babysit a Claude Code usage limit again`
**First comment (maker):**

> Hey PH 👋 I built Claude Keeper because I kept losing long Claude Code sessions to
> the usage limits — I'd hit the cap, step away, and lose hours because nobody typed
> "continue" when the limit reset.
>
> It hosts the Claude CLI in an embedded terminal, detects the limit, waits for the
> real reset, and auto-resumes the session for you. It survives sleep and restarts,
> and it never bypasses limits or touches the API — it just automates the wait.
>
> Free and open source (MIT), signed builds for all three platforms. Happy to answer
> anything!

*Assets needed: logo (have it: `site/assets/logo.svg`), 3–5 screenshots, the demo GIF, one-line gallery captions.*

---

## 6. Full Dev.to / Hashnode article

**Title:** `Stop babysitting Claude Code usage limits: how I auto-resume long sessions`
**Tags:** `#ai #opensource #productivity #electron`
**Cover image:** upload `docs/assets/demo.png` (Dev.to covers must be static).
**In-article demo:** upload `docs/assets/demo.gif` right under the intro (Dev.to
does not accept SVG uploads — use the GIF, not `demo.svg`).

---

The best part of Claude Code is handing it a big task and letting it grind. The worst
part is what happens three hours in, when you're not looking: you hit the Pro-plan
usage limit, the session stops, and it just... sits there. The limit reset an hour
ago, but nobody typed `continue`, so the work never resumed. Your evening is gone.

I got tired of babysitting that reset timer, so I built **Claude Keeper** — a small
cross-platform desktop app that does the waiting and the resuming for me.

### What it actually does

Claude Keeper runs the real `claude` CLI inside an embedded terminal and watches it:

1. **Hosts the CLI in a real PTY** — ConPTY on Windows, `forkpty` on macOS/Linux — via
   [xterm.js](https://xtermjs.org/). It's a real interactive terminal, not a wrapper
   that reinterprets your commands.
2. **Detects the limit message** — the 5-hour rolling cap, the weekly cap, and the
   newer per-session phrasing.
3. **Parses the reset time**, timezone-aware, and falls back to interval polling if the
   wording is unfamiliar.
4. **Waits** — the session stays open exactly as it was, with a live countdown, until
   the reset time *plus* a safety buffer (default 60s, configurable).
5. **Auto-resumes** by typing your resume prompt (default `continue`) + Enter into the
   live session. If the CLI died or the app restarted mid-wait, it relaunches
   `claude --continue` first.
6. **Verifies the resume took**, retrying with backoff if the limit message comes back.

Crucially, it survives **app restart and laptop sleep** mid-wait, because the wait
state is persisted to disk. Close the lid, come back tomorrow, and it still resumes at
the right time.

### What it deliberately does NOT do

It does **not** bypass limits, patch the CLI, or touch the Anthropic API. It only reads
terminal output and waits for the legitimate reset — exactly what you'd do by hand,
minus the babysitting. That constraint was a design goal, not an afterthought.

### The fiddliest part: detecting the limit robustly

You'd think matching "you hit a limit" would be a one-line regex. It isn't, because
Anthropic tweaks the exact wording — and even the apostrophe glyphs and spacing —
between builds. Claude Keeper matches the known phrasings explicitly, but also keeps an
**encoding-robust backstop**: any line where the words *"limit"* and *"reset"* co-occur
within the same sentence (or two consecutive sentences) counts as a hit. Detection
patterns are configurable and apply live to a running session, so if Anthropic ships
new wording tomorrow, you can add a pattern without rebuilding.

### Architecture, briefly

The core logic is kept **Electron-free and pure** in `src/core/` — a `SessionController`
state machine, `LimitDetector`, `ResetTimeParser`, and `ResumeScheduler`. That means the
whole thing is unit-tested against a deterministic mock CLI; you don't need the real
`claude` binary (or an actual usage limit!) to run the suite. Electron just supplies the
PTY host, settings store, and disk-backed wait store around that core.

### Try it

Free, MIT-licensed, with signed installers for Windows, macOS, and Linux:

👉 **https://aicodedoctor.github.io/claude-keeper/**

If you run long agentic sessions, I'd love feedback — especially edge cases in the
limit-message wording across different Claude Code builds.

---

## Demo GIF storyboard (record this before launch)

Keep it under ~15 seconds, looping. Terminal + status bar visible the whole time.

1. **(0–3s)** A Claude Code session mid-task, actively working.
2. **(3–5s)** The usage-limit message appears in the terminal.
3. **(5–8s)** Claude Keeper's status bar flips to **Waiting** with a live countdown to
   reset. (Optionally speed-ramp / cut the long wait.)
4. **(8–11s)** Countdown hits zero → status shows **Resuming** → `continue` is typed
   into the session automatically.
5. **(11–15s)** Claude Code picks the task back up. End on the tagline overlay:
   *"Never babysit a usage limit again."*

**Recording tips:** use a clean terminal theme, hide personal paths, record at 2x and
trim the wait, export at a small size (< 5 MB so it inline-plays on GitHub/Reddit).
Tools: macOS `Cmd+Shift+5` → convert to GIF with `gifski`, or Kap / LICEcap.

---

## Product Hunt gallery captions (3–5 screenshots)

Order matters — the first image is the thumbnail. Pair each with a short caption.

1. **Hero / demo GIF** — *"Hit the limit, walk away — Claude Keeper resumes your session at the reset."*
2. **Waiting state with live countdown** — *"A live countdown to the real reset time, timezone-aware, right in the status bar."*
3. **The resume moment** — *"At reset + a safety buffer, it types `continue` back into the still-open session."*
4. **Settings panel** — *"Configure the resume prompt, safety buffer, working dir, and custom limit-detection patterns."*
5. **Cross-platform** — *"Signed installers for Windows, macOS, and Linux. Free and open source (MIT)."*

---

## Launch checklist

- [ ] Demo GIF recorded and added to `README.md` (top, above the fold) and the site.
- [ ] 3–5 clean screenshots (main terminal, waiting/countdown, settings, resume moment).
- [ ] README has a one-line "what it is / what it is NOT" near the top.
- [ ] A tagged release (`v1.0.0-beta` → consider `v1.0.0`) with installers + `SHA256SUMS.txt`.
- [ ] Show HN posted Tue–Thu morning ET; author available to reply for 2–3 hours.
- [ ] r/ClaudeAI + r/ClaudeCode posted same morning.
- [ ] X thread posted; pin it.
- [ ] Anthropic Discord showcase post.
- [ ] Dev.to article published, cross-posted to Hashnode.
- [ ] Product Hunt queued for after first stars land.
- [ ] Respond to every comment/issue within the first 24h — engagement drives ranking everywhere.
