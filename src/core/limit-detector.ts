import { parseResetTime, type ParsedReset } from './reset-time-parser';
import { TuiStreamNormalizer } from './tui-text';

export interface LimitEvent {
  /** The full output line that matched a limit pattern (ANSI-stripped). */
  matchedText: string;
  /** Parsed reset time, or null when none could be extracted. */
  resetTime: Date | null;
  /** Full parse detail, or null. */
  reset: ParsedReset | null;
}

export interface LimitDetectorOptions {
  /** Limit-reached patterns. Defaults cover the known Claude phrasings. */
  patterns?: RegExp[];
  /** Injectable clock for deterministic reset-time parsing. */
  now?: () => number;
  /** Soft cap on the retained tail buffer (chars) when no candidate is pending. */
  maxBuffer?: number;
}

/**
 * Patterns that name the limit explicitly ("hit/reached your … limit", "…limit
 * reached"). A line matching one of these is trusted on its own, even when no
 * reset time can be parsed from it.
 */
export const STRONG_LIMIT_PATTERNS: RegExp[] = [
  // "Claude usage limit reached.", "Weekly usage limit reached." — qualifier (if
  // any) sits before "usage limit", so this already covers the weekly variant.
  /usage limit reached/i,
  // "You've reached your usage limit", "...weekly usage limit", "...session limit".
  // Allow up to 3 qualifier words (e.g. "your weekly") between "reached" and the
  // limit noun — the missing tolerance here is exactly why weekly limits, phrased
  // "reached your weekly usage limit", went undetected. The noun is no longer
  // pinned to "usage": newer builds say "session limit" (and "weekly limit").
  /reached (?:[\w-]+\s+){0,3}(?:usage|session|weekly|daily|hourly|monthly) limit/i,
  // "You've hit your usage limit", "you have hit your weekly usage limit",
  // "You've hit your session limit" — the current phrasing that broke detection.
  /hit (?:[\w-]+\s+){0,3}(?:usage|session|weekly|daily|hourly|monthly) limit/i,
  // "You've hit your Opus limit", "…Sonnet limit", "…Fable 5 limit", "…fast
  // limit", "…monthly spend limit", "…org's monthly usage limit" — the limit
  // noun is a model/plan name the alternation above doesn't know. Any short
  // "hit/reached your|the <words> limit" phrase is a reached limit.
  /\b(?:hit|reached)\s+(?:your|the)\s+(?:[\w'&-]+\s+){0,4}?limit\b/i,
  // "Weekly limit reached", "5-hour limit reached", "Daily/Hourly/Monthly/Session
  // limit reached" — the bare phrasing that omits the word "usage".
  /\b(?:weekly|daily|hourly|monthly|session|\d+\s*-?\s*hour)\s+limit reached/i,
  // "Fast mode disabled · usage credit limit reached" — the credits variant
  // (found by the pattern doctor scanning the installed CLI binary).
  /\b(?:usage\s+)?credits?\s+limit reached/i,
];

/**
 * Patterns that key on reset-time vocabulary rather than an explicit
 * reached-limit phrase. They exist to catch phrasings the strong patterns
 * don't know yet — but that breadth makes them false-positive magnets when
 * limit-adjacent text merely APPEARS in the terminal (source files, diffs,
 * commit logs, prose about limits… this very repo's own code). So a match is
 * only trusted when a concrete reset time parses out of the matched line: the
 * real CLI banner always carries one ("· resets <time>"), while incidental
 * text usually doesn't. A weak match with no time is dropped — without this,
 * it would start a blind interval-poll wait (the "false alert with a 5-minute
 * timer" failure).
 */
export const WEAK_LIMIT_PATTERNS: RegExp[] = [
  // "Session limit · resets 11:30am", "Weekly limit · resets …" — the newest
  // phrasing pairs the limit noun with "resets" instead of "reached", and may
  // arrive without any "hit"/"reached" verb to anchor on.
  /\b(?:usage|session|weekly|daily|hourly|monthly|\d+\s*-?\s*hour)\s+limit\b[^\n]*\bresets?\b/i,
  // "reset(s) at|by <time>" — treat any reset phrase carrying a concrete time as
  // a limit signal even when the surrounding wording changes. Covers a clock time
  // ("resets at 11:30am", "reset by 9 PM"), an ISO timestamp, or noon/midnight.
  /\breset(?:s)?\s+(?:at|by)\s+(?:\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|noon|midnight)/i,
  // Encoding-robust catch-all: the stems "limit" and "reset" co-occurring within a
  // single sentence, or split across two consecutive sentences (at most one
  // sentence terminator between them). Claude varies the exact wording, spacing
  // (e.g. non-breaking spaces), and apostrophe glyphs between CLI builds, but a
  // usage-limit notice reliably pairs these two words. Keying on just them —
  // tolerant of any in-between text — picks up phrasings the specific patterns
  // above miss. The sentence-gap whitespace is `[^\S\n]` (space/tab, never a
  // newline) so the two words must co-occur on the SAME physical line: the
  // detector emits line-by-line, so a cross-line bridge would both falsely join
  // unrelated lines and lose the reset time. Both word orders covered.
  /\blimit\b[^.!?\n]*(?:[.!?]+[^\S\n]*)?[^.!?\n]*?\breset/i,
  /\breset[^.!?\n]*(?:[.!?]+[^\S\n]*)?[^.!?\n]*?\blimit\b/i,
];

export const DEFAULT_LIMIT_PATTERNS: RegExp[] = [
  ...STRONG_LIMIT_PATTERNS,
  ...WEAK_LIMIT_PATTERNS,
];

/** Weak patterns recognized by source so the split survives setPatterns()
 * round-trips (custom user patterns are never in this set => always strong). */
const WEAK_PATTERN_SOURCES = new Set(WEAK_LIMIT_PATTERNS.map((p) => p.source));

/** Absolute ceiling so a pinned, never-terminated candidate line can't grow forever. */
const HARD_BUFFER_MULTIPLIER = 8;

/**
 * A line that is clearly CONTENT BEING DISPLAYED in the terminal — a file dump,
 * grep/diff output, a comment, a quoted string — rather than the CLI speaking
 * for itself. Working on limit-related code (this very repo) paints hundreds of
 * such lines, many containing verbatim banner text (test fixtures, pattern
 * comments), and each would otherwise register as a real limit. The genuine
 * banner is never rendered behind any of these prefixes.
 */
const DISPLAYED_CONTENT_PATTERNS: RegExp[] = [
  // "  46\t…" / "46→…" — cat -n / file-viewer line-number gutters.
  /^\s*\d{1,6}\s*[\t→]/,
  // "path/file.ts:48:…" or ":48-…" — grep -n output. The pre-colon token must
  // contain a letter so a bare clock time ("11:30:00 …") is not mistaken for it.
  /^\s*[^:\s]*[A-Za-z][^:\s]*:\d{1,6}[-:]/,
  // Source comments and markdown headings: "// …", "/* …", " * …", "# …".
  /^\s*(?:\/\/|\/\*|\*\s|#\s)/,
  // Diff bodies ("+ added", "- removed", "+++/---" file headers) and list bullets.
  /^\s*[-+]\s|^\s*[-+]{3,}(?:\s|$)/,
  // Blockquotes / echoed prompts (">"), tool-output gutters ("⎿"), ASCII table
  // rows ("|"). NOT the box-drawing "│": the CLI renders its real banner inside
  // a │-bordered panel, so that glyph legitimately prefixes a genuine limit.
  /^\s*[>⎿|]/,
  // A line that OPENS with a quote is a string literal being shown (fixtures,
  // code) — the CLI never quotes its own banner.
  /^\s*['"`]/,
  // Regex-source fragments: "\b", "\d", "\s"… appear when pattern definitions
  // (like this file's) are displayed, never in a rendered banner.
  /\\[bBdDsSwW]/,
  // A function call opening a string argument — out('…'), push("…") — is code
  // being displayed (a raw cat of a fixture/test), not the CLI speaking.
  /\w\(['"`]/,
  // A line ENDING at a closing quote (plus trailing punctuation) is a string
  // literal or prose quoting the banner; the CLI never quotes its own banner.
  /['"`][.,;)\]]*\s*$/,
];

export function isDisplayedContentLine(line: string): boolean {
  return DISPLAYED_CONTENT_PATTERNS.some((p) => p.test(line));
}

/**
 * A phrase that says the limit HAS been hit ("hit/reached your … limit",
 * "limit reached"). A line carrying one is a real limit no matter what
 * percentage figures sit nearby: when the TUI repaints its status strip in
 * place, a stale "used 71%" from a previous render can share a pseudo-line
 * with the genuine banner, and the percentage must not veto it. The verb must
 * be followed by "your|the" (with no % before "limit") so warning phrasings
 * like "reached 90% of your limit" don't count as reached.
 */
const REACHED_LIMIT_RE =
  /\b(?:hit|reached)\s+(?:your|the)\s[^%\n]{0,60}?\blimit\b|\blimit reached\b/i;

/**
 * A matched line that carries a percentage *below* 100% is a pre-limit usage
 * warning (e.g. "You've used 71% of your limit · resets 5pm"), not a limit that
 * has actually been reached — the CLI shows these as you approach the cap. Only
 * 100% (or higher) means the limit is truly hit. A line with no percentage at
 * all is unaffected (the classic "usage limit reached" wording carries none).
 *
 * Returns true when the line should NOT trigger the wait/resume flow.
 */
function isPreLimitUsageWarning(line: string): boolean {
  if (REACHED_LIMIT_RE.test(line)) return false; // explicitly reached: never a warning
  const re = /(\d{1,3}(?:\.\d+)?)\s*%/g;
  let sawPercent = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    sawPercent = true;
    if (parseFloat(m[1]) >= 100) return false; // 100%+ => real limit, trigger
  }
  return sawPercent; // had a percentage, all below 100% => warning, skip
}

/**
 * Scans streamed terminal output for a "usage limit reached" message and
 * extracts the reset time. ANSI is stripped; a rolling buffer reassembles
 * messages split across chunks. Emits at most once per occurrence (the matched
 * line is consumed from the buffer). A line is normally emitted once it is
 * newline-terminated (so a partially-streamed reset time is not lost); use
 * {@link flush} to force-emit a pending line when the process exits or stalls.
 */
export class LimitDetector {
  private buf = '';
  /** ANSI-aware normalizer: reassembles split escapes and converts in-place
   * TUI repaints (cursor moves, erases, lone CR) into line breaks. */
  private readonly norm = new TuiStreamNormalizer();
  private patterns: RegExp[];
  private readonly now: () => number;
  private readonly maxBuffer: number;

  constructor(opts: LimitDetectorOptions = {}) {
    this.patterns = LimitDetector.normalizePatterns(opts.patterns ?? DEFAULT_LIMIT_PATTERNS);
    this.now = opts.now ?? (() => Date.now());
    this.maxBuffer = opts.maxBuffer ?? 8192;
  }

  /**
   * Normalize away the global flag so repeated `.match`/`.test`/`.search` stay
   * stateless (a `g`-flagged regex carries `lastIndex` between calls).
   */
  private static normalizePatterns(patterns: RegExp[]): RegExp[] {
    return patterns.map((p) => (p.global ? new RegExp(p.source, p.flags.replace('g', '')) : p));
  }

  /**
   * Swap the active limit-detection patterns at runtime so a settings change
   * takes effect on the *current* session without a relaunch. The rolling
   * buffer is preserved, so output already streamed (but not yet newline-
   * terminated) is re-evaluated against the new patterns on the next push/flush.
   */
  setPatterns(patterns: RegExp[]): void {
    this.patterns = LimitDetector.normalizePatterns(patterns);
  }

  /** Feed a chunk of (possibly ANSI-laden, possibly partial) output. */
  push(chunk: string): LimitEvent | null {
    this.buf += this.norm.push(chunk);
    const ev = this.scan(false);
    if (!ev) this.trim();
    return ev;
  }

  /** Force-emit a pending (unterminated) limit line, e.g. on process exit. */
  flush(): LimitEvent | null {
    // No more chunks are coming: fold any held-back fragment into the buffer
    // so a match sitting just before it isn't withheld.
    this.buf += this.norm.flush();
    return this.scan(true);
  }

  /**
   * True when the buffer currently holds a pattern match whose line is *not*
   * newline-terminated — i.e. {@link push} matched but is withholding the event
   * pending a newline, so only {@link flush} would emit it. Lets a caller detect
   * a limit that the CLI renders in place (a live TUI redraw with no trailing
   * newline) by force-flushing once output goes idle, instead of waiting for a
   * newline that never comes or for the process to exit.
   */
  hasPendingMatch(): boolean {
    let search = 0;
    for (;;) {
      const matchIndex = this.earliestMatchIndex(search);
      if (matchIndex < 0) return false;
      const nl = this.buf.indexOf('\n', matchIndex);
      const lineStart = this.buf.lastIndexOf('\n', matchIndex) + 1;
      const line = this.buf
        .slice(lineStart, nl < 0 ? this.buf.length : nl)
        .replace(/\r$/, '')
        .trim();
      if (this.isDiscardedMatch(line)) {
        if (nl < 0) return false; // trailing line would be discarded: nothing pending
        search = nl + 1; // skip this terminated non-event and look further on
        continue;
      }
      return nl < 0; // genuine match: pending iff not yet newline-terminated
    }
  }

  reset(): void {
    this.buf = '';
    this.norm.reset();
  }

  /** Index of the earliest pattern match at or after `from`, or -1 if none. */
  private earliestMatchIndex(from: number): number {
    const hay = from === 0 ? this.buf : this.buf.slice(from);
    let idx = -1;
    for (const p of this.patterns) {
      const m = hay.match(p);
      if (m && m.index !== undefined) {
        const at = from + m.index;
        if (idx < 0 || at < idx) idx = at;
      }
    }
    return idx;
  }

  /** Find the earliest matching line; emit it if complete (or forced). */
  private scan(force: boolean): LimitEvent | null {
    for (;;) {
      const matchIndex = this.earliestMatchIndex(0);
      if (matchIndex < 0) return null;

      let lineEnd = this.buf.indexOf('\n', matchIndex);
      if (lineEnd < 0) {
        if (!force) return null; // wait for the full line
        lineEnd = this.buf.length;
      }

      const lineStart = this.buf.lastIndexOf('\n', matchIndex) + 1;
      const line = this.buf.slice(lineStart, lineEnd).replace(/\r$/, '').trim();
      this.buf = lineEnd < this.buf.length ? this.buf.slice(lineEnd + 1) : '';

      // Not a limit actually being announced (usage warning, displayed content,
      // weak match without a time): consume it and keep scanning.
      if (this.isDiscardedMatch(line)) continue;

      const reset = parseResetTime(line, this.now());
      return { matchedText: line, resetTime: reset?.date ?? null, reset };
    }
  }

  /**
   * True when a pattern-matching line must NOT register as a limit:
   *  - a sub-100% usage warning ("used 71% of your limit"),
   *  - displayed content (file dumps, grep/diff output, comments, quotes),
   *  - a weak (reset-vocabulary) match with no parseable reset time — the real
   *    banner always names one; incidental limit-adjacent prose usually doesn't.
   */
  private isDiscardedMatch(line: string): boolean {
    if (isPreLimitUsageWarning(line)) return true;
    if (isDisplayedContentLine(line)) return true;
    const strong = this.patterns.some(
      (p) => !WEAK_PATTERN_SOURCES.has(p.source) && p.test(line),
    );
    return !strong && parseResetTime(line, this.now()) === null;
  }

  /** Bound memory — but never discard an unterminated line that holds a match. */
  private trim(): void {
    const hasPendingCandidate = this.patterns.some((p) => this.buf.search(p) >= 0);
    if (hasPendingCandidate && this.buf.length <= this.maxBuffer * HARD_BUFFER_MULTIPLIER) {
      return;
    }
    if (this.buf.length > this.maxBuffer) {
      this.buf = this.buf.slice(-this.maxBuffer);
    }
  }
}
