import { describe, it, expect } from 'vitest';
import { LimitMenuAnswerer } from '@core/limit-menu-answerer';

/** The real CLI's rate-limit options menu, numbered, pointer on the PAID option. */
const MENU_NUMBERED =
  "You've hit your session limit · resets 3:00 PM (America/New_York)\r\n" +
  '\r\n' +
  'What do you want to do?\r\n' +
  '❯ 1. Add funds to continue with usage credits\r\n' +
  '  2. Stop and wait for limit to reset\r\n';

/** Un-numbered variant: selection can only be steered with arrows. */
const MENU_UNNUMBERED =
  'What do you want to do?\r\n' +
  '❯ Add funds to continue with usage credits\r\n' +
  '  Upgrade your plan\r\n' +
  '  Stop and wait for limit to reset\r\n';

describe('LimitMenuAnswerer', () => {
  it('is invisible until the stop option appears', () => {
    const a = new LimitMenuAnswerer();
    a.push('● building the auth module\r\n');
    expect(a.visible()).toBe(false);
    expect(a.step()).toBeNull();
    a.push(MENU_NUMBERED);
    expect(a.visible()).toBe(true);
  });

  it('presses the digit when the stop option is numbered and not selected', () => {
    const a = new LimitMenuAnswerer();
    a.push(MENU_NUMBERED);
    const action = a.step();
    expect(action).toMatchObject({ kind: 'digit', keys: '2' });
  });

  it('confirms with Enter when the pointer is already on the stop option', () => {
    const a = new LimitMenuAnswerer();
    a.push(
      'What do you want to do?\r\n' +
        '  1. Add funds to continue with usage credits\r\n' +
        '❯ 2. Stop and wait for limit to reset\r\n',
    );
    const action = a.step();
    expect(action).toMatchObject({ kind: 'confirm', keys: '\r' });
  });

  it('NEVER blindly presses Enter while the pointer is on a paid option', () => {
    const a = new LimitMenuAnswerer();
    a.push(MENU_NUMBERED);
    const action = a.step();
    expect(action!.keys).not.toContain('\r');
  });

  it('navigates with arrows when the menu is un-numbered', () => {
    const a = new LimitMenuAnswerer();
    a.push(MENU_UNNUMBERED);
    const action = a.step();
    // pointer on option 1, stop is two options below
    expect(action).toMatchObject({ kind: 'navigate', keys: '\x1b[B\x1b[B' });
  });

  it('confirms once a re-render shows the pointer landed on the stop option', () => {
    const a = new LimitMenuAnswerer();
    a.push(MENU_UNNUMBERED);
    expect(a.step()!.kind).toBe('navigate');
    // The CLI re-renders after the arrow keys (erase sequences separate frames).
    a.push(
      '\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K' +
        'What do you want to do?\r\n' +
        '  Add funds to continue with usage credits\r\n' +
        '  Upgrade your plan\r\n' +
        '❯ Stop and wait for limit to reset\r\n',
    );
    expect(a.step()).toMatchObject({ kind: 'confirm', keys: '\r' });
  });

  it('acts once per render: an identical frame is not re-answered', () => {
    const a = new LimitMenuAnswerer();
    a.push(MENU_NUMBERED);
    expect(a.step()).not.toBeNull();
    expect(a.step()).toBeNull(); // same frame, no repeat allowed
    // An identical repaint (erase sequences become the frame separator) has the
    // same signature and is not re-answered either.
    a.push('\x1b[2K\x1b[1A' + MENU_NUMBERED);
    expect(a.step()).toBeNull();
  });

  it('allows a single lost-keystroke repeat when explicitly permitted', () => {
    const a = new LimitMenuAnswerer();
    a.push(MENU_NUMBERED);
    expect(a.step()).not.toBeNull();
    expect(a.step(true)).toMatchObject({ kind: 'digit', keys: '2' }); // one retry
    expect(a.step(true)).toBeNull(); // but only one
  });

  it('does nothing when there is no pointer and no number (not enough info)', () => {
    const a = new LimitMenuAnswerer();
    a.push('What do you want to do?\r\n  Stop and wait for limit to reset (no pointer yet)\r\n');
    expect(a.step()).toBeNull();
  });

  it('pendingAction is true for a fresh frame and false once acted on', () => {
    const a = new LimitMenuAnswerer();
    a.push(MENU_NUMBERED);
    expect(a.pendingAction()).toBe(true);
    a.step();
    expect(a.pendingAction()).toBe(false);
    // Output appended in a SEPARATE frame (blank-line separated) does not make
    // the already-answered menu look pending again.
    a.push('\r\nStopped — waiting for the limit to reset.\r\n');
    expect(a.pendingAction()).toBe(false);
  });

  it('stops issuing actions after the round budget is exhausted', () => {
    const frame = (n: number): string =>
      '\r\n' +
      `What do you want to do? (render ${n})\r\n` +
      '❯ 1. Add funds to continue with usage credits\r\n' +
      '  2. Stop and wait for limit to reset\r\n';
    const a = new LimitMenuAnswerer({ maxRounds: 2 });
    a.push(frame(1));
    expect(a.step()).not.toBeNull();
    a.push(frame(2)); // a genuinely different render each time
    expect(a.step()).not.toBeNull();
    a.push(frame(3));
    expect(a.step()).toBeNull(); // budget spent
  });

  it('exposes the limit banner line for late limit registration', () => {
    const a = new LimitMenuAnswerer();
    a.push(MENU_NUMBERED);
    expect(a.bannerLine()).toContain("hit your session limit");
    // pre-limit percentage phrasings are not banners
    const b = new LimitMenuAnswerer();
    b.push("You've used 71% of your session limit · resets 3pm\r\n");
    expect(b.bannerLine()).toBeNull();
  });

  it('reset() forgets the menu; resetCycle() restores the budget only', () => {
    const a = new LimitMenuAnswerer({ maxRounds: 1 });
    a.push(MENU_NUMBERED);
    expect(a.step()).not.toBeNull();
    expect(a.step()).toBeNull(); // budget spent
    a.resetCycle();
    expect(a.step()).not.toBeNull(); // same tail, budget restored
    a.reset();
    expect(a.visible()).toBe(false);
    expect(a.step()).toBeNull();
  });
});
