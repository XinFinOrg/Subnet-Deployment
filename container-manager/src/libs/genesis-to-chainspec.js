#!/usr/bin/env node
/**
 * genesis-to-chainspec.js
 *
 * Translate a go-ethereum / XDC style `genesis.json` into the OpenEthereum /
 * Erigon style `chainspec.json` consumed by this network.
 *
 * Usage:
 *   node genesis-to-chainspec.js <genesis.json> <chainspec.json> [--name <chain-name>]
 *
 *   node genesis-to-chainspec.js ../genesis.json ../chainspec.json --name xdc-mine
 *
 * Both the input and the output path are required; there are no defaults.
 *
 * From the host, as a one-off container (paths are container paths;
 * /mount/generated is the host's ./generated directory):
 *
 *   docker run --rm -v $PWD/generated:/mount/generated \
 *     xinfinorg/subnet-generator:<version> \
 *     npm run convert -- /mount/generated/genesis.json /mount/generated/chainspec.json
 *
 * Self-contained: no external dependencies.
 *
 * --------------------------------------------------------------------------
 * Every chainspec value that genesis.json can supply is read from it. The
 * DEFAULT_* tables below are fallbacks only: they apply when genesis says
 * nothing about a field.
 *
 *   genesis.config.chainId          -> params.chainId
 *   genesis.config.homesteadBlock   -> params.homesteadBlock
 *   genesis.config.eip150Block      -> params.eip150Transition
 *   genesis.config.eip155Block      -> params.eip155Transition
 *   genesis.config.eip158Block      -> params.eip158Transition, eip160Transition
 *   genesis.config.byzantiumBlock   -> params.byzantiumBlock
 *   the remaining EIP transitions come from the hardfork that ships them, see
 *   TRANSITION_FORKS: constantinopleBlock, istanbulBlock, berlinBlock,
 *   londonBlock (eip1559Block wins for eip1559Transition), mergeBlock,
 *   shanghaiBlock, cancunBlock, pragueBlock
 *
 *   genesis.config.XDPoS.period             -> engine.XDPoS.params.period
 *   genesis.config.XDPoS.epoch              -> engine.XDPoS.params.epoch
 *   genesis.config.XDPoS.reward             -> engine.XDPoS.params.reward
 *   genesis.config.XDPoS.rewardCheckpoint   -> engine.XDPoS.params.rewardCheckpoint
 *   genesis.config.XDPoS.gap                -> engine.XDPoS.params.gap
 *   genesis.config.XDPoS.foudationWalletAddr-> engine.XDPoS.params.foundationWalletAddr (typo fixed, lowercased)
 *   genesis.config.XDPoS.v2.switchEpoch     -> engine.XDPoS.params.switchEpoch (also accepts "SwitchEpoch")
 *   genesis.config.XDPoS.v2.switchBlock     -> engine.XDPoS.params.switchBlock (also accepts "SwitchBlock")
 *   genesis.config.XDPoS.v2.allConfigs.*    -> engine.XDPoS.params.v2Configs[]
 *     (TODO: the masternode/protector/observer reward amounts are zeroed, not
 *      carried — see translate())
 *   genesis.config.tip2019Block                -> engine.XDPoS.params.tip2019Block
 *   genesis.config.dynamicGasLimitBlock        -> engine.XDPoS.params.DynamicGasLimitBlock
 *   genesis.config.tipXDCXBlock                -> engine.XDPoS.params.TipXDCX
 *   genesis.config.denylistBlock               -> engine.XDPoS.params.blackListHFNumber
 *   genesis.config.tipTRC21FeeBlock            -> engine.XDPoS.params.TipTrc21Fee
 *   genesis.config.tipXDCXMinerDisableBlock    -> engine.XDPoS.params.TIPXDCXMinerDisable
 *   genesis.config.tipXDCXReceiverDisableBlock -> engine.XDPoS.params.TIPXDCXReceiverDisable
 *
 *   genesis.{nonce,timestamp,extraData,gasLimit,difficulty,mixHash,
 *            coinbase,number,gasUsed,parentHash}  -> genesis.* (verbatim)
 *   genesis.baseFeePerGas (null)                  -> genesis.baseFeePerGas (DEFAULT_BASE_FEE_PER_GAS)
 *
 *   genesis.alloc  -> accounts (verbatim: code / storage / balance)
 *
 * Not derivable from genesis, so always DEFAULT_ENGINE / DEFAULT_PARAMS:
 *   mergeSignRange, RangeReturnSigner, blackListedAddresses, the contract
 *   binaries (they live in XDC's common constants, not in genesis), and
 *   eip1559ElasticityMultiplier.
 *
 * Present in genesis but with no counterpart in the chainspec schema, so
 * dropped rather than invented: v2 expTimeoutConfig, maxMasternodesV2,
 * SkipV1Validation, osakaBlock, and the trc21IssuerSMC / xdcxListingSMC /
 * relayerRegistrationSMC / lendingRegistrationSMC addresses.
 *
 * Prague (pragueBlock) maps to exactly the three EIPs XDPoSChain gates on it:
 * 2935, 7623 and 7702 — see TRANSITION_FORKS for what is deliberately left
 * out. Unlike every other fork here these keys have no DEFAULT_PARAMS entry,
 * so a genesis that says nothing about pragueBlock (XDC mainnet, chainId 50)
 * omits them from the chainspec entirely and Prague stays off, rather than
 * silently switching on at block 0.
 *
 * Prague also needs the EIP-2935 history contract to exist in state; this
 * script warns when genesis would leave it missing. See checkPrague().
 * --------------------------------------------------------------------------
 */

'use strict';

const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ *
 * Defaults — values present in chainspec.json that are NOT derivable
 * from genesis.json. Override here if the target network differs.
 * ------------------------------------------------------------------ */

const DEFAULT_CHAIN_NAME = 'xdpos-chain';

// chainspec.genesis.baseFeePerGas is a concrete value while genesis.json has null.
const DEFAULT_BASE_FEE_PER_GAS = '0x2e90edd00';

// EIP-2935 history storage contract: a ring buffer of the last
// 8191 block hashes, written once per block by a system call from
// 0xfffffffffffffffffffffffffffffffffffffffe.
//
// It is a plain account with fixed bytecode, not a precompile, so the code has
// to reach state somehow, and every client on the chain has to agree on when
// it got there. XDPoSChain deploys it itself at the Prague block if the account
// has no code (core/state_processor.go, ProcessParentBlockHash). Nethermind's
// XdcBlockhashStore may or may not do the same — it does carry this bytecode as
// a literal, so do not assume either way without testing the specific build.
//
// Pre-allocating the account sidesteps the question: both clients then start
// from identical state and neither has to deploy anything. That is how
// Ethereum's Hoodi genesis and XDPoSChain's own DeveloperGenesisBlock do it.
// Leaving it out has been observed to fork a mixed XDPoSChain/Nethermind
// network at block 1 — different state roots, no quorum, nothing committed.
const HISTORY_STORAGE_ADDRESS = '0x0000f90827f1c53a10cb7a02335b175320002935';
const HISTORY_STORAGE_CODE =
  '0x3373fffffffffffffffffffffffffffffffffffffffe14604657602036036042575f35600143038111604257611fff81430311604257611fff9006545f5260205ff35b5f5ffd5b5f35611fff60014303065500';

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
  RangeReturnSigner: 150,
  tip2019Block: 1,
  DynamicGasLimitBlock: 0,
  TipXDCX: 0,
  blackListHFNumber: 0,
  TipTrc21Fee: 0,
  TIPXDCXMinerDisable: 0,
  TIPXDCXReceiverDisable: 0,
  blackListedAddresses: ['0x0000000000000000000000000000000000000011'],
  masternodeVotingContract: '0x0000000000000000000000000000000000000088',
  blockSignerContract: '0x0000000000000000000000000000000000000089',
  randomizeSMCBinary: '0x0000000000000000000000000000000000000090',
  XDCXAddressBinary: '0x0000000000000000000000000000000000000091',
  TradingStateAddressBinary: '0x0000000000000000000000000000000000000092',
  XDCXLendingAddressBinary: '0x0000000000000000000000000000000000000093',
  XDCXLendingFinalizedTradeAddressBinary: '0x0000000000000000000000000000000000000094',
};

// Which hardfork block in genesis.config activates each chainspec transition.
// The EIPs of a fork all switch on at that fork's block; when genesis does not
// mention the fork, the DEFAULT_PARAMS entry stands in. Order matters: it is
// the key order of the generated params object.
const TRANSITION_FORKS = {
  eip160Transition: 'eip158Block', // Spurious Dragon, same block as EIP-158
  eip145Transition: 'constantinopleBlock',
  eip1014Transition: 'constantinopleBlock',
  eip1052Transition: 'constantinopleBlock',
  eip1234Transition: 'constantinopleBlock',
  eip1283Transition: 'constantinopleBlock',
  eip152Transition: 'istanbulBlock',
  eip1108Transition: 'istanbulBlock',
  eip1344Transition: 'istanbulBlock',
  eip1884Transition: 'istanbulBlock',
  eip2028Transition: 'istanbulBlock',
  eip2200Transition: 'istanbulBlock',
  eip2565Transition: 'berlinBlock',
  eip2718Transition: 'berlinBlock',
  eip2930Transition: 'berlinBlock',
  eip1559Transition: 'londonBlock', // eip1559Block takes precedence, see below
  eip2929Transition: 'berlinBlock',
  eip3198Transition: 'londonBlock',
  eip3529Transition: 'londonBlock',
  eip3541Transition: 'londonBlock',
  eip3554Transition: 'londonBlock',
  eip4399Transition: 'mergeBlock',
  eip3651Transition: 'shanghaiBlock',
  eip3855Transition: 'shanghaiBlock',
  eip3860Transition: 'shanghaiBlock',
  eip6049Transition: 'shanghaiBlock',
  eip1153Transition: 'cancunBlock',
  eip4844Transition: 'cancunBlock',
  eip5656Transition: 'cancunBlock',
  eip6780Transition: 'cancunBlock',
  eip7516Transition: 'cancunBlock',
  // Prague. These three are the whole of what XDPoSChain gates on IsPrague:
  // 2935 (history contract), 7623 (calldata floor cost) and 7702 (setcode tx,
  // the only opcode-level change — newPragueInstructionSet is Cancun plus
  // enable7702). Deliberately absent, because XDPoSChain does not implement
  // them and switching them on for Nethermind alone would reintroduce exactly
  // the state-root divergence this mapping exists to prevent:
  //   2537 (BLS precompiles) — activePrecompiledContracts has no Prague case,
  //                            it falls through to the EIP-1559 set
  //   4788 / 6110 / 7002 / 7251 / 7685 — beacon-chain EIPs; 7685 would also
  //                            add requestsHash to the block header
  // No DEFAULT_PARAMS fallback on purpose: absent pragueBlock => key omitted.
  eip2935Transition: 'pragueBlock',
  eip7623Transition: 'pragueBlock',
  eip7702Transition: 'pragueBlock',
};

/* ------------------------------------------------------------------ *
 * Value selection
 * ------------------------------------------------------------------ */

// First value genesis actually states wins; a default is only reached when
// every candidate is absent. Not `||` — 0 and false are real values here.
function pick(...candidates) {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null) {
      return candidate;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Address normalization
 * ------------------------------------------------------------------ */

// Lowercase, 0x-prefixed. Clients accept this fine; we don't bother with the
// cosmetic EIP-55 mixed-case checksum.
function normalizeAddress(addr) {
  return '0x' + String(addr).toLowerCase().replace(/^0x/, '');
}

/* ------------------------------------------------------------------ *
 * Prague / EIP-2935 sanity check
 * ------------------------------------------------------------------ */

// Emitting the Prague transitions is necessary but not sufficient: every client
// on the chain must also agree on how the history contract got into state.
// Returns the lines of a warning, or [] when there is nothing to report.
// Advisory only — the chainspec is still written, because this script's job is
// to translate genesis faithfully, not to edit the chain.
function checkPrague(genesis) {
  const pragueBlock = (genesis.config || {}).pragueBlock;
  if (pragueBlock === undefined || pragueBlock === null) {
    return []; // Prague never activates; nothing to check.
  }

  const alloc = genesis.alloc || {};
  const present = Object.keys(alloc).some(
    (addr) => normalizeAddress(addr) === HISTORY_STORAGE_ADDRESS
  );
  if (present) {
    return [];
  }

  if (pragueBlock !== 0) {
    // Genesis cannot help here: the contract is supposed to appear at the fork
    // block, which is already in the chain's future or past.
    return [
      `Prague activates mid-chain at block ${pragueBlock}, so the EIP-2935 history`,
      `contract at ${HISTORY_STORAGE_ADDRESS} cannot be supplied via genesis.alloc.`,
      'XDPoSChain self-deploys it at that block. Confirm every other client on',
      'the chain does the same, or they will fork there.',
    ];
  }

  return [
    'Prague is active from block 0, but genesis.alloc has no EIP-2935 history',
    `contract at ${HISTORY_STORAGE_ADDRESS}.`,
    '',
    'XDPoSChain deploys it at block 1 and writes the parent hash into it. A',
    'second client that does not do exactly the same thing computes a different',
    'state root for every block, no quorum forms, and the chain stalls without',
    'ever committing a block — this has been observed against Nethermind.',
    '',
    'Pre-allocating the account avoids relying on either client to deploy it.',
    'Add this to genesis.alloc, then re-run this converter so it also reaches',
    'chainspec.accounts (both files must match, or the genesis hashes differ):',
    '',
    `  "${HISTORY_STORAGE_ADDRESS.replace(/^0x/, '')}": {`,
    '    "balance": "0x0",',
    '    "nonce": "0x1",',
    `    "code": "${HISTORY_STORAGE_CODE}"`,
    '  }',
  ];
}

/* ------------------------------------------------------------------ *
 * Translation
 * ------------------------------------------------------------------ */

function translate(genesis, opts = {}) {
  const cfg = genesis.config || {};
  const xdpos = cfg.XDPoS || {};
  const v2 = xdpos.v2 || {};

  // --- engine.XDPoS.params ---
  // Every per-round field is carried through as genesis states it, with two
  // exceptions: expTimeoutConfig, which the chainspec schema has no key for and
  // so is dropped rather than invented, and the reward amounts below.
  const v2Configs = Object.keys(v2.allConfigs || {})
    .sort((a, b) => Number(a) - Number(b))
    .map((round) => {
      const { expTimeoutConfig, ...rest } = v2.allConfigs[round];

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
    // no genesis counterpart: node-level constants, not chain data
    mergeSignRange: DEFAULT_ENGINE.mergeSignRange,
    RangeReturnSigner: DEFAULT_ENGINE.RangeReturnSigner,
    // XDC hardfork blocks, named differently on each side
    tip2019Block: pick(cfg.tip2019Block, DEFAULT_ENGINE.tip2019Block),
    DynamicGasLimitBlock: pick(cfg.dynamicGasLimitBlock, DEFAULT_ENGINE.DynamicGasLimitBlock),
    TipXDCX: pick(cfg.tipXDCXBlock, DEFAULT_ENGINE.TipXDCX),
    blackListHFNumber: pick(cfg.denylistBlock, DEFAULT_ENGINE.blackListHFNumber),
    TipTrc21Fee: pick(cfg.tipTRC21FeeBlock, DEFAULT_ENGINE.TipTrc21Fee),
    TIPXDCXMinerDisable: pick(cfg.tipXDCXMinerDisableBlock, DEFAULT_ENGINE.TIPXDCXMinerDisable),
    TIPXDCXReceiverDisable: pick(
      cfg.tipXDCXReceiverDisableBlock,
      DEFAULT_ENGINE.TIPXDCXReceiverDisable
    ),
    blackListedAddresses: DEFAULT_ENGINE.blackListedAddresses,
    masternodeVotingContract: DEFAULT_ENGINE.masternodeVotingContract,
    blockSignerContract: DEFAULT_ENGINE.blockSignerContract,
    randomizeSMCBinary: DEFAULT_ENGINE.randomizeSMCBinary,
    XDCXAddressBinary: DEFAULT_ENGINE.XDCXAddressBinary,
    TradingStateAddressBinary: DEFAULT_ENGINE.TradingStateAddressBinary,
    XDCXLendingAddressBinary: DEFAULT_ENGINE.XDCXLendingAddressBinary,
    XDCXLendingFinalizedTradeAddressBinary: DEFAULT_ENGINE.XDCXLendingFinalizedTradeAddressBinary,
  };

  // --- params (chain rules / EIP transitions) ---
  const params = {
    chainId: cfg.chainId,
    homesteadBlock: cfg.homesteadBlock,
    eip150Transition: cfg.eip150Block,
    eip155Transition: cfg.eip155Block,
    eip158Transition: cfg.eip158Block,
  };
  for (const [key, forkBlock] of Object.entries(TRANSITION_FORKS)) {
    params[key] = pick(cfg[forkBlock], DEFAULT_PARAMS[key]);
  }
  // genesis states EIP-1559 on its own key as well as through londonBlock
  params.eip1559Transition = pick(
    cfg.eip1559Block,
    cfg.londonBlock,
    DEFAULT_PARAMS.eip1559Transition
  );
  params.byzantiumBlock = cfg.byzantiumBlock;
  // no genesis counterpart
  params.eip1559ElasticityMultiplier = DEFAULT_PARAMS.eip1559ElasticityMultiplier;

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

const USAGE =
  'Usage: node genesis-to-chainspec.js <genesis.json> <chainspec.json> [--name <name>] [--base-fee <0x..>]\n' +
  '       npm run convert -- <genesis.json> <chainspec.json> [--name <name>] [--base-fee <0x..>]\n' +
  'Both paths are required. Relative paths resolve against the current working\n' +
  'directory (/app when invoked through npm inside the container), so prefer\n' +
  'absolute paths such as /mount/generated/genesis.json.';

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
      console.log(USAGE);
      return 0;
    } else {
      positional.push(args[i]);
    }
  }

  if (positional.length < 2) {
    console.error(
      positional.length === 0
        ? 'Error: missing input genesis.json and output chainspec.json paths.'
        : 'Error: missing output chainspec.json path.'
    );
    console.error(USAGE);
    return 1;
  }
  if (positional.length > 2) {
    console.error(`Error: unexpected extra argument "${positional[2]}".`);
    console.error(USAGE);
    return 1;
  }

  const inPath = path.resolve(positional[0]);
  const outPath = path.resolve(positional[1]);

  let genesis;
  try {
    genesis = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  } catch (e) {
    console.error(`Error: cannot read genesis from ${inPath}: ${e.message}`);
    return 1;
  }

  const chainspec = translate(genesis, opts);
  const json = JSON.stringify(chainspec, null, 2) + '\n';

  const pragueWarning = checkPrague(genesis);
  if (pragueWarning.length) {
    console.error('');
    console.error('WARNING: Prague is enabled but the EIP-2935 history contract is missing.');
    for (const line of pragueWarning) {
      console.error(line ? `  ${line}` : '');
    }
    console.error('');
  }

  try {
    fs.writeFileSync(outPath, json);
  } catch (e) {
    console.error(`Error: cannot write chainspec to ${outPath}: ${e.message}`);
    return 1;
  }
  console.error(`Wrote ${outPath} (${chainspec.params.chainId ? 'chainId ' + chainspec.params.chainId : ''}).`);
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { translate, normalizeAddress, checkPrague };
