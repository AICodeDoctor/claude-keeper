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

export const DEFAULT_LIMIT_PATTERNS: RegExp[] = [
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

/** Absolute ceiling so a pinned, never-terminated candidate line can't grow forever. */
const HARD_BUFFER_MULTIPLIER = 8;

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
      if (isPreLimitUsageWarning(line)) {
        if (nl < 0) return false; // trailing line is a warning: nothing genuine pending
        search = nl + 1; // skip this terminated warning and look further on
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

      // A sub-100% usage warning ("used 71% of your limit") is not a limit that
      // has been reached: consume it and keep scanning for a genuine limit line.
      if (isPreLimitUsageWarning(line)) continue;

      const reset = parseResetTime(line, this.now());
      return { matchedText: line, resetTime: reset?.date ?? null, reset };
    }
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
