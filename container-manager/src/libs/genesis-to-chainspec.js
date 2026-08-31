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
 *   genesis.config.tipSigningBlock             -> engine.XDPoS.params.TipSigningBlock
 *   genesis.config.tipRandomizeBlock           -> engine.XDPoS.params.TipRandomizeBlock
 *   genesis.config.tipIncreaseMasternodesBlock -> engine.XDPoS.params.TipIncreaseMasternodesBlock
 *   genesis.config.tipNoHalvingMNRewardBlock   -> engine.XDPoS.params.TipNoHalvingMNRewardBlock
 *   genesis.config.tipXDCXLendingBlock         -> engine.XDPoS.params.TipXDCXLendingBlock
 *   genesis.config.tipXDCXCancellationFeeBlock -> engine.XDPoS.params.TipXDCXCancellationFeeBlock
 *   genesis.config.gas50xBlock                 -> engine.XDPoS.params.Gas50xBlock
 *   genesis.config.tipUpgradeRewardBlock       -> engine.XDPoS.params.TIPUpgradeReward
 *   genesis.config.tipUpgradePenaltyBlock      -> engine.XDPoS.params.TIPUpgradePenalty
 *   (see ENGINE_FORKS; key spellings, TIP casing included, are Nethermind's)
 *
 * Prague (pragueBlock) maps to exactly the three EIPs XDPoSChain gates on it:
 * 2935, 7623 and 7702 — see TRANSITION_FORKS. Nethermind's own reference spec
 * for Apothem (/nethermind/chainspec/xdc-testnet.json) carries the same three
 * at 83600000 and nothing else, and pre-allocates no EIP-2935 history contract,
 * so Nethermind supplies that contract itself; the transitions are all that is
 * needed.
 *
 * Neither the Prague transitions nor ENGINE_FORKS have a DEFAULT_* fallback,
 * unlike every other fork here: a fork genesis does not state is left out of
 * the chainspec so it stays off, rather than silently activating at block 0.
 * tipUpgradeRewardBlock is why that matters — it selects between two different
 * reward formulas (eth/hooks/engine_v2_hooks.go, IsTIPUpgradeReward), so
 * dropping it makes XDPoSChain and Nethermind compute different balances at the
 * first reward checkpoint and the chain stalls there for good.
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

// All EIP transitions in chainspec.params that don't come straight from
// genesis.config. Values copied from the reference chainspec.json.
const DEFAULT_PARAMS = {
  eip160Transition: 999999999999,
  eip145Transition: 999999999999,
  eip1014Transition: 999999999999,
  eip1052Transition: 999999999999,
  eip1234Transition: 999999999999,
  eip1283Transition: 999999999999,
  eip152Transition: 999999999999,
  eip1108Transition: 999999999999,
  eip1344Transition: 999999999999,
  eip1884Transition: 999999999999,
  eip2028Transition: 999999999999,
  eip2200Transition: 999999999999,
  eip2565Transition: 999999999999,
  eip2718Transition: 999999999999,
  eip2930Transition: 999999999999,
  eip1559Transition: 999999999999,
  eip2929Transition: 999999999999,
  eip3198Transition: 999999999999,
  eip3529Transition: 999999999999,
  eip3541Transition: 999999999999,
  eip3554Transition: 999999999999,
  eip4399Transition: 999999999999,
  eip3651Transition: 999999999999,
  eip3855Transition: 999999999999,
  eip3860Transition: 999999999999,
  eip6049Transition: 999999999999,
  eip1153Transition: 999999999999,
  eip4844Transition: 999999999999,
  eip5656Transition: 999999999999,
  eip6780Transition: 999999999999,
  eip7516Transition: 999999999999,
  eip1559ElasticityMultiplier: '0x1',
};

// Engine constants not present in genesis.json (copied from chainspec.json).
const DEFAULT_ENGINE = {
  mergeSignRange: 15,
  RangeReturnSigner: 150,
  tip2019Block: 1,
  DynamicGasLimitBlock: 9999999999999,
  TipXDCX: 9999999999999,
  blackListHFNumber: 9999999999999,
  TipTrc21Fee: 9999999999999,
  TIPXDCXMinerDisable: 9999999999999,
  TIPXDCXReceiverDisable: 9999999999999,
  blackListedAddresses: ['0x0000000000000000000000000000000000000011'],
  masternodeVotingContract: '0x0000000000000000000000000000000000000088',
  blockSignerContract: '0x0000000000000000000000000000000000000089',
  randomizeSMCBinary: '0x0000000000000000000000000000000000000090',
  XDCXAddressBinary: '0x0000000000000000000000000000000000000091',
  TradingStateAddressBinary: '0x0000000000000000000000000000000000000092',
  XDCXLendingAddressBinary: '0x0000000000000000000000000000000000000093',
  XDCXLendingFinalizedTradeAddressBinary: '0x0000000000000000000000000000000000000094',
};

// The XDPoSSubnet engine plugin binds DIFFERENT property names than XDPoS, so a
// subnet chainspec is not just XDPoS with a renamed engine block:
//   XDPoS                      XDPoSSubnet
//   mergeSignRange          -> MergeSignRange
//   blackListHFNumber       -> BlackListHFNumber
//   XDCXAddressBinary       -> XDCXAddrBinary          (a different name, not case)
//   TradingStateAddressBinary -> tradingStateAddressBinary
//   TipXDCX/TipTrc21Fee/TIPXDCXMinerDisable/TIPXDCXReceiverDisable -> not used at all
// A name the engine does not bind is silently ignored and its own default
// applies, which is how a chainspec can look correct and still diverge from the
// Go nodes. Values below match a working Nethermind+Go subnet deployment.
const DEFAULT_ENGINE_SUBNET = {
  MergeSignRange: 15,
  RangeReturnSigner: 150,
  DynamicGasLimitBlock: 99999999999999,
  tip2019Block: 1,
  BlackListHFNumber: 99999999999999,
  blackListedAddresses: [],
  masternodeVotingContract: '0x0000000000000000000000000000000000000088',
  blockSignerContract: '0x0000000000000000000000000000000000000089',
  randomizeSMCBinary: '0x0000000000000000000000000000000000000090',
  XDCXAddrBinary: '0x0000000000000000000000000000000000000091',
  tradingStateAddressBinary: '0x0000000000000000000000000000000000000092',
  XDCXLendingAddressBinary: '0x0000000000000000000000000000000000000093',
  XDCXLendingFinalizedTradeAddressBinary: '0x0000000000000000000000000000000000000094',
  // genesis allConfigs carries no maxMasternodes; this is XDC's own default and
  // is what the working subnet chainspec states explicitly
  maxMasternodes: 108,
  // genesis states no switchEpoch on a subnet, and the engine wants it present
  switchEpoch: 0,
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

// XDC hardfork blocks that live in engine.XDPoS.params rather than params.
// Key = chainspec key, value = genesis.config key. The key spellings come from
// Nethermind's own reference specs (/nethermind/chainspec/xdc.json and
// xdc-testnet.json) — note TIPUpgradeReward/TIPUpgradePenalty use all-caps TIP
// and, unlike the rest, carry no "Block" suffix. Binding is case-insensitive,
// but matching the reference keeps generated and reference specs diffable.
//
// No defaults here on purpose — see the header note on ENGINE_FORKS.
const ENGINE_FORKS = {
  TipSigningBlock: 'tipSigningBlock',
  TipRandomizeBlock: 'tipRandomizeBlock',
  TipIncreaseMasternodesBlock: 'tipIncreaseMasternodesBlock',
  TipNoHalvingMNRewardBlock: 'tipNoHalvingMNRewardBlock',
  TipXDCXLendingBlock: 'tipXDCXLendingBlock',
  TipXDCXCancellationFeeBlock: 'tipXDCXCancellationFeeBlock',
  Gas50xBlock: 'gas50xBlock',
  TIPUpgradeReward: 'tipUpgradeRewardBlock',
  TIPUpgradePenalty: 'tipUpgradePenaltyBlock',
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
      if (!opts.subnet) {
        return rest;
      }
      // genesis carries no maxMasternodes on a subnet, but the working subnet
      // chainspec states it. Key spellings are left as genesis writes them --
      // the reference capitalises them, but binding is case-insensitive.
      return { maxMasternodes: DEFAULT_ENGINE_SUBNET.maxMasternodes, ...rest };
    });

  // chain data, identical on both engines
  const shared = {
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
  };

  // Key names below are the ones each engine actually binds -- see the note on
  // DEFAULT_ENGINE_SUBNET. Emitted in the reference specs' own order so a
  // generated spec diffs cleanly against them.
  const enginePadms = opts.subnet
    ? {
        ...shared,
        switchEpoch: shared.switchEpoch ?? DEFAULT_ENGINE_SUBNET.switchEpoch,
        MergeSignRange: DEFAULT_ENGINE_SUBNET.MergeSignRange,
        RangeReturnSigner: DEFAULT_ENGINE_SUBNET.RangeReturnSigner,
        DynamicGasLimitBlock: pick(
          cfg.dynamicGasLimitBlock,
          DEFAULT_ENGINE_SUBNET.DynamicGasLimitBlock
        ),
        tip2019Block: pick(cfg.tip2019Block, DEFAULT_ENGINE_SUBNET.tip2019Block),
        BlackListHFNumber: pick(cfg.denylistBlock, DEFAULT_ENGINE_SUBNET.BlackListHFNumber),
        blackListedAddresses: DEFAULT_ENGINE_SUBNET.blackListedAddresses,
        masternodeVotingContract: DEFAULT_ENGINE_SUBNET.masternodeVotingContract,
        blockSignerContract: DEFAULT_ENGINE_SUBNET.blockSignerContract,
        randomizeSMCBinary: DEFAULT_ENGINE_SUBNET.randomizeSMCBinary,
        XDCXAddrBinary: DEFAULT_ENGINE_SUBNET.XDCXAddrBinary,
        tradingStateAddressBinary: DEFAULT_ENGINE_SUBNET.tradingStateAddressBinary,
        XDCXLendingAddressBinary: DEFAULT_ENGINE_SUBNET.XDCXLendingAddressBinary,
        XDCXLendingFinalizedTradeAddressBinary:
          DEFAULT_ENGINE_SUBNET.XDCXLendingFinalizedTradeAddressBinary,
      }
    : {
        ...shared,
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
        XDCXLendingFinalizedTradeAddressBinary:
          DEFAULT_ENGINE.XDCXLendingFinalizedTradeAddressBinary,
      };

  // XDC hardfork blocks carried straight through. Absent in genesis => absent
  // from the chainspec, so the fork stays off rather than activating at 0.
  // These are XDPoS spellings; the subnet engine binds none of them, and the
  // working subnet chainspec carries none.
  if (!opts.subnet) {
    for (const [key, genesisKey] of Object.entries(ENGINE_FORKS)) {
      enginePadms[key] = cfg[genesisKey];
    }
  }

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

  // Subnet nodes run a different consensus plugin than a standalone XDPoS
  // network, and Nethermind selects it by this key. The mapping notes above
  // spell it "engine.XDPoS" throughout; with opts.subnet the whole block is
  // named engine.XDPoSSubnet instead, contents unchanged.
  const engineName = opts.subnet ? "XDPoSSubnet" : "XDPoS";

  return {
    name: opts.name || DEFAULT_CHAIN_NAME,
    engine: { [engineName]: { params: enginePadms } },
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
  'Usage: node genesis-to-chainspec.js <genesis.json> <chainspec.json> [--subnet] [--name <name>] [--base-fee <0x..>]\n' +
  '       npm run convert -- <genesis.json> <chainspec.json> [--subnet] [--name <name>] [--base-fee <0x..>]\n' +
  '--subnet names the engine block XDPoSSubnet instead of XDPoS; use it for a\n' +
  'Subnet deployment, leave it off for a standalone XDPoS network.\n' +
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
    } else if (args[i] === '--subnet') {
      opts.subnet = true;
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

module.exports = { translate, normalizeAddress };