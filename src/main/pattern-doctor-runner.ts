import { createReadStream, promises as fsp } from 'node:fs';
import { extractLimitPhrases, checkPatternCoverage } from '../core/pattern-doctor';
import { createLogger } from '../core/logger';

const log = createLogger('doctor');

/** Refuse to scan implausibly large targets (the real CLI is ~230MB). */
const MAX_SCAN_BYTES = 600 * 1024 * 1024;
/** Streaming chunk size. */
const CHUNK_BYTES = 4 * 1024 * 1024;
/** Carried between chunks so a phrase split at a boundary still assembles. */
const OVERLAP_BYTES = 512;

export interface DoctorReport {
  /** False when the binary could not be scanned (missing, too big, IO error). */
  scanned: boolean;
  /** Resolved path that was scanned (symlinks followed). */
  path?: string;
  /** Banner-shaped phrases found in the binary. */
  phraseCount: number;
  /** Phrases the ACTIVE patterns would not register as a limit. */
  uncovered: string[];
}

/**
 * Scan the installed CLI binary for banner-shaped limit phrasings and check
 * each against the given strong/weak pattern split. Streaming with a small
 * inter-chunk overlap, so the 200MB+ compiled binary is scanned without ever
 * holding more than a few MB. Best-effort by design: any failure returns
 * `scanned:false` rather than throwing — the doctor must never break a launch.
 */
export async function runPatternDoctor(
  binaryPath: string,
  strong: RegExp[],
  weak: RegExp[],
): Promise<DoctorReport> {
  const none: DoctorReport = { scanned: false, phraseCount: 0, uncovered: [] };
  let real: string;
  try {
    real = await fsp.realpath(binaryPath);
    const st = await fsp.stat(real);
    if (!st.isFile() || st.size === 0 || st.size > MAX_SCAN_BYTES) {
      log.info('doctor: skipping scan', { path: real, size: st.size });
      return { ...none, path: real };
    }
  } catch (err) {
    log.info('doctor: cannot stat binary', {
      path: binaryPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return none;
  }

  const phrases = new Map<string, string>(); // lowercased -> original
  try {
    // latin1 keeps a 1:1 byte->char mapping, so ASCII message text survives
    // untouched no matter what binary bytes surround it.
    const stream = createReadStream(real, { encoding: 'latin1', highWaterMark: CHUNK_BYTES });
    let carry = '';
    for await (const chunk of stream) {
      const text = carry + (chunk as string);
      for (const p of extractLimitPhrases(text)) {
        const key = p.toLowerCase();
        if (!phrases.has(key)) phrases.set(key, p);
      }
      carry = text.slice(-OVERLAP_BYTES);
    }
  } catch (err) {
    log.warn('doctor: scan failed', {
      path: real,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...none, path: real };
  }

  const { uncovered } = checkPatternCoverage([...phrases.values()], strong, weak);
  log.info('doctor: scan complete', {
    path: real,
    phrases: phrases.size,
    uncovered: uncovered.length,
  });
  return { scanned: true, path: real, phraseCount: phrases.size, uncovered };
}
