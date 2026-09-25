#!/usr/bin/env node
/**
 * genesis-to-chainspec.js
 *
 * Translate a go-ethereum / XDC style `genesis.json` into the chainspec.json
 * Nethermind consumes. Self-contained: no external dependencies.
 *
 * Usage:
 *   node genesis-to-chainspec.js <genesis.json> <chainspec.json> [--subnet] [--name <name>]
 *
 * Both paths are required. --subnet names the engine block XDPoSSubnet instead
 * of XDPoS; use it for a Subnet deployment, leave it off for a standalone XDPoS
 * network. As a one-off container:
 *
 *   docker run --rm -v $PWD/generated:/mount/generated \
 *     xinfinorg/subnet-generator:<version> \
 *     npm run convert -- /mount/generated/genesis.json /mount/generated/chainspec.json
 *
 * --------------------------------------------------------------------------
 * The one rule: genesis wins. Everything genesis.json can supply is read from
 * it; the DEFAULT_* tables are fallbacks that apply only where genesis is
 * silent. The tables below ARE the mapping -- read them, not a copy of them:
 *
 *   TRANSITION_FORKS      genesis.config fork block -> params.eipNNNNTransition
 *   ENGINE_GENESIS_KEYS   flat genesis.config key   -> engine param
 *   ENGINE_FORKS          XDC hardfork block        -> engine param
 *   DEFAULT_PARAMS        params values genesis cannot supply
 *   DEFAULT_ENGINE(_SUBNET)  engine values genesis cannot supply
 *
 * Four things the tables cannot say for themselves:
 *
 * 1. Two different Go clients. A subnet runs XinFinOrg/XDC-Subnet
 *    (xinfinorg/xdcsubnets); a standalone network runs XinFinOrg/XDPoSChain
 *    (xinfinorg/devnet). They gate the same EIPs on the same genesis forks, so
 *    params is identical, but their v2 configs differ -- see checkV2Config().
 *
 * 2. XDPoSChain does not follow the canonical Ethereum fork schedule. A group
 *    Ethereum ships with Berlin/London/Shanghai -- 2565, 2929, 2930, 3529,
 *    3541, 3651, 3860 -- is gated on EIP1559Block instead, alongside 1559
 *    itself. EIP-2028 is not implemented at all. berlinBlock feeds nothing.
 *    TRANSITION_FORKS carries the Go call site for each.
 *
 * 3. Two different "off" conventions. In params, a fork the chain does not run
 *    falls back to 999999999999, a block no chain reaches, so it is emitted
 *    visibly off rather than silently on at 0. (The eleven entries sitting at 0
 *    are forks the chain genuinely runs from block 0.) ENGINE_FORKS has no
 *    fallback at all and relies on the key being absent instead -- Nethermind
 *    reads `(key ?? ulong.MaxValue) <= block`, so absent means never enabled.
 *
 * 4. A key Nethermind does not bind is silently ignored, which is how a
 *    chainspec can look correct and still diverge from the Go nodes. Every key
 *    emitted here was checked against a real property on ChainSpecParamsJson,
 *    ChainSpecGenesisJson or XdcChainSpecEngineParameters; the note above
 *    ENGINE_GENESIS_KEYS lists what that test excluded and why.
 *
 * Genesis block: timestamp, extraData, gasLimit, difficulty and parentHash go
 * across verbatim. nonce and mixHash become genesis.seal.ethereum, coinbase
 * becomes genesis.author, and number and gasUsed are dropped -- those are the
 * shapes ChainSpecLoader actually reads. baseFeePerGas is null in genesis and
 * concrete here: DEFAULT_BASE_FEE_PER_GAS is the value that makes the genesis
 * hashes agree, not a preference.
 *
 * Present in genesis with no chainspec counterpart, so dropped rather than
 * invented: v2 expTimeoutConfig, maxMasternodesV2, SkipV1Validation, and the
 * trc21IssuerSMC / xdcxListingSMC / relayerRegistrationSMC /
 * lendingRegistrationSMC addresses.
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

// genesis.json has null here, the chainspec needs a concrete value. This is
// params.InitialBaseFee (12500000000, 12.5 gwei), which is what core/genesis.go
// puts in the header in that case -- not a preference, the value that makes the
// genesis hashes agree.
const DEFAULT_BASE_FEE_PER_GAS = '0x2e90edd00';

// Fallback values for params. Every transition sits at 999999999999 unless the
// chain genuinely runs it from block 0 -- see rule 3 in the header.
const DEFAULT_PARAMS = {
  // Homestead
  eip7Transition: 1,

  // Tangerine Whistle
  eip150Transition: 999999999999,
 
  // Spurious Dragon
  eip160Transition: 999999999999,
  eip161abcTransition: 999999999999,
  eip161dTransition: 999999999999,
  eip155Transition: 999999999999,
  MaxCodeSizeTransition: 999999999999,
  MaxCodeSize: 24576,
  // params.MaxCodeSizeOsaka. Never emitted under this name -- pickMaxCodeSize()
  // uses it as the value of MaxCodeSize when osakaBlock makes it the only limit
  // the chain ever has.
  MaxCodeSizeOsaka: 32768,

  // Byzantium
  eip140Transition: 999999999999,
  eip211Transition: 999999999999,
  eip214Transition: 999999999999,
  eip658Transition: 999999999999,

  // Constantinople and Petersburg
  eip145Transition: 0,
  eip1014Transition: 0,
  eip1052Transition: 0,
  eip1283Transition: 0,

  // Istanbul
  eip152Transition: 0,
  eip1108Transition: 0,
  eip1344Transition: 0,
  eip1884Transition: 0,
  eip2028Transition: 999999999999,
  eip2200Transition: 0,

  // Berlin
  eip2565Transition: 999999999999,
  eip2929Transition: 999999999999,
  eip2930Transition: 999999999999,

  // London
  eip1559Transition: 999999999999,
  eip1559ElasticityMultiplier: '0x1',
  eip3198Transition: 0,
  eip3529Transition: 999999999999,
  eip3541Transition: 999999999999,

  // Shanghai
  eip3651Transition: 999999999999,
  eip3855Transition: 0,
  eip3860Transition: 999999999999,

  // Cancun
  eip1153Transition: 999999999999,
  eip4844Transition: 999999999999,
  eip5656Transition: 999999999999,
  eip6780Transition: 999999999999,

  // Prague
  eip2537Transition: 999999999999,
  eip2935Transition: 999999999999,
  eip7702Transition: 999999999999,
  eip7623Transition: 999999999999,
};


// Same, for a Subnet. A spread, not a second table: both clients gate the same
// EIPs on the same forks, so there is nothing to differ about yet. Add only the
// keys a subnet disagrees about (e.g. `eip1559Transition: 0`) and never restate
// the rest -- the 999999999999 fallbacks are the invariant from rule 3.
const DEFAULT_PARAMS_SUBNET = {
  ...DEFAULT_PARAMS,
};



// Engine constants for what genesis.json does not state. Spread into the engine
// block whole, so key order here is the emitted order and every key here is
// emitted. Fallbacks only: anything genesis states wins, whether it arrives as
// chain data under the same name or via ENGINE_GENESIS_KEYS.
const DEFAULT_ENGINE = {
  mergeSignRange: 15,
  RangeReturnSigner: 150,
  tip2019Block: 1,
  DynamicGasLimitBlock: 9999999999999,
  TipXDCX: 9999999999999,
  BlackListHFNumber: 9999999999999,
  TipTrc21Fee: 99999999999999,
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

// Same table for the subnet engine. XdcSubnetChainSpecEngineParameters derives
// from XdcChainSpecEngineParameters and overrides only SealEngineType (and the
// internal ResolveMinGasPrice), so it binds the same property names; the casing
// differences below are cosmetic, since binding is case-insensitive.
//
// Most entries switch a fork off. The two that switch one ON were checked
// against XDC-Subnet, the client a subnet actually runs, not copied from a
// deployment that happened to work. Both are on from block 1 on both sides:
//
//   tip2019Block: 1  Nethermind: IsTIP2019 = TIP2019Block <= releaseStartBlock
//     (XdcChainSpecBasedSpecProvider.cs:79). Go: common.TIP2019Block = 1.
//   TipTrc21Fee: 1   Nethermind: (TipTrc21Fee ?? MaxValue) <= releaseStartBlock
//     (:77). Go: common.TIPTRC21Fee = 0, but tested STRICTLY --
//     `BlockNumber.Cmp(common.TIPTRC21Fee) > 0` (core/state_transition.go:271).
//     Do NOT "correct" this to 0 to match the Go constant: the strict test means
//     0 would enable it a block early, on the transaction-execution path.
//
// Key order is the emitted order. Fallbacks only -- genesis always wins.
const DEFAULT_ENGINE_SUBNET = {
  MergeSignRange: 15,
  RangeReturnSigner: 150,
  DynamicGasLimitBlock: 99999999999999,
  tip2019Block: 1,
  TipTrc21Fee: 1,
  BlackListHFNumber: 99999999999999,
  blackListedAddresses: [],
  masternodeVotingContract: '0x0000000000000000000000000000000000000088',
  blockSignerContract: '0x0000000000000000000000000000000000000089',
  randomizeSMCBinary: '0x0000000000000000000000000000000000000090',
  XDCXAddressBinary: '0x0000000000000000000000000000000000000091',
  tradingStateAddressBinary: '0x0000000000000000000000000000000000000092',
  XDCXLendingAddressBinary: '0x0000000000000000000000000000000000000093',
  XDCXLendingFinalizedTradeAddressBinary: '0x0000000000000000000000000000000000000094',
  // genesis states no switchEpoch on a subnet and the engine wants it present.
  // When genesis does state one (v2.switchEpoch / v2.SwitchEpoch) that wins --
  // see the merge in translate().
  switchEpoch: 0,
};

// Kept out of the table above because that one is spread into the engine block
// wholesale, whereas maxMasternodes belongs inside each v2Configs entry. A
// subnet genesis states none; 108 is XDC's own default (common.MaxMasternodes).
const DEFAULT_SUBNET_EXTRAS = {
  maxMasternodes: 108,
};

/* ------------------------------------------------------------------ *
 * Maps — which genesis.json key feeds which chainspec key. Values come
 * from the tables above when genesis states nothing.
 * ------------------------------------------------------------------ */


// Which genesis.config fork block activates each params transition. Key order
// here is the emitted key order, and mirrors DEFAULT_PARAMS.
//
//   'someBlock'  genesis.config.someBlock activates it; if genesis does not
//                state that fork, the DEFAULT_PARAMS entry stands in.
//   [a, b, ...]  several keys can activate it -- whichever states the earliest
//                block wins, because Go ORs the isForked() checks. IsIstanbul
//                is `isForked(TIPXDCXCancellationFeeBlock) || isForked(
//                IstanbulBlock)` (params/config_forks.go:79), a compatibility
//                path for older XDC configs that never set istanbulBlock.
//   null         XDPoSChain does not implement it, so the never-block stands
//                and the key is emitted visibly off. Switching one of these on
//                for Nethermind alone is the state-root divergence this mapping
//                exists to prevent.
//
// The null verdicts come from XDPoSChain itself -- core/vm/jump_table.go for the
// instruction sets, core/vm/contracts.go for the precompiles, and the Is<Fork>
// call sites -- cross-checked against the spec Nethermind ships for Apothem
// (src/Nethermind/Chains/xdc-testnet.json), the same mapping with real blocks.
//
// Watch 'eip1559Block'. core/vm/evm.go picks ONE instruction set by a switch on
// chainRules, and newEip1559InstructionSet is Shanghai plus 2929, 3529 and 3860
// (jump_table.go:115) while newBerlinInstructionSet has its enable2929
// commented out (:152). So that whole group really activates at EIP1559Block.
// Apothem proves it: london = shanghai = 61290000 but eip1559Block = 71550000,
// and xdc-testnet.json puts eip1559, 2929, 3529 and 3860 together on 71550000.
const TRANSITION_FORKS = {
  // Not a transition, but read out of genesis.config exactly like one, so
  // keeping it here lets params be built in a single pass. No DEFAULT_PARAMS
  // entry on purpose: a chainspec must not invent a chain id, and pick()
  // leaving it undefined drops the key.
  chainId: 'chainId',

  // Homestead
  eip7Transition: 'homesteadBlock', // DELEGATECALL, newHomesteadInstructionSet

  // Tangerine Whistle
  eip150Transition: 'eip150Block',

  // Spurious Dragon — eip158Block carries 160, 161 and 170 as well
  eip160Transition: 'eip158Block',
  eip161abcTransition: 'eip158Block',
  eip161dTransition: 'eip158Block',
  eip155Transition: 'eip155Block',
  // EIP-170. The limit itself is a constant, not a transition -- buildParams()
  // emits MaxCodeSize alongside this.
  MaxCodeSizeTransition: 'eip158Block',

  // Byzantium
  eip140Transition: 'byzantiumBlock',
  eip211Transition: 'byzantiumBlock',
  eip214Transition: 'byzantiumBlock',
  eip658Transition: 'byzantiumBlock',

  // Constantinople and Petersburg. The Constantinople opcodes also come in
  // through Istanbul: core/vm/evm.go tries `case IsIstanbul` before
  // `case IsConstantinople`, and newIstanbulInstructionSet builds on
  // newConstantinopleInstructionSet, so they are live from whichever lands first.
  eip145Transition: ['constantinopleBlock', 'istanbulBlock', 'tipXDCXCancellationFeeBlock'],
  eip1014Transition: ['constantinopleBlock', 'istanbulBlock', 'tipXDCXCancellationFeeBlock'],
  eip1052Transition: ['constantinopleBlock', 'istanbulBlock', 'tipXDCXCancellationFeeBlock'],
  // net metered SSTORE, live only while IsConstantinople && !IsPetersburg
  // (core/vm/gas_table.go, gasSStore). Moot once enable2200 replaces SSTORE's
  // dynamic gas outright, which is why the reference spec can leave it on.
  eip1283Transition: ['constantinopleBlock', 'istanbulBlock', 'tipXDCXCancellationFeeBlock'],

  // Istanbul
  eip152Transition: ['istanbulBlock', 'tipXDCXCancellationFeeBlock'],
  eip1108Transition: ['istanbulBlock', 'tipXDCXCancellationFeeBlock'],
  eip1344Transition: ['istanbulBlock', 'tipXDCXCancellationFeeBlock'],
  eip1884Transition: ['istanbulBlock', 'tipXDCXCancellationFeeBlock'],
  // 2028 is NOT implemented: IntrinsicGas charges the flat
  // params.TxDataNonZeroGas = 68, and TxDataNonZeroGasEIP2028 = 16 is declared
  // in params/protocol_params.go and referenced nowhere else in the tree.
  // Nethermind at 16 gas per non-zero byte would misprice every call with
  // calldata. xdc-testnet.json omits the key entirely, with Istanbul live.
  eip2028Transition: null,
  eip2200Transition: ['istanbulBlock', 'tipXDCXCancellationFeeBlock'],

  // Berlin -- none of it hangs off berlinBlock, see the eip1559Block note above
  // 2565: PrecompiledContractsXDCv2 still has eip2565:false; the first set that
  // turns it on is PrecompiledContractsEIP1559 (core/vm/contracts.go)
  eip2565Transition: 'eip1559Block',
  // 2929 + 2930: the access list is built in StateDB.Prepare, whose whole body
  // is behind `if rules.IsEIP1559` (core/state/statedb.go), and txpool rejects
  // every non-legacy tx type until IsEIP1559 (core/txpool/validation.go)
  eip2929Transition: 'eip1559Block',
  eip2930Transition: 'eip1559Block',

  // London. Only BASEFEE is really gated on londonBlock: enable3198 is the sole
  // entry in newLondonInstructionSet.
  eip1559Transition: 'eip1559Block',
  eip3198Transition: 'londonBlock',
  eip3529Transition: 'eip1559Block', // enable3529, newEip1559InstructionSet
  eip3541Transition: 'eip1559Block', // core/vm/evm.go: ret[0]==0xEF && IsEIP1559

  // Shanghai. Only PUSH0 is really gated on shanghaiBlock: enable3855 is the
  // sole entry in newShanghaiInstructionSet.
  // 3651: the warm-coinbase AddAddress sits inside Prepare's IsEIP1559 branch
  eip3651Transition: 'eip1559Block',
  eip3855Transition: 'shanghaiBlock',
  // 3860: IntrinsicGas takes rules.IsEIP1559 as its isEIP3860 argument
  eip3860Transition: 'eip1559Block',

  // Cancun
  eip1153Transition: 'cancunBlock',
  eip4844Transition: 'cancunBlock',
  eip5656Transition: 'cancunBlock',
  eip6780Transition: 'cancunBlock',

  // Prague. XDPoSChain gates three EIPs on IsPrague: 2935 (history contract),
  // 7623 (calldata floor cost) and 7702 (setcode tx, the only opcode-level
  // change — newPragueInstructionSet is Cancun plus enable7702).
  eip2537Transition: null,   // BLS precompiles: activePrecompiledContracts has
                             // no Prague case, it falls through to the
                             // EIP-1559 set
  eip2935Transition: 'pragueBlock',
  eip7702Transition: 'pragueBlock',
  eip7623Transition: 'pragueBlock',

  // Osaka is unreachable from a chainspec, so no Osaka key is emitted. XDPoSChain
  // does gate five EIPs on IsOsaka (7823, 7825, 7883, 7934, 7939), but
  // Nethermind declares every one of them as eipNNNNTransitionTimestamp only,
  // with no block-numbered form to bind. pickMaxCodeSize() warns about this;
  // maxCodeSize is the only piece of Osaka a chainspec can carry at all.
};

// Nineteen transitions are deliberately absent: Nethermind binds no such key,
// and a value under a name nothing reads is worse than no key -- it reads as a
// decision that was never taken. Checked against ChainSpecParamsJson at
// master-4e36ba0:
//
//   no property in any form (6): eip1234, eip2718, eip3554, eip4399, eip6049,
//     eip7516. eip1234 shows why it matters -- IsEip1234Enabled derives from the
//     Constantinople block (eip145Transition, which defaults to 0 here), so it
//     is on from block 0 whatever sat beside it.
//   declared only as eipNNNNTransitionTimestamp (13): eip4788, eip4895, eip6110,
//     eip7002, eip7251, eip7594, eip7823, eip7825, eip7883, eip7918, eip7934,
//     eip7939, eip7951 -- a block-numbered value there is an unknown JSON
//     member and is silently ignored.
//
// Before adding one back, check it is a real ChainSpecParamsJson property.

// The second way genesis reaches an engine param: a flat genesis.config key
// whose name differs from the chainspec key. (The first is chain data that keeps
// its name, which buildEngineParams() merges by name.)
//
// One table for both engines -- XdcSubnetChainSpecEngineParameters inherits
// every property of XdcChainSpecEngineParameters and binding is
// case-insensitive, so there is nothing to rename. A key here that has no entry
// in the matching DEFAULT_ENGINE* table is emitted only when genesis states it.
const ENGINE_GENESIS_KEYS = {
  tip2019Block: 'tip2019Block',
  DynamicGasLimitBlock: 'dynamicGasLimitBlock',
  TipXDCX: 'tipXDCXBlock',
  BlackListHFNumber: 'denylistBlock',
  TipTrc21Fee: 'tipTRC21FeeBlock',
  TIPXDCXMinerDisable: 'tipXDCXMinerDisableBlock',
  TIPXDCXReceiverDisable: 'tipXDCXReceiverDisableBlock',
};

// XDC hardfork blocks, which live in the engine block rather than params.
// Spellings match Nethermind's reference specs (src/Nethermind/Chains/xdc.json)
// -- note TIPUpgradeReward and TIPUpgradePenalty take all-caps TIP and no
// "Block" suffix. Binding is case-insensitive; matching the reference just keeps
// generated and reference specs diffable.
//
// No defaults here on purpose -- see rule 3 in the header.
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
 * Helpers
 * ------------------------------------------------------------------ */

// Earliest block any of these genesis keys states, for a fork more than one key
// can activate. Go ORs the isForked() checks, so the fork is live from the first
// one to pass; undefined when genesis states none of them.
function earliestStated(cfg, genesisKeys) {
  const stated = genesisKeys
    .map((key) => cfg[key])
    .filter((value) => value !== undefined && value !== null);
  return stated.length
    ? stated.reduce((a, b) => (Number(a) <= Number(b) ? a : b))
    : undefined;
}

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

// Lowercase, 0x-prefixed; the cosmetic EIP-55 checksum is not worth the bother.
// Absent stays absent -- without that guard String(undefined) makes the literal
// "0xundefined", which Nethermind rejects at load with "hex string of odd
// length", an error naming neither the field nor the file.
function normalizeAddress(addr) {
  if (addr === undefined || addr === null) return undefined;
  return '0x' + String(addr).toLowerCase().replace(/^0x/, '');
}

/* ------------------------------------------------------------------ *
 * Builders — one per section of the chainspec
 * ------------------------------------------------------------------ */

// Nethermind binds each v2Configs entry to V2ConfigParams, whose fields are
// non-nullable value types with `init` accessors, and its CheckConfig validates
// only that a switchRound: 0 entry exists and that no round repeats
// (XdcChainSpecEngineParameters.cs:109-118). So a field genesis omits is not
// "unset", it is 0, and nothing downstream can tell the difference.
//
// What must be present depends on the Go client, which declare different
// V2Configs: XDPoSChain's has 14 fields (params/config_xdpos.go) and a generated
// XDPoS genesis states all 14; XDC-Subnet's has 5 (params/config.go), so
// requiring the other nine would reject every valid subnet genesis.
// maxMasternodes is required on top of those 5 because
// SubnetMasternodesCalculator reads it and the converter injects it.
//
// Those nine are safe at 0 on a subnet only because nothing reads them there:
// Nethermind registers SubnetPenaltyHandler (XdcSubnetModule.cs:32), which uses
// a hardcoded MinimumMinerBlockPerEpoch of 1 and never touches LimitPenaltyEpoch
// or MinimumSigningTx, and XDC-Subnet hardcodes the same 1. The reward and
// protector/observer cap fields are read only by XdcRewardCalculator, and
// XDC-Subnet has no protector/observer tiers. If a future subnet client gains
// any of them, move it into the subnet list.
const V2_REQUIRED_FIELDS_XDPOS = [
  'switchRound', 'maxMasternodes', 'maxProtectorNodes', 'maxObserverNodes',
  'minePeriod', 'timeoutSyncThreshold', 'timeoutPeriod', 'certificateThreshold',
  'masternodeReward', 'protectorReward', 'observerReward',
  'minimumMinerBlockPerEpoch', 'limitPenaltyEpoch', 'minimumSigningTx',
];

const V2_REQUIRED_FIELDS_SUBNET = [
  'switchRound', 'maxMasternodes', 'minePeriod', 'timeoutSyncThreshold',
  'timeoutPeriod', 'certificateThreshold',
];

function checkV2Config(round, config, opts) {
  const required = opts.subnet
    ? V2_REQUIRED_FIELDS_SUBNET
    : V2_REQUIRED_FIELDS_XDPOS;
  const missing = required.filter((f) => config[f] === undefined);
  if (missing.length) {
    throw new Error(
      `genesis XDPoS.v2.allConfigs[${round}] is missing ${missing.join(', ')}. ` +
        'Nethermind would read 0 for each, diverging from the Go nodes.'
    );
  }
}

// The per-round XDPoS V2 settings, in round order. Every field is carried as
// genesis states it, bar expTimeoutConfig, which has no chainspec key.
function buildV2Configs(v2, opts) {
  return Object.keys(v2.allConfigs || {})
    .sort((a, b) => Number(a) - Number(b))
    .map((round) => {
      const { expTimeoutConfig, ...rest } = v2.allConfigs[round];
      // a subnet genesis carries no maxMasternodes, but the chainspec needs it
      const config = opts.subnet
        ? { maxMasternodes: DEFAULT_SUBNET_EXTRAS.maxMasternodes, ...rest }
        : rest;
      checkV2Config(round, config, opts);
      return config;
    });
}

// engine.XDPoS.params, or engine.XDPoSSubnet.params with opts.subnet. The
// default table is the only difference between the two engines here; translate()
// names the block.
function buildEngineParams(cfg, opts) {
  const xdpos = cfg.XDPoS || {};
  const v2 = xdpos.v2 || {};

  // Chain data, read the same way for both engines. period and rewardCheckpoint
  // are NOT carried: neither is a property of XdcChainSpecEngineParameters. The
  // mine period comes from v2Configs[].minePeriod, which is bound.
  const shared = {
    epoch: xdpos.epoch,
    reward: xdpos.reward,
    gap: xdpos.gap,
    // note: genesis spells the key "foudationWalletAddr" (sic)
    foundationWalletAddr: normalizeAddress(pick(xdpos.foudationWalletAddr, xdpos.foundationWalletAddr)),
    // genesis spells this either "switchEpoch" (newer) or "SwitchEpoch" (older).
    // Use ?? not || — the valid value is 0, which is falsy.
    switchEpoch: v2.switchEpoch ?? v2.SwitchEpoch,
    switchBlock: v2.switchBlock ?? v2.SwitchBlock,
    v2Configs: buildV2Configs(v2, opts),
  };

  // Two things the converter cannot express, so it refuses rather than emit a
  // chainspec that looks right and silently disagrees with the Go nodes.

  // Nethermind reads the genesis masternodes out of genesis.extraData only when
  // SwitchBlock == 0; otherwise it reads the engine param genesisMasternodes,
  // which this converter has no source for and never writes
  // (XdcChainSpecBasedSpecProvider.cs:101-112, defaulting to an empty array).
  // The node would boot on the right genesis hash with no validator set.
  if (Number(pick(shared.switchBlock, 0)) !== 0) {
    throw new Error(
      `genesis states XDPoS.v2.switchBlock ${shared.switchBlock}; the converter ` +
        'has no source for genesisMasternodes, which Nethermind requires then'
    );
  }

  // normalizeAddress() returns undefined for an absent address, which would
  // drop the key; Nethermind has no default for it and fails to load.
  if (shared.foundationWalletAddr === undefined) {
    throw new Error(
      'genesis states no XDPoS.foudationWalletAddr (nor foundationWalletAddr); ' +
        'it has no default, and Nethermind fails to load a chainspec without it'
    );
  }

  // The default table is spread in whole rather than restated key by key, so a
  // value lives in exactly one place and the table fixes the emitted key order.
  // It is a fallback, never a winner: both passes below re-assign keys the
  // spread already created, so genesis always beats it and key order holds.
  const engineDefaults = opts.subnet ? DEFAULT_ENGINE_SUBNET : DEFAULT_ENGINE;
  const engineParams = { ...shared, ...engineDefaults };

  // 1. chain data, which keeps its genesis name. A table key of the same name
  //    (e.g. switchEpoch) backstops it rather than overwriting it -- the raw
  //    spread alone would let the constant replace a stated switchEpoch of 900
  //    with 0, putting the two clients on different epochs.
  for (const key of Object.keys(engineDefaults)) {
    if (key in shared) {
      engineParams[key] = pick(shared[key], engineDefaults[key]);
    }
  }
  // 2. flat genesis.config keys, which are spelled differently on each side
  for (const [key, genesisKey] of Object.entries(ENGINE_GENESIS_KEYS)) {
    engineParams[key] = pick(cfg[genesisKey], engineDefaults[key]);
  }

  // 3. XDC hardfork blocks, for both engines. No fallback by design: absent in
  //    genesis means absent here, which is how the fork stays off (rule 3).
  for (const [key, genesisKey] of Object.entries(ENGINE_FORKS)) {
    engineParams[key] = cfg[genesisKey];
  }

  return engineParams;
}

// params: the chain rules, which here is almost entirely EIP transitions.
function buildParams(cfg, opts, warn) {
  const paramDefaults = opts.subnet ? DEFAULT_PARAMS_SUBNET : DEFAULT_PARAMS;

  const params = {};

  for (const [key, forkBlock] of Object.entries(TRANSITION_FORKS)) {
    // null => no genesis fork activates it, so the DEFAULT_PARAMS never-block
    // stands and the key is emitted explicitly off. An array => the earliest
    // block any of those keys states.
    let stated;
    if (forkBlock === null) {
      stated = undefined;
    } else if (Array.isArray(forkBlock)) {
      stated = earliestStated(cfg, forkBlock);
    } else {
      stated = cfg[forkBlock];
    }
    params[key] = pick(stated, paramDefaults[key]);
  }

  // no genesis counterpart
  params.eip1559ElasticityMultiplier = paramDefaults.eip1559ElasticityMultiplier;
  params.MaxCodeSize = pickMaxCodeSize(cfg, params.MaxCodeSizeTransition, paramDefaults, warn);

  return params;
}

// maxCodeSize, the limit maxCodeSizeTransition switches on -- the two are
// emitted together or not at all.
//
// XDPoSChain has TWO code limits (core/vm/common.go, CheckMaxCodeSize): nothing
// before eip158Block, params.MaxCodeSize (24576) from there, then
// params.MaxCodeSizeOsaka (32768) from osakaBlock. The chainspec has a single
// maxCodeSize/maxCodeSizeTransition pair, so it holds ONE limit, not a step
// between two. It still lands exactly right in the case that matters for a new
// subnet: when osakaBlock is at or before the limit's own start, 32768 is the
// only limit the chain ever has, so that is the value to emit.
function pickMaxCodeSize(cfg, maxCodeSizeTransition, paramDefaults, warn) {
  const osakaBlock = cfg.osakaBlock;
  if (osakaBlock === undefined || osakaBlock === null) {
    return paramDefaults.MaxCodeSize;
  }

  // maxCodeSize is the one piece of Osaka a chainspec can carry at all.
  warn(
    `Warning: genesis states osakaBlock ${osakaBlock}, but Nethermind's XDC ` +
      'build declares every Osaka EIP as eipNNNNTransitionTimestamp with no ' +
      'block-numbered form, so 7823, 7825, 7883, 7934 and 7939 cannot be turned ' +
      'on by block at all. The Nethermind nodes will run without the CLZ opcode, ' +
      'the 16777216 tx gas cap, the modexp repricing and the 8388608-byte block ' +
      'cap while the Go nodes apply them.'
  );

  if (Number(osakaBlock) <= Number(maxCodeSizeTransition)) {
    return paramDefaults.MaxCodeSizeOsaka;
  }

  // Two limits, one slot. 24576 is kept because it is right for the stretch from
  // eip158Block to osakaBlock; from osakaBlock on, Nethermind is stricter than
  // the Go nodes and rejects a deploy they accept.
  warn(
    `Warning: genesis states osakaBlock ${osakaBlock}, later than ` +
      `maxCodeSizeTransition ${maxCodeSizeTransition}. XDPoSChain raises ` +
      'its code limit to 32768 there; the chainspec holds one limit only, so it ' +
      'keeps 24576 and the Nethermind nodes stay stricter from osakaBlock on.'
  );
  return paramDefaults.MaxCodeSize;
}

// The genesis block header. Most fields go across verbatim; nonce, mixHash and
// coinbase are reshaped into the form ChainSpecLoader reads, and baseFeePerGas
// gets a concrete value where genesis.json has null.
function buildGenesisBlock(genesis, opts) {
  return {
    // ChainSpecGenesisJson declares none of nonce, mixHash or coinbase at the
    // top level. ChainSpecLoader.cs:356-357 reads the first two from
    // Seal.Ethereum (defaulting to 0 and Keccak.Zero) and :369 reads the
    // beneficiary from Author. Emitted flat, all three were silently ignored.
    seal: { ethereum: { nonce: genesis.nonce, mixHash: genesis.mixHash } },
    author: normalizeAddress(genesis.coinbase),
    timestamp: genesis.timestamp,
    extraData: genesis.extraData,
    gasLimit: genesis.gasLimit,
    difficulty: genesis.difficulty,
    parentHash: genesis.parentHash,
    baseFeePerGas: pick(genesis.baseFeePerGas, DEFAULT_BASE_FEE_PER_GAS),
    // number and gasUsed are not emitted: genesis is always block 0 with no gas
    // used, and ChainSpecLoader hardcodes the number anyway.
  };
}

/* ------------------------------------------------------------------ *
 * Translation
 * ------------------------------------------------------------------ */

function translate(genesis, opts = {}) {
  const cfg = genesis.config || {};

  // Warnings go to opts.warnings when the caller supplies an array, else to
  // console.error. The CLI leaves it unset and so keeps writing to stderr, which
  // is what check-chainspec.sh surfaces; the container-manager passes an array,
  // because in-process console.error only reaches the container log while the
  // operator's page says success.
  const warn = Array.isArray(opts.warnings)
    ? (message) => opts.warnings.push(message)
    : (message) => console.error(message);

  // Subnet nodes run a different consensus plugin, which Nethermind selects by
  // this key alone -- the block's contents are the same either way.
  const engineName = opts.subnet ? 'XDPoSSubnet' : 'XDPoS';

  return {
    name: opts.name || DEFAULT_CHAIN_NAME,
    engine: { [engineName]: { params: buildEngineParams(cfg, opts) } },
    params: buildParams(cfg, opts, warn),
    genesis: buildGenesisBlock(genesis, opts),
    nodes: opts.nodes || [],
    accounts: genesis.alloc || {},
  };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const USAGE =
  'Usage: node genesis-to-chainspec.js <genesis.json> <chainspec.json> [--subnet] [--name <name>]\n' +
  '       npm run convert -- <genesis.json> <chainspec.json> [--subnet] [--name <name>]\n' +
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

  // translate() throws on a genesis it cannot faithfully convert. Report that as
  // a plain message and a non-zero exit, not an unhandled stack trace: this runs
  // inside a container where the trace is all the operator would see.
  let chainspec;
  try {
    chainspec = translate(genesis, opts);
  } catch (e) {
    console.error(`Error: cannot translate ${inPath}: ${e.message}`);
    return 1;
  }
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
