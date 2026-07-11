import stripAnsi from 'strip-ansi';

/**
 * TuiStreamNormalizer — turns a raw PTY stream (ANSI-laden, chunked at
 * arbitrary byte boundaries) into plain text whose line structure mirrors what
 * the terminal SHOWS, not merely where the CLI wrote "\n".
 *
 * Interactive TUIs (the Claude CLI is Ink-based) repaint regions in place with
 * cursor-movement and erase sequences instead of newlines. Stripping ANSI
 * naively then CONCATENATES text from different repaints into one endless
 * pseudo-line. That is exactly how the "you've hit your session limit" banner
 * went undetected: the status strip that previously rendered "You've used 71%
 * of your session limit · resets 3am" was repainted in place with the real
 * limit banner, the two renders fused into a single unterminated line, and the
 * sub-100% figure from the STALE render made the whole line look like a
 * pre-limit warning. Treating every row-changing control as a line break keeps
 * each repaint on its own clean line(s).
 *
 * Two chunk-boundary hazards are also handled here:
 *  - a trailing *incomplete* ANSI escape (a PTY read can split "\x1b[0m" in
 *    half; per-chunk stripping would leave residue that fractures the text) is
 *    held back and reunited with the next chunk;
 *  - a trailing bare "\r" is held back, since it may be the first half of a
 *    CRLF split across chunks (a lone "\r" means an in-place rewrite and is
 *    converted to a line break; "\r\n" must stay a single break).
 */

/**
 * Row-changing / erasing CSI sequences, each converted to a line break: cursor
 * up/down (A/B), next/previous line (E/F), column-absolute (G — the row is
 * being rewritten from the start), horizontal-absolute (`), row-absolute (d),
 * row-relative (e), cursor position (H/f), erase display (J), erase line (K),
 * insert/delete lines (L/M), erase characters (X — an in-place rewrite),
 * scroll (S/T), restore cursor (u). SGR coloring (m) and everything else is
 * simply stripped.
 */
// eslint-disable-next-line no-control-regex
const ROW_BREAK_CSI_RE = /\x1b\[[0-9;?]*[ABEFGHJKLMSTX`defu]/g;

/**
 * Non-CSI escapes that move the cursor to another row: IND (ESC D, index
 * down), NEL (ESC E, next line), RI (ESC M, reverse index up), DECRC (ESC 8,
 * restore cursor — the saved position is usually another row), RIS (ESC c,
 * full reset). Also the alternate-screen switches (a whole-screen swap).
 */
// eslint-disable-next-line no-control-regex
const ROW_BREAK_ESC_RE = /\x1b[DEM8c]|\x1b\[\?(?:47|1047|1049)[hl]/g;

/**
 * A trailing, *incomplete* ANSI escape at the very end of the accumulated raw
 * stream: a lone ESC, an unfinished CSI (`ESC [` + params/intermediates but no
 * final byte), or an unfinished OSC (`ESC ]` + body but no BEL/ST terminator).
 */
// eslint-disable-next-line no-control-regex
const INCOMPLETE_ESC_RE = /\x1b(?:\[[0-9;?<>=]*[ -/]*|\][^\x07\x1b]*)?$/;

/** Never hold more than this as a pending escape, so a lone ESC in plain output
 * (or a pathological unterminated OSC) can't stall the stream indefinitely. */
const MAX_HELD_ESC = 128;

/**
 * Index at which a trailing incomplete ANSI escape begins, or `s.length` when
 * there is none to hold back. An implausibly long trailing "escape" is treated
 * as ordinary text (returns `s.length`) rather than held forever.
 */
function incompleteEscapeStart(s: string): number {
  const m = s.match(INCOMPLETE_ESC_RE);
  if (!m || m.index === undefined) return s.length;
  if (s.length - m.index > MAX_HELD_ESC) return s.length;
  return m.index;
}

/** Row-break escapes -> "\n", strip the rest, lone "\r" (in-place rewrite) and
 * vertical-tab / form-feed (both advance a row on a terminal) -> "\n". */
function normalize(s: string): string {
  if (!s) return '';
  return stripAnsi(s.replace(ROW_BREAK_CSI_RE, '\n').replace(ROW_BREAK_ESC_RE, '\n')).replace(
    /\r(?!\n)|[\v\f]/g,
    '\n',
  );
}

export class TuiStreamNormalizer {
  /** Trailing incomplete escape (or bare CR) held back from the last chunk. */
  private pending = '';

  /** Normalize a chunk; returns the text that is safe to consume now. */
  push(chunk: string): string {
    const raw = this.pending + chunk;
    let holdAt = incompleteEscapeStart(raw);
    // A trailing bare CR may be the first half of a CRLF split across chunks —
    // hold it so it isn't misread as an in-place rewrite.
    if (holdAt === raw.length && raw.endsWith('\r')) holdAt -= 1;
    this.pending = raw.slice(holdAt);
    return normalize(raw.slice(0, holdAt));
  }

  /** No more chunks are coming: release whatever is held back. */
  flush(): string {
    const rest = this.pending;
    this.pending = '';
    return normalize(rest);
  }

  reset(): void {
    this.pending = '';
  }
}
