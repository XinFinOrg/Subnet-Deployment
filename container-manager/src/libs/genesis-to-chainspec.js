#!/usr/bin/env node
/**
 * genesis-to-chainspec.js
 *
 * Translate a go-ethereum / XDC style `genesis.json` into the OpenEthereum /
 * Erigon style `chainspec.json` consumed by this network.
 *
 * Usage:
 *   node genesis-to-chainspec.js <genesis.json> [chainspec.json] [--name <chain-name>]
 *
 *   node genesis-to-chainspec.js ../genesis.json ../chainspec.json --name xdc-mine
 *
 * If the output path is omitted the result is printed to stdout.
 *
 * Self-contained: no external dependencies.
 *
 * --------------------------------------------------------------------------
 * Mapping summary (see README at bottom of file for the full diff rationale):
 *
 *   genesis.config.chainId          -> params.chainId
 *   genesis.config.homesteadBlock   -> params.homesteadBlock
 *   genesis.config.eip150Block      -> params.eip150Transition
 *   genesis.config.eip155Block      -> params.eip155Transition
 *   genesis.config.eip158Block      -> params.eip158Transition
 *   genesis.config.byzantiumBlock   -> params.byzantiumBlock
 *   (all remaining EIP transitions come from DEFAULT_PARAMS)
 *
 *   genesis.config.XDPoS.period             -> engine.XDPoS.params.period
 *   genesis.config.XDPoS.epoch              -> engine.XDPoS.params.epoch
 *   genesis.config.XDPoS.reward             -> engine.XDPoS.params.reward
 *   genesis.config.XDPoS.rewardCheckpoint   -> engine.XDPoS.params.rewardCheckpoint
 *   genesis.config.XDPoS.gap                -> engine.XDPoS.params.gap
 *   genesis.config.XDPoS.foudationWalletAddr-> engine.XDPoS.params.foundationWalletAddr (typo fixed, lowercased)
 *   genesis.config.XDPoS.v2.switchEpoch     -> engine.XDPoS.params.switchEpoch (also accepts "SwitchEpoch")
 *   genesis.config.XDPoS.v2.switchBlock     -> engine.XDPoS.params.switchBlock (also accepts "SwitchBlock")
 *   genesis.config.XDPoS.v2.allConfigs.*    -> engine.XDPoS.params.v2Configs[] (expTimeoutConfig dropped)
 *   (the engine constants — contract addresses, mergeSignRange, blacklist, etc. — come from DEFAULT_ENGINE)
 *
 *   genesis.{nonce,timestamp,extraData,gasLimit,difficulty,mixHash,
 *            coinbase,number,gasUsed,parentHash}  -> genesis.* (verbatim)
 *   genesis.baseFeePerGas (null)                  -> genesis.baseFeePerGas (DEFAULT_BASE_FEE_PER_GAS)
 *
 *   genesis.alloc  -> accounts (verbatim: code / storage / balance)
 * --------------------------------------------------------------------------
 */

'use strict';

const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ *
 * Defaults — values present in chainspec.json that are NOT derivable
 * from genesis.json. Override here if the target network differs.
 * ------------------------------------------------------------------ */

const DEFAULT_CHAIN_NAME = 'xdc-mine';

// chainspec.genesis.baseFeePerGas is a concrete value while genesis.json has null.
const DEFAULT_BASE_FEE_PER_GAS = '0x2e90edd00';

// All EIP transitions in chainspec.params that don't come straight from
// genesis.config. Values copied from the reference chainspec.json.
const DEFAULT_PARAMS = {
  eip160Transition: 0,
  eip145Transition: 0,
  eip1014Transition: 0,
  eip1052Transition: 0,
  eip1234Transition: 0,
  eip1283Transition: 0,
  eip152Transition: 0,
  eip1108Transition: 0,
  eip1344Transition: 0,
  eip1884Transition: 0,
  eip2028Transition: 999999999999,
  eip2200Transition: 0,
  eip2565Transition: 0,
  eip2718Transition: 0,
  eip2930Transition: 0,
  eip1559Transition: 0,
  eip2929Transition: 0,
  eip3198Transition: 0,
  eip3529Transition: 0,
  eip3541Transition: 0,
  eip3554Transition: 0,
  eip4399Transition: 0,
  eip3651Transition: 0,
  eip3855Transition: 0,
  eip3860Transition: 0,
  eip6049Transition: 0,
  eip1153Transition: 0,
  eip4844Transition: 0,
  eip5656Transition: 0,
  eip6780Transition: 0,
  eip7516Transition: 0,
  eip1559ElasticityMultiplier: '0x1',
};

// Engine constants not present in genesis.json (copied from chainspec.json).
const DEFAULT_ENGINE = {
  mergeSignRange: 15,
  tip2019Block: 1,
  DynamicGasLimitBlock: 0,
  blackListHFNumber: 0,
  blackListedAddresses: ['0x0000000000000000000000000000000000000011'],
  masternodeVotingContract: '0x0000000000000000000000000000000000000088',
  randomizeSMCBinary: '0x0000000000000000000000000000000000000090',
  blockSignerContract: '0x0000000000000000000000000000000000000089',
};

/* ------------------------------------------------------------------ *
 * Address normalization
 * ------------------------------------------------------------------ */

// Lowercase, 0x-prefixed. Clients accept this fine; we don't bother with the
// cosmetic EIP-55 mixed-case checksum.
function normalizeAddress(addr) {
  return '0x' + String(addr).toLowerCase().replace(/^0x/, '');
}

/* ------------------------------------------------------------------ *
 * Translation
 * ------------------------------------------------------------------ */

function translate(genesis, opts = {}) {
  const cfg = genesis.config || {};
  const xdpos = cfg.XDPoS || {};
  const v2 = xdpos.v2 || {};

  // --- engine.XDPoS.params ---
  const v2Configs = Object.keys(v2.allConfigs || {})
    .sort((a, b) => Number(a) - Number(b))
    .map((round) => {
      const { expTimeoutConfig, ...rest } = v2.allConfigs[round]; // drop expTimeoutConfig
      return rest;
    });

  const enginePadms = {
    period: xdpos.period,
    epoch: xdpos.epoch,
    reward: xdpos.reward,
    rewardCheckpoint: xdpos.rewardCheckpoint,
    gap: xdpos.gap,
    // note: genesis spells the key "foudationWalletAddr" (sic)
    foundationWalletAddr: normalizeAddress(xdpos.foudationWalletAddr || xdpos.foundationWalletAddr),
    // genesis spells this either "switchEpoch" (newer) or "SwitchEpoch" (older).
    // Use ?? not || — the valid value is 0, which is falsy.
    switchEpoch: v2.switchEpoch ?? v2.SwitchEpoch,
    switchBlock: v2.switchBlock ?? v2.SwitchBlock,
    v2Configs,
    mergeSignRange: DEFAULT_ENGINE.mergeSignRange,
    tip2019Block: DEFAULT_ENGINE.tip2019Block,
    DynamicGasLimitBlock: DEFAULT_ENGINE.DynamicGasLimitBlock,
    blackListHFNumber: DEFAULT_ENGINE.blackListHFNumber,
    blackListedAddresses: DEFAULT_ENGINE.blackListedAddresses,
    masternodeVotingContract: DEFAULT_ENGINE.masternodeVotingContract,
    randomizeSMCBinary: DEFAULT_ENGINE.randomizeSMCBinary,
    blockSignerContract: DEFAULT_ENGINE.blockSignerContract,
  };

  // --- params (chain rules / EIP transitions) ---
  const params = {
    chainId: cfg.chainId,
    homesteadBlock: cfg.homesteadBlock,
    eip150Transition: cfg.eip150Block,
    eip155Transition: cfg.eip155Block,
    eip158Transition: cfg.eip158Block,
    eip160Transition: DEFAULT_PARAMS.eip160Transition,
    eip145Transition: DEFAULT_PARAMS.eip145Transition,
    eip1014Transition: DEFAULT_PARAMS.eip1014Transition,
    eip1052Transition: DEFAULT_PARAMS.eip1052Transition,
    eip1234Transition: DEFAULT_PARAMS.eip1234Transition,
    eip1283Transition: DEFAULT_PARAMS.eip1283Transition,
    eip152Transition: DEFAULT_PARAMS.eip152Transition,
    eip1108Transition: DEFAULT_PARAMS.eip1108Transition,
    eip1344Transition: DEFAULT_PARAMS.eip1344Transition,
    eip1884Transition: DEFAULT_PARAMS.eip1884Transition,
    eip2028Transition: DEFAULT_PARAMS.eip2028Transition,
    eip2200Transition: DEFAULT_PARAMS.eip2200Transition,
    eip2565Transition: DEFAULT_PARAMS.eip2565Transition,
    eip2718Transition: DEFAULT_PARAMS.eip2718Transition,
    eip2930Transition: DEFAULT_PARAMS.eip2930Transition,
    eip1559Transition: DEFAULT_PARAMS.eip1559Transition,
    eip2929Transition: DEFAULT_PARAMS.eip2929Transition,
    eip3198Transition: DEFAULT_PARAMS.eip3198Transition,
    eip3529Transition: DEFAULT_PARAMS.eip3529Transition,
    eip3541Transition: DEFAULT_PARAMS.eip3541Transition,
    eip3554Transition: DEFAULT_PARAMS.eip3554Transition,
    eip4399Transition: DEFAULT_PARAMS.eip4399Transition,
    eip3651Transition: DEFAULT_PARAMS.eip3651Transition,
    eip3855Transition: DEFAULT_PARAMS.eip3855Transition,
    eip3860Transition: DEFAULT_PARAMS.eip3860Transition,
    eip6049Transition: DEFAULT_PARAMS.eip6049Transition,
    eip1153Transition: DEFAULT_PARAMS.eip1153Transition,
    eip4844Transition: DEFAULT_PARAMS.eip4844Transition,
    eip5656Transition: DEFAULT_PARAMS.eip5656Transition,
    eip6780Transition: DEFAULT_PARAMS.eip6780Transition,
    eip7516Transition: DEFAULT_PARAMS.eip7516Transition,
    byzantiumBlock: cfg.byzantiumBlock,
    eip1559ElasticityMultiplier: DEFAULT_PARAMS.eip1559ElasticityMultiplier,
  };

  // --- genesis block header ---
  const block = {
    nonce: genesis.nonce,
    timestamp: genesis.timestamp,
    extraData: genesis.extraData,
    gasLimit: genesis.gasLimit,
    difficulty: genesis.difficulty,
    mixHash: genesis.mixHash,
    coinbase: genesis.coinbase,
    number: genesis.number,
    gasUsed: genesis.gasUsed,
    parentHash: genesis.parentHash,
    baseFeePerGas:
      genesis.baseFeePerGas == null
        ? (opts.baseFeePerGas || DEFAULT_BASE_FEE_PER_GAS)
        : genesis.baseFeePerGas,
  };

  return {
    name: opts.name || DEFAULT_CHAIN_NAME,
    engine: { XDPoS: { params: enginePadms } },
    params,
    genesis: block,
    nodes: opts.nodes || [],
    accounts: genesis.alloc || {},
  };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function main(argv) {
  const args = argv.slice(2);
  const positional = [];
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name') {
      opts.name = args[++i];
    } else if (args[i] === '--base-fee') {
      opts.baseFeePerGas = args[++i];
    } else if (args[i] === '-h' || args[i] === '--help') {
      console.log('Usage: node genesis-to-chainspec.js <genesis.json> [chainspec.json] [--name <name>] [--base-fee <0x..>]');
      return 0;
    } else {
      positional.push(args[i]);
    }
  }

  if (positional.length < 1) {
    console.error('Error: missing input genesis.json path.');
    console.error('Usage: node genesis-to-chainspec.js <genesis.json> [chainspec.json] [--name <name>]');
    return 1;
  }

  const inPath = path.resolve(positional[0]);
  const outPath = positional[1] ? path.resolve(positional[1]) : null;

  const genesis = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const chainspec = translate(genesis, opts);
  const json = JSON.stringify(chainspec, null, 2) + '\n';

  if (outPath) {
    fs.writeFileSync(outPath, json);
    console.error(`Wrote ${outPath} (${chainspec.params.chainId ? 'chainId ' + chainspec.params.chainId : ''}).`);
  } else {
    process.stdout.write(json);
  }
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { translate, normalizeAddress };
