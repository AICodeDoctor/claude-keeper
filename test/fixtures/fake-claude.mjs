#!/usr/bin/env node
/**
 * fake-claude — a deterministic stand-in for the Claude Code CLI, used by tests.
 * It never makes network calls and behaves predictably so the full
 * limit -> wait -> resume loop can be exercised without the real binary.
 *
 * Behaviour (mirrors the real interactive CLI):
 *   - prints a banner on start (a "resumed" banner when launched with --continue)
 *   - echoes each submitted line as "● <line>"
 *   - on input "/triggerlimit" (or env FAKE_CLAUDE_AUTOLIMIT=1) it prints a
 *     realistic usage-limit message and — like the real TUI — STAYS ALIVE,
 *     waiting for the user to type a prompt after the reset
 *   - on input "/quit" it exits cleanly
 *
 * Env:
 *   FAKE_CLAUDE_RESET          reset-time text shown in the limit message
 *                              (default "3:00 PM (America/New_York)")
 *   FAKE_CLAUDE_AUTOLIMIT=1    emit the limit message immediately after the banner
 *   FAKE_CLAUDE_LIMIT_EXITS=1  exit (code 7) right after printing the limit,
 *                              modelling a CLI that dies at the limit — exercises
 *                              the relaunch-with---continue resume path
 *   FAKE_CLAUDE_STILL_LIMITED=N  after a limit, the first N submitted prompts are
 *                              answered with the limit message again (still
 *                              limited); the next prompt succeeds — exercises
 *                              retry/backoff on the live session
 *   FAKE_CLAUDE_FAIL_RESUMES=N (with FAKE_CLAUDE_STATE=<file>) when launched with
 *                              --continue, the first N such launches print the
 *                              limit and exit — exercises relaunch retries
 *   FAKE_CLAUDE_MENU=1         at the limit, render the real CLI's rate-limit
 *                              options menu instead of a plain banner and wait
 *                              for an answer. The pointer starts on the PAID
 *                              option, so a blind Enter "buys" extra usage
 *                              (prints EXTRA USAGE PURCHASED and exits 9 — a
 *                              loud test failure); pressing "2" chooses
 *                              "Stop and wait for limit to reset"
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const isContinue = args.includes('--continue') || args.includes('-c');
const reset = process.env.FAKE_CLAUDE_RESET || '3:00 PM (America/New_York)';
const limitExits = process.env.FAKE_CLAUDE_LIMIT_EXITS === '1';

let limited = false;
let menuOpen = false;
let stillLimitedReplies = parseInt(process.env.FAKE_CLAUDE_STILL_LIMITED || '0', 10) || 0;
const withMenu = process.env.FAKE_CLAUDE_MENU === '1';

function out(line) {
  process.stdout.write(line + '\r\n');
}

function emitLimit() {
  if (withMenu) {
    // Mirrors the real CLI's rate-limit options dialog: the safe choice is NOT
    // where the pointer starts, and its position/number varies in real builds.
    out(`You've hit your session limit · resets ${reset}`);
    out('');
    out('What do you want to do?');
    out('❯ 1. Add funds to continue with usage credits');
    out('  2. Stop and wait for limit to reset');
    menuOpen = true;
    limited = true;
    return;
  }
  out(`Claude usage limit reached. Your limit will reset at ${reset}.`);
  // distinct exit code from a clean /quit, so callers can tell them apart
  if (limitExits) process.exit(7);
  limited = true;
}

/**
 * Handle one raw keystroke while the options menu is open — like the real
 * TUI's menu, which reads raw keys (a digit acts immediately, no Enter needed).
 */
function handleMenuKey(ch) {
  if (ch === '2') {
    menuOpen = false;
    // The real TUI erases the menu and repaints; the blank line models the
    // frame separation those erase sequences become.
    out('');
    out('Stopped — waiting for the limit to reset.');
    return;
  }
  if (ch === '\r' || ch === '\n') {
    // Enter with the pointer still on the paid option: the catastrophe the
    // answerer exists to prevent. Fail loudly so tests catch it.
    menuOpen = false;
    out('EXTRA USAGE PURCHASED');
    process.exit(9);
  }
  // any other keystroke is ignored by the menu
}

/**
 * Relaunch-failure simulation: when launched with --continue, increment a counter
 * in FAKE_CLAUDE_STATE. While that counter is <= FAKE_CLAUDE_FAIL_RESUMES the
 * relaunch is treated as "still limited" (prints the limit message and exits),
 * letting tests exercise relaunch retry/backoff deterministically.
 */
function maybeFailResume() {
  if (!isContinue) return;
  const failResumes = parseInt(process.env.FAKE_CLAUDE_FAIL_RESUMES || '0', 10);
  if (!failResumes) return;
  const statePath = process.env.FAKE_CLAUDE_STATE;
  let count = 1;
  if (statePath) {
    try {
      count = parseInt(fs.readFileSync(statePath, 'utf8'), 10) + 1;
    } catch {
      count = 1;
    }
    try {
      fs.writeFileSync(statePath, String(count));
    } catch {
      /* best effort */
    }
  }
  if (count <= failResumes) {
    out(`Claude usage limit reached. Your limit will reset at ${reset}.`);
    process.exit(7);
  }
}

if (isContinue) {
  out('Resuming previous conversation...');
  maybeFailResume();
} else {
  out('Claude Code (fake) - Pro');
}
out('ready');

if (process.env.FAKE_CLAUDE_AUTOLIMIT === '1') {
  emitLimit();
}

function onLine(line) {
  if (line === '/quit') {
    process.exit(0);
    return;
  }
  if (limited) {
    // The real TUI answers prompts sent before the reset with the limit notice
    // again; once the reset has passed, the next prompt just works.
    if (stillLimitedReplies > 0) {
      stillLimitedReplies -= 1;
      out(`Claude usage limit reached. Your limit will reset at ${reset}.`);
      return;
    }
    limited = false;
    if (line.length > 0) out('● ' + line);
    return;
  }
  if (line === '/triggerlimit') return emitLimit();
  if (line.length > 0) out('● ' + line);
}

// Raw, key-level input handling (readline can't model the menu: the real TUI
// reads raw keys, so a digit selects immediately without Enter). Raw mode is
// required under a PTY — canonical mode would buffer keystrokes until Enter.
let inputBuf = '';
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  for (const ch of chunk) {
    if (menuOpen) {
      handleMenuKey(ch);
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      const line = inputBuf.trim();
      inputBuf = '';
      onLine(line);
    } else {
      inputBuf += ch;
    }
  }
});
process.stdin.on('end', () => process.exit(0));
