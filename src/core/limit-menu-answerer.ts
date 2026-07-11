import { isDisplayedContentLine } from './limit-detector';
import { TuiStreamNormalizer } from './tui-text';

/**
 * LimitMenuAnswerer — watches the terminal stream for the Claude CLI's
 * rate-limit options dialog and works out the keystrokes that choose
 * "Stop and wait for limit to reset".
 *
 * When a limit is hit, current CLI builds pause on an interactive menu
 * ("What do you want to do?") whose options include paid ones ("Add funds to
 * continue with usage credits", "Upgrade your plan") alongside the safe
 * "Stop and wait for limit to reset" (internal value `cancel`). The stop
 * option's POSITION VARIES — it is first by default but last when the CLI
 * prefers an upgrade path — so blindly pressing Enter could buy usage. And an
 * unanswered menu is worse than a wrong wait: at resume time the keeper types
 * "continue" + Enter, and that Enter would activate whatever option happens to
 * be selected.
 *
 * The answerer is therefore deliberately incremental — move, observe, confirm:
 *  - pointer already on the stop option  -> Enter
 *  - stop option rendered with a number  -> that digit (jumps/selects in the
 *    CLI's menus; a follow-up round confirms with Enter if it only moved)
 *  - pointer visible on another option   -> arrow keys toward the stop option
 * Each step is issued only after the menu has re-rendered (or once as a
 * lost-keystroke retry), so it can never race ahead of the CLI's state.
 *
 * Pure of Electron and timers: the caller feeds output via {@link push} and
 * asks for the next action via {@link step} on its own debounce cadence.
 */

export const STOP_AND_WAIT_RE = /stop and wait for limit to reset/i;

/** The selection pointer the CLI renders in front of the active option. The
 * ASCII fallback ">" requires trailing whitespace so quoted/diff lines that
 * merely start with ">" can't masquerade as the pointer. */
const POINTER_RE = /^(?:❯|›)\s?|^>\s/;

/** Leading box-drawing / whitespace to peel off before pointer inspection. */
const LINE_PREFIX_RE = /^[\s|│┃]+/;

/** A line that is only box border / rule characters (ends a menu block). */
const BORDER_ONLY_RE = /^[\s\-=_~─-╿]*$/;

const KEY_UP = '\x1b[A';
const KEY_DOWN = '\x1b[B';
const KEY_ENTER = '\r';

export interface MenuAction {
  /** Raw keystrokes to write to the PTY. */
  keys: string;
  kind: 'confirm' | 'digit' | 'navigate';
  /** Human-readable description for logs/notices. */
  detail: string;
}

export interface LimitMenuAnswererOptions {
  /** Give up after this many issued actions per menu appearance. */
  maxRounds?: number;
  /** Retained tail of normalized output (chars). */
  tailCap?: number;
}

export class LimitMenuAnswerer {
  private readonly norm = new TuiStreamNormalizer();
  private tail = '';
  private rounds = 0;
  private lastSig = '';
  private repeated = false;
  private readonly maxRounds: number;
  private readonly tailCap: number;

  constructor(opts: LimitMenuAnswererOptions = {}) {
    this.maxRounds = opts.maxRounds ?? 8;
    this.tailCap = opts.tailCap ?? 6_000;
  }

  /** Feed a chunk of raw (ANSI-laden, possibly partial) terminal output. */
  push(chunk: string): void {
    const text = this.norm.push(chunk);
    if (text) this.tail = (this.tail + text).slice(-this.tailCap);
  }

  /** Whether the stop-and-wait menu is (still) present in recent output.
   * True only for a structurally genuine menu (see {@link latestBlock}), so
   * displayed text that merely CONTAINS the stop-option phrase — source dumps,
   * test fixtures, prose about the menu — can never register as one. */
  visible(): boolean {
    return this.latestBlock() !== null;
  }

  /**
   * The most recent line that announces the limit itself (e.g. "You've hit
   * your session limit · resets 3am"), for callers that want to register the
   * limit when the banner slipped past the detector. Menu options and
   * pre-limit "used N%" phrasings are excluded.
   */
  bannerLine(): string | null {
    const lines = this.tail.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (!line || STOP_AND_WAIT_RE.test(line)) continue;
      if (isDisplayedContentLine(line)) continue; // quoted/dumped banner text
      if (/\b(?:hit|reached)\s+(?:your|the)\b[^\n]*\blimit\b/i.test(line)) return line;
    }
    return null;
  }

  /**
   * Decide the next keystroke(s) toward selecting "Stop and wait for limit to
   * reset", based on the menu's latest render. Returns null when there is no
   * menu, nothing safe to do yet, the same frame was already acted on
   * (`allowRepeat` permits ONE re-send for a lost keystroke), or the round
   * budget is exhausted.
   */
  step(allowRepeat = false): MenuAction | null {
    if (this.rounds >= this.maxRounds) return null;

    const found = this.latestBlock();
    if (!found) return null;
    const { block, stopRel, sig } = found;

    // Act once per distinct render: a frame identical to the one already acted
    // on is skipped (except a single lost-keystroke retry), so a stale menu
    // that lingers in the tail after being answered can't be re-answered.
    if (sig === this.lastSig) {
      if (!allowRepeat || this.repeated) return null;
      this.repeated = true;
    } else {
      this.lastSig = sig;
      this.repeated = false;
    }

    const body = (s: string): string => s.replace(LINE_PREFIX_RE, '');
    const stopLine = block[stopRel]!;

    // 1) Pointer already on the stop option: confirm.
    if (POINTER_RE.test(body(stopLine))) {
      this.rounds++;
      return { keys: KEY_ENTER, kind: 'confirm', detail: stopLine.trim() };
    }

    // 2) Numbered option ("2. Stop and wait…"): press the digit.
    const labelAt = stopLine.search(STOP_AND_WAIT_RE);
    const num = stopLine.slice(0, labelAt).match(/(\d{1,2})[.)]\s*$/);
    if (num) {
      this.rounds++;
      return { keys: num[1]!, kind: 'digit', detail: stopLine.trim() };
    }

    // 3) Pointer on another option: arrow toward the stop option.
    const ptrIdx = block.findIndex((l) => POINTER_RE.test(body(l)));
    if (ptrIdx >= 0) {
      const delta = stopRel - ptrIdx;
      this.rounds++;
      return {
        keys: (delta > 0 ? KEY_DOWN : KEY_UP).repeat(Math.abs(delta)),
        kind: 'navigate',
        detail: `${Math.abs(delta)} ${delta > 0 ? 'down' : 'up'} toward "${stopLine.trim()}"`,
      };
    }

    return null; // no pointer, no number: not enough information to act safely
  }

  /**
   * True when the menu's LATEST render is one we have not acted on yet — i.e.
   * the menu is genuinely awaiting an answer. Lets the resume path defer
   * typing the prompt (whose trailing Enter would activate the selected,
   * possibly paid, option) without being fooled by stale menu text that
   * lingers in the tail after the menu was already answered.
   */
  pendingAction(): boolean {
    const found = this.latestBlock();
    return found !== null && found.sig !== this.lastSig;
  }

  /**
   * The menu block of the latest render: contiguous non-empty, non-border
   * lines around the last occurrence of the stop option. Repaints are
   * separated by the blank lines the erase sequences became, so this block is
   * the menu as currently shown.
   *
   * Only a structurally GENUINE menu qualifies. The stop-option phrase also
   * shows up as displayed content whenever limit-handling code is worked on in
   * a watched session (this file's own source, test fixtures, docs) — and a
   * dumped fixture line even carries a real-looking "2." number that step()
   * would happily press, typing stray digits into the user's session. So a
   * candidate is rejected when (a) its line looks like displayed content
   * (line-number gutter, grep path, quote, comment, diff marker), or (b) the
   * block has no menu structure at all — a real menu renders a selection
   *  pointer and/or numbered options; prose mentioning the option has neither.
   */
  private latestBlock(): { block: string[]; stopRel: number; sig: string } | null {
    const lines = this.tail.split('\n');
    const body = (s: string): string => s.replace(LINE_PREFIX_RE, '');
    const isBlockLine = (s: string): boolean => s.trim() !== '' && !BORDER_ONLY_RE.test(s);

    for (let stopIdx = lines.length - 1; stopIdx >= 0; stopIdx--) {
      if (!STOP_AND_WAIT_RE.test(lines[stopIdx]!)) continue;
      if (isDisplayedContentLine(lines[stopIdx]!.trim())) continue;

      let lo = stopIdx;
      let hi = stopIdx;
      while (lo - 1 >= 0 && isBlockLine(lines[lo - 1]!)) lo--;
      while (hi + 1 < lines.length && isBlockLine(lines[hi + 1]!)) hi++;
      const block = lines.slice(lo, hi + 1);

      const stopLine = lines[stopIdx]!;
      const labelAt = stopLine.search(STOP_AND_WAIT_RE);
      const numbered = /(\d{1,2})[.)]\s*$/.test(stopLine.slice(0, labelAt));
      const hasPointer = block.some((l) => POINTER_RE.test(body(l)));
      if (!numbered && !hasPointer) continue; // no menu structure: displayed prose

      return { block, stopRel: stopIdx - lo, sig: block.join('\n') };
    }
    return null;
  }

  /** Forget everything (fresh session / relaunch). */
  reset(): void {
    this.tail = '';
    this.norm.reset();
    this.resetCycle();
  }

  /** New menu appearance: restore the action budget, keep the tail. */
  resetCycle(): void {
    this.rounds = 0;
    this.lastSig = '';
    this.repeated = false;
  }
}
