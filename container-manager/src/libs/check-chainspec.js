#!/usr/bin/env node
/**
 * check-chainspec.js
 *
 * Pre-boot sanity check: re-run the genesis -> chainspec translation and compare
 * the result against the chainspec.json a deployment is about to hand to its
 * Nethermind nodes. A mismatch means the two files describe different chains —
 * booting on it gives nodes that never agree on the genesis block.
 *
 * On a mismatch the stale chainspec is moved into an `archive/` directory next
 * to it, named with a UTC timestamp, and replaced with the one genesis.json
 * translates to. Pass --dry-run to report without touching anything.
 *
 * Usage:
 *   node check-chainspec.js <genesis.json> <chainspec.json> [--dry-run] [--name <name>] [--base-fee <0x..>]
 *
 * Both paths are required; there are no defaults. Pass --name / --base-fee when
 * the chainspec was produced with those flags, otherwise the translator defaults
 * are used (which is what the deployment pipeline does).
 *
 * Exit codes:
 *   0  chainspec.json already matches genesis.json, nothing was touched
 *   3  they differed (differences are listed, and the chainspec was replaced
 *      unless --dry-run) — worth a look before booting
 *   2  a file is missing / unreadable / not valid JSON, or the replace failed
 *
 * 3 rather than 1 for "differed": this usually runs inside a container, where
 * 1 is also what node exits with when it crashes, so a caller could not tell a
 * replaced chainspec from a broken run.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { translate } = require('./genesis-to-chainspec');

const EXIT_DIFFERED = 3;
const MAX_REPORTED = 20;
const MAX_VALUE_LEN = 60;

/* ------------------------------------------------------------------ *
 * Deep comparison
 * ------------------------------------------------------------------ */

// Sentinel for "this key does not exist here at all", so a missing key reads
// differently from a key explicitly set to undefined/null.
const ABSENT = Symbol('absent');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function formatValue(v) {
  if (v === ABSENT) return '(missing)';
  const s = JSON.stringify(v);
  if (s === undefined) return String(v);
  return s.length > MAX_VALUE_LEN ? s.slice(0, MAX_VALUE_LEN) + '…' : s;
}

// Collect every path where `expected` (derived from genesis) and `actual`
// (chainspec on disk) disagree.
function collectDiffs(expected, actual, prefix, out) {
  if (expected === ABSENT || actual === ABSENT) {
    out.push({ path: prefix, expected, actual });
    return;
  }

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      out.push({ path: prefix, expected, actual });
      return;
    }
    const len = Math.max(expected.length, actual.length);
    for (let i = 0; i < len; i++) {
      collectDiffs(
        i < expected.length ? expected[i] : ABSENT,
        i < actual.length ? actual[i] : ABSENT,
        `${prefix}[${i}]`,
        out
      );
    }
    return;
  }

  if (isPlainObject(expected) || isPlainObject(actual)) {
    if (!isPlainObject(expected) || !isPlainObject(actual)) {
      out.push({ path: prefix, expected, actual });
      return;
    }
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      collectDiffs(
        key in expected ? expected[key] : ABSENT,
        key in actual ? actual[key] : ABSENT,
        prefix ? `${prefix}.${key}` : key,
        out
      );
    }
    return;
  }

  if (expected !== actual) {
    out.push({ path: prefix, expected, actual });
  }
}

/**
 * Compare a chainspec against the one genesis.json translates to.
 * Returns { expected, diffs }; diffs is empty when they match.
 */
function compare(genesis, chainspec, opts = {}) {
  // Round-trip through JSON so keys translate() leaves undefined are dropped
  // the same way they are when the chainspec is written to disk.
  const expected = JSON.parse(JSON.stringify(translate(genesis, opts)));
  const diffs = [];
  collectDiffs(expected, chainspec, '', diffs);
  return { expected, diffs };
}

/* ------------------------------------------------------------------ *
 * Archiving
 * ------------------------------------------------------------------ */

// UTC so the ordering of archived files is unambiguous across machines.
function timestamp(date) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}

// archive/<name>.<timestamp>.json, with a counter if that name is taken (two
// runs inside the same second).
function archivePath(filePath, date) {
  const dir = path.join(path.dirname(filePath), 'archive');
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const stamp = timestamp(date);
  let candidate = path.join(dir, `${base}.${stamp}${ext}`);
  for (let i = 2; fs.existsSync(candidate); i++) {
    candidate = path.join(dir, `${base}.${stamp}.${i}${ext}`);
  }
  return candidate;
}

/**
 * Move the current chainspec into archive/ and write the expected one in its
 * place. Returns the path the old file was archived to.
 */
function replaceChainspec(chainspecPath, expected, date) {
  const backup = archivePath(chainspecPath, date);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(chainspecPath, backup);
  fs.writeFileSync(chainspecPath, JSON.stringify(expected, null, 2) + '\n');
  return backup;
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const USAGE =
  'Usage: node check-chainspec.js <genesis.json> <chainspec.json> [--dry-run] [--name <name>] [--base-fee <0x..>]\n' +
  'Both paths are required. A differing chainspec is archived and replaced,\n' +
  'unless --dry-run is given.\n' +
  'Exit code: 0 already matched, 3 differed, 2 error.';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Report paths relative to the working directory when they sit under it. The
// check usually runs in a container with the deployment folder bind-mounted, so
// absolute paths would be the container's, not the ones the operator knows.
function display(filePath) {
  const rel = path.relative(process.cwd(), filePath);
  return rel && !rel.startsWith('..') ? rel : filePath;
}

function main(argv) {
  const args = argv.slice(2);
  const positional = [];
  const opts = {};
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name') {
      opts.name = args[++i];
    } else if (args[i] === '--base-fee') {
      opts.baseFeePerGas = args[++i];
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '-h' || args[i] === '--help') {
      console.log(USAGE);
      return 0;
    } else {
      positional.push(args[i]);
    }
  }

  if (positional.length !== 2) {
    console.error(
      positional.length < 2
        ? 'Error: both the genesis.json and the chainspec.json path are required.'
        : `Error: unexpected extra argument "${positional[2]}".`
    );
    console.error(USAGE);
    return 2;
  }

  const genesisPath = path.resolve(positional[0]);
  const chainspecPath = path.resolve(positional[1]);

  let genesis;
  let chainspec;
  try {
    genesis = readJson(genesisPath);
  } catch (e) {
    console.error(`Error: cannot read genesis from ${display(genesisPath)}: ${e.message}`);
    return 2;
  }
  try {
    chainspec = readJson(chainspecPath);
  } catch (e) {
    console.error(`Error: cannot read chainspec from ${display(chainspecPath)}: ${e.message}`);
    return 2;
  }

  let expected;
  let diffs;
  try {
    ({ expected, diffs } = compare(genesis, chainspec, opts));
  } catch (e) {
    console.error(`Error: cannot translate ${display(genesisPath)}: ${e.message}`);
    return 2;
  }

  if (diffs.length === 0) {
    console.log(
      `OK: ${display(chainspecPath)} matches ${display(genesisPath)}` +
        (chainspec.params && chainspec.params.chainId ? ` (chainId ${chainspec.params.chainId})` : '')
    );
    return 0;
  }

  console.log(
    `MISMATCH: ${display(chainspecPath)} does not match ${display(genesisPath)} ` +
      `(${diffs.length} difference${diffs.length === 1 ? '' : 's'})`
  );
  for (const d of diffs.slice(0, MAX_REPORTED)) {
    console.log(
      `  ${d.path || '(root)'}: from genesis ${formatValue(d.expected)}, ` +
        `in chainspec ${formatValue(d.actual)}`
    );
  }
  if (diffs.length > MAX_REPORTED) {
    console.log(`  ... and ${diffs.length - MAX_REPORTED} more`);
  }

  if (dryRun) {
    console.log('--dry-run: nothing was changed. Drop the flag to archive and replace it.');
    return EXIT_DIFFERED;
  }

  let backup;
  try {
    backup = replaceChainspec(chainspecPath, expected, new Date());
  } catch (e) {
    console.error(`Error: cannot replace ${display(chainspecPath)}: ${e.message}`);
    return 2;
  }
  console.log(`Archived the old chainspec to ${display(backup)}`);
  console.log(`Replaced ${display(chainspecPath)} with the one generated from ${display(genesisPath)}`);
  console.log(
    'Nodes that already ran on the old chainspec keep chain data built from it; ' +
      'wipe their data directories before booting if the genesis block changed.'
  );
  return EXIT_DIFFERED;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { compare };
