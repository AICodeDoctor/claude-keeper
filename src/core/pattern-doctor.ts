import { parseResetTime } from './reset-time-parser';
import { STRONG_LIMIT_PATTERNS, WEAK_LIMIT_PATTERNS } from './limit-detector';

/**
 * Pattern doctor — verifies the active limit-detection patterns against the
 * limit phrasings actually baked into the user's installed Claude CLI.
 *
 * The CLI's message strings live as plain text inside its (compiled) binary,
 * template placeholders included (`You've hit your ${e}${t}`). Extracting the
 * banner-shaped ones and probing them against the compiled patterns catches a
 * future CLI wording change PROACTIVELY — at session start, with a visible
 * warning — instead of silently, days later, when a limit goes undetected.
 *
 * This module is pure (no fs/Electron): callers feed text chunks — see
 * src/main/pattern-doctor-runner.ts for the streaming binary scanner.
 */

/**
 * A phrase shaped like a limit banner: a reached-limit verb with the word
 * "limit" nearby (either order), or the adjacent "limit reached". Only these
 * are worth flagging — the binary contains thousands of incidental "limit"
 * strings (docs, flags, schema text) that are not banners.
 */
const BANNER_SHAPE_RE =
  /\b(?:hit|reached)\b[^\n]{0,60}?\blimit\b|\blimit\b[^\n]{0,30}?\breached\b|\blimit reached\b/i;

/**
 * The phrase must also be about a USAGE-style limit. The binary is full of
 * banner-shaped developer diagnostics ("JIT stack limit reached", "max turns
 * limit reached", "context window limit") that Keeper must not wait on —
 * waiting cannot fix them. Real usage banners always carry one of these nouns.
 */
const USAGE_FLAVOR_RE =
  /\b(?:usage|session|weekly|daily|hourly|monthly|spend|credits?|opus|sonnet|fable|plan)\b/i;

/**
 * Marketing/settings copy speaks about limits hypothetically ("Configure usage
 * credits to keep working when you hit a limit"); a real banner states a fact
 * about now. Hypothetical phrasings are not detection targets.
 */
const HYPOTHETICAL_RE = /\b(?:when|if|before|after|until)\s+you(?:'ve|’ve)?\s+(?:hit|reach)/i;

/** Printable-run extraction: candidate phrases around limit vocabulary OR a
 * template placeholder (`You've hit your ${e}${t}` carries the word "limit"
 * inside the placeholder, so the anchor must accept both). The class
 * deliberately excludes quotes/backticks (string-literal boundaries in the
 * minified source) and all control bytes. */
const CANDIDATE_RE =
  /[A-Za-z][A-Za-z0-9'’&$@{}().,%/ :·-]{6,140}(?:\blimit\b|\$\{[^{}]{0,40}\})[A-Za-z0-9'’&$@{}().,%/ :·-]{0,80}/g;

/** Representative substitutions so template placeholders probe like a real
 * render: the first placeholder is the limit noun, later ones the suffix. */
const NOUN_SUB = 'session limit';
const SUFFIX_SUB = ' · resets 3pm (America/New_York)';

const MAX_PHRASES = 400;
const MAX_PHRASE_LEN = 200;

export interface DoctorCoverage {
  covered: string[];
  uncovered: string[];
}

/**
 * Pull banner-shaped limit phrases out of arbitrary (binary-extracted) text.
 * Template placeholders are substituted with representative values so the
 * phrase probes the patterns the way a rendered banner would. Deduplicated,
 * order-preserving, capped.
 */
export function extractLimitPhrases(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(CANDIDATE_RE.source, 'g');
  while ((m = re.exec(text)) !== null && out.length < MAX_PHRASES) {
    let phrase = m[0]!;
    // Cut at string-literal boundaries: the run above deliberately excludes
    // quotes/backticks, so this is just a defensive trim + length cap.
    phrase = phrase.slice(0, MAX_PHRASE_LEN).trim();
    // Substitute template placeholders like a real render would fill them —
    // but ONLY a placeholder in noun position ("your ${e}", "the ${e}") gets
    // the limit-noun value. Substituting every placeholder with "session
    // limit" would FABRICATE usage banners out of unrelated diagnostics
    // ("Reached max turns limit (${e})" must not probe as a session limit).
    let sawNoun = false;
    phrase = phrase.replace(/(your|the)\s+\$\{[^{}]*\}|\$\{[^{}]*\}/gi, (_m, lead?: string) => {
      if (lead && !sawNoun) {
        sawNoun = true;
        return `${lead} ${NOUN_SUB}`;
      }
      return sawNoun ? SUFFIX_SUB : ' N ';
    });
    if (!BANNER_SHAPE_RE.test(phrase)) continue;
    if (!USAGE_FLAVOR_RE.test(phrase)) continue;
    if (HYPOTHETICAL_RE.test(phrase)) continue;
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
  }
  return out;
}

/**
 * Probe each phrase against the patterns the way the detector would judge a
 * live line: a strong match is covered outright; a weak match counts only when
 * a reset time parses; anything else is uncovered.
 */
export function checkPatternCoverage(
  phrases: string[],
  strong: RegExp[] = STRONG_LIMIT_PATTERNS,
  weak: RegExp[] = WEAK_LIMIT_PATTERNS,
  now: number = Date.now(),
): DoctorCoverage {
  const covered: string[] = [];
  const uncovered: string[] = [];
  for (const phrase of phrases) {
    if (strong.some((p) => p.test(phrase))) {
      covered.push(phrase);
    } else if (weak.some((p) => p.test(phrase)) && parseResetTime(phrase, now) !== null) {
      covered.push(phrase);
    } else {
      uncovered.push(phrase);
    }
  }
  return { covered, uncovered };
}
