import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/*
 * The firmware images this panel can hand out.
 *
 * Two callers need the same answer, so the lookup lives here once: the browser
 * flasher in Tools, and an AirCoins vendo asking for an over-the-air update.
 *
 * Two folders are searched so the same code works in a checkout and on a box:
 * aircoins-nodemcu/ is where the releases are committed, firmware/ is where
 * deploy/update.sh drops them.
 */

const appRoot = path.join(__dirname, '..', '..');
const firmwareDirs = [
  path.join(appRoot, 'firmware'),
  path.join(appRoot, 'aircoins-nodemcu'),
];

// Anything else - subdirectories, other extensions, traversal - never resolves.
const firmwareName = /^[A-Za-z0-9._-]+\.bin$/i;
// Only these may be pushed to a vendo. A JuanFi image sitting in the same folder
// must never be offered to an AirCoins board, whose flash slot is smaller.
const airCoinsName = /^AirCoins-v(\d+\.\d+\.\d+)\.bin$/i;

export interface FirmwareImage {
  name: string;
  size: number;
  modified: number;
  version: string;
}

export interface AirCoinsFirmware extends FirmwareImage {
  file: string;
  md5: string;
}

const md5Cache = new Map<string, { mtimeMs: number; size: number; md5: string }>();

export function firmwareFolders(): string[] {
  return firmwareDirs.slice();
}

/** Full path of an image by name, or null when it is not a plain .bin in one of the folders. */
export function findFirmware(name: string): string | null {
  if (!firmwareName.test(name)) return null;
  for (const dir of firmwareDirs) {
    const full = path.resolve(dir, name);
    if (path.dirname(full) !== path.resolve(dir)) continue;
    try {
      if (fs.statSync(full).isFile()) return full;
    } catch {
      // Not in this folder; keep looking.
    }
  }
  return null;
}

/** Every image the panel can offer, newest first. */
export function listFirmware(): FirmwareImage[] {
  const seen = new Set<string>();
  const files: FirmwareImage[] = [];

  for (const dir of firmwareDirs) {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (seen.has(name) || !firmwareName.test(name)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(path.join(dir, name));
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      seen.add(name);
      const version = name.match(/v(\d+\.\d+\.\d+)/i);
      files.push({
        name,
        size: stat.size,
        modified: stat.mtimeMs,
        version: version ? version[1] : '',
      });
    }
  }

  files.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
  return files;
}

/** 1.4.10 is newer than 1.4.9, which a string comparison gets backwards. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The newest AirCoins release on the panel, which is what an update hands out.
 *
 * Chosen by version, not by timestamp: copying a release onto the box sets a
 * fresh mtime on the oldest image just as easily as on the newest.
 */
export function latestAirCoinsFirmware(): AirCoinsFirmware | null {
  let best: AirCoinsFirmware | null = null;

  for (const image of listFirmware()) {
    if (!airCoinsName.test(image.name) || !image.version) continue;
    const file = findFirmware(image.name);
    if (!file) continue;
    if (best && compareVersions(image.version, best.version) < 0) continue;
    if (best && compareVersions(image.version, best.version) === 0 && image.modified < best.modified) continue;
    best = { ...image, file, md5: '' };
  }

  if (!best) return null;
  return { ...best, md5: firmwareMd5(best.file) };
}

/**
 * MD5 of an image, which the ESP8266 core checks before it lets the bootloader
 * swap slots - a truncated download must fail instead of booting. Cached by
 * mtime so the same file is not re-read on every heartbeat.
 */
export function firmwareMd5(file: string): string {
  const stat = fs.statSync(file);
  const cached = md5Cache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.md5;
  const md5 = crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
  md5Cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, md5 });
  return md5;
}