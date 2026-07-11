import { describe, it, expect } from 'vitest';
import { extractLimitPhrases, checkPatternCoverage } from '@core/pattern-doctor';

const NOW = Date.UTC(2026, 0, 15, 8, 0, 0);

/** A slice shaped like the real CLI binary's minified source. */
const BINARY_LIKE =
  'var x=1;function qY(e,t,n){return`You’ve hit your ${e}${t}`}var feo=new Set();' +
  'case"org_spend_cap_reached":return RA()?"You’ve hit your monthly spend limit. Run /usage-credits":' +
  '"You’ve hit your monthly spend limit. /model to switch models.";' +
  'if(e.rateLimitType==="five_hour")r="session limit";' +
  'let w={label:l?"Stop":"Stop and wait for limit to reset",value:"cancel"};' +
  'other junk \x00\x01\x02 padding with limitless words and rate limit docs';

describe('extractLimitPhrases', () => {
  it('extracts banner-shaped phrases and renders template placeholders', () => {
    const phrases = extractLimitPhrases(BINARY_LIKE);
    // The template `You've hit your ${e}${t}` probes as a rendered banner.
    expect(phrases.some((p) => /hit your session limit/i.test(p))).toBe(true);
    expect(phrases.some((p) => /monthly spend limit/i.test(p))).toBe(true);
  });

  it('ignores limit-adjacent text that is not banner-shaped', () => {
    const phrases = extractLimitPhrases('the rate limit docs describe throttling in detail');
    expect(phrases).toEqual([]);
  });

  it('dedupes case-insensitively and survives control-byte junk', () => {
    const phrases = extractLimitPhrases(
      'You have hit the usage limit\x00You have HIT the USAGE limit\x01noise',
    );
    expect(phrases).toHaveLength(1);
  });

  it('does not fabricate usage banners from non-usage diagnostics', () => {
    const phrases = extractLimitPhrases(
      'JIT stack limit reached\x00Reached max turns limit (${e})\x00' +
        'The model has reached its context window limit.\x00Concurrent export limit reached',
    );
    expect(phrases).toEqual([]);
  });
});

describe('checkPatternCoverage', () => {
  it('marks known phrasings covered', () => {
    const { covered, uncovered } = checkPatternCoverage(
      [
        "You've hit your session limit · resets 3pm (America/New_York)",
        "You've hit your monthly spend limit. /model to switch models.",
        'Weekly usage limit reached.',
      ],
      undefined,
      undefined,
      NOW,
    );
    expect(uncovered).toEqual([]);
    expect(covered).toHaveLength(3);
  });

  it('flags a banner-shaped phrasing no pattern would register', () => {
    // "limit has been reached" defeats the strong adjacency patterns, and with
    // no reset time the weak patterns are discarded too.
    const { uncovered } = checkPatternCoverage(
      ['Your usage limit has been reached for now'],
      undefined,
      undefined,
      NOW,
    );
    expect(uncovered).toHaveLength(1);
  });

  it('credits a weak match only when it carries a parseable reset time', () => {
    const withTime = checkPatternCoverage(
      ['Session limit · resets 11:30am (UTC)'],
      undefined,
      undefined,
      NOW,
    );
    expect(withTime.uncovered).toEqual([]);
    const withoutTime = checkPatternCoverage(
      ['Session limit · resets eventually'],
      undefined,
      undefined,
      NOW,
    );
    expect(withoutTime.uncovered).toHaveLength(1);
  });
});
