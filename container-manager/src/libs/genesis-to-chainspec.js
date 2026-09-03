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
 *   genesis.config.homesteadBlock   -> params.eip7Transition
 *   genesis.config.eip150Block      -> params.eip150Transition
 *   genesis.config.eip155Block      -> params.eip155Transition
 *   genesis.config.eip158Block      -> params.eip160Transition, eip161abcTransition,
 *                                      eip161dTransition, MaxCodeSizeTransition
 *   genesis.config.byzantiumBlock   -> params.eip140Transition, eip211Transition,
 *                                      eip214Transition, eip658Transition
 *   the remaining EIP transitions come from the hardfork that ships them, see
 *   TRANSITION_FORKS: homesteadBlock, eip150Block, eip155Block, eip158Block,
 *   byzantiumBlock, constantinopleBlock, istanbulBlock, londonBlock, mergeBlock,
 *   shanghaiBlock, eip1559Block, cancunBlock, pragueBlock
 *   berlinBlock and osakaBlock feed nothing -- see TRANSITION_FORKS for why
 *
 *   params deliberately carries no homesteadBlock, byzantiumBlock or
 *   eip158Transition. Those are geth-genesis spellings, not chainspec ones.
 *   Nethermind binds params to ChainSpecParamsJson, which declares
 *   eip7Transition, eip161abcTransition and eip161dTransition but none of those
 *   three: homesteadBlock and byzantiumBlock are properties of
 *   GethGenesisConfigJson, a separate class that reads a geth genesis.json, and
 *   ChainSpecParamsJson does not derive from it; eip158Transition exists on
 *   neither. Emitting them only put three keys in the chainspec that the node
 *   silently ignored. Verified against Nethermind.Specs.dll in
 *   nethermindeth/nethermind:xdc-fixes -- and Nethermind's own
 *   chainspec/xdc-testnet.json carries all three in params, where they are just
 *   as dead. The forks are unaffected: each is still carried by its
 *   EIP-numbered keys above.
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
 *     no flag overrides this: XDPoSChain takes the same two steps in
 *     core/genesis.go (g.BaseFee, else params.InitialBaseFee), and a third
 *     value would simply change the genesis block hash
 *
 *   genesis.alloc  -> accounts (verbatim: code / storage / balance)
 *
 * Not derivable from genesis, so always DEFAULT_ENGINE* / DEFAULT_PARAMS*:
 *   mergeSignRange, RangeReturnSigner, blackListedAddresses, the contract
 *   binaries (they live in XDC's common constants, not in genesis) and
 *   eip1559ElasticityMultiplier. maxCodeSize is a constant too, but which one
 *   depends on osakaBlock — see translate().
 *
 * Present in genesis but with no counterpart in the chainspec schema, so
 * dropped rather than invented: v2 expTimeoutConfig, maxMasternodesV2,
 * SkipV1Validation, and the trc21IssuerSMC / xdcxListingSMC /
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
 * XDPoSChain does not follow the canonical Ethereum fork schedule, so neither
 * does this mapping. A group of EIPs that Ethereum ships with Berlin, London
 * and Shanghai — 2565, 2929, 2930, 3529, 3541, 3651, 3860 — is gated on
 * EIP1559Block in the Go client instead, alongside 1559 itself; EIP-2028 is not
 * implemented at all. TRANSITION_FORKS carries the reasoning per key, with the
 * Go call site for each.
 *
 * pragueBlock maps to only the EIPs XDPoSChain gates on IsPrague: 2935, 7623 and
 * 7702. The rest of Prague (BLS precompiles, the beacon-chain EIPs) is listed in
 * TRANSITION_FORKS as null and so comes out at DEFAULT_PARAMS' 999999999999:
 * present in the chainspec, visibly off, and impossible to switch on for
 * Nethermind alone by accident. Nethermind's own reference spec for Apothem
 * (/nethermind/chainspec/xdc-testnet.json) carries the same three transitions at
 * 83600000 and nothing else, and pre-allocates no EIP-2935 history contract, so
 * Nethermind supplies that contract itself; the transitions are all that is
 * needed.
 *
 * osakaBlock maps to no transition at all: Nethermind's XDC build declares every
 * Osaka EIP by timestamp only, with no block-numbered property to bind, so a
 * block-numbered chainspec cannot enter Osaka. The one part of Osaka a chainspec
 * can still carry is the code limit — maxCodeSize becomes 32768 when osakaBlock
 * is at or before maxCodeSizeTransition, since 32768 is then the only limit the
 * chain ever has. Everything else about Osaka is out of reach, so translate()
 * warns when genesis states an osakaBlock.
 *
 * Every params transition has a DEFAULT_PARAMS fallback of 999999999999, a
 * block no chain reaches, so a fork genesis does not state stays off rather
 * than silently activating at block 0. ENGINE_FORKS has no fallback at all and
 * relies on the key being absent instead. tipUpgradeRewardBlock is why that
 * matters — it selects between two different reward formulas
 * (eth/hooks/engine_v2_hooks.go, IsTIPUpgradeReward), so dropping it makes
 * XDPoSChain and Nethermind compute different balances at the first reward
 * checkpoint and the chain stalls there for good.
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

// chainspec.genesis.baseFeePerGas is a concrete value while genesis.json has
// null. Same number as XDPoSChain's params.InitialBaseFee (12.5 gwei), which is
// what its core/genesis.go puts in the genesis header in that case -- so this
// is not a preference, it is the value that makes the genesis hashes agree.
const DEFAULT_BASE_FEE_PER_GAS = '0x2e90edd00';

// All EIP transitions in chainspec.params that don't come straight from
// genesis.config. Values copied from the reference chainspec.json.
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
  // EIP-7907's raised limit (params.MaxCodeSizeOsaka in XDPoSChain). Never
  // emitted under this name -- translate() picks it as the value of maxCodeSize
  // when osakaBlock makes it the only limit the chain ever has.
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
  eip1234Transition: 999999999999,
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
  eip2718Transition: 999999999999,
  eip2929Transition: 999999999999,
  eip2930Transition: 999999999999,

  // London
  eip1559Transition: 999999999999,
  eip1559ElasticityMultiplier: '0x1',
  eip3198Transition: 0,
  eip3529Transition: 999999999999,
  eip3541Transition: 999999999999,
  eip3554Transition: 999999999999,

  // Merge
  eip4399Transition: 999999999999,

  // Shanghai
  eip3651Transition: 999999999999,
  eip3855Transition: 0,
  eip3860Transition: 999999999999,
  eip6049Transition: 999999999999,
  eip4895Transition: 999999999999,

  // Cancun
  eip1153Transition: 999999999999,
  eip4788Transition: 999999999999,
  eip4844Transition: 999999999999,
  eip5656Transition: 999999999999,
  eip6780Transition: 999999999999,
  eip7516Transition: 999999999999,

  // Prague
  eip2537Transition: 999999999999,
  eip2935Transition: 999999999999,
  eip6110Transition: 999999999999,
  eip7002Transition: 999999999999,
  eip7251Transition: 999999999999,
  eip7702Transition: 999999999999,
  eip7623Transition: 999999999999,

  // Osaka
  eip7594Transition: 999999999999,
  eip7823Transition: 999999999999,
  eip7825Transition: 999999999999,
  eip7883Transition: 999999999999,
  eip7918Transition: 999999999999,
  eip7934Transition: 999999999999,
  eip7939Transition: 999999999999,
  eip7951Transition: 999999999999,


};


// Same, for a Subnet. Unlike the DEFAULT_ENGINE / DEFAULT_ENGINE_SUBNET pair
// this one is a spread rather than a second full table, because the emitted key
// set and key order come from TRANSITION_FORKS, not from here -- a params table
// supplies values only. So every key stays in step with DEFAULT_PARAMS
// automatically and a subnet only has to state what it disagrees about.
//
// Nothing yet: a subnet and a standalone XDPoS network are running the same
// XDPoSChain binary, so the same EIPs are gated on the same forks. Put an entry
// here the moment a subnet needs to differ, e.g.
//   eip1559Transition: 0,
const DEFAULT_PARAMS_SUBNET = {
  eip150Transition: 2,
  eip155Transition: 3,
  eip160Transition: 3,
  eip145Transition: 0,
  eip1014Transition: 0,
  eip1052Transition: 0,
  eip1234Transition: 999999999999,
  eip1283Transition: 0,
  eip152Transition: 0,
  eip1108Transition: 0,
  eip1344Transition: 0,
  eip1884Transition: 0,
  eip2028Transition: 999999999999,
  eip2200Transition: 0,
  eip2565Transition: 999999999999,
  eip2718Transition: 999999999999,
  eip2930Transition: 999999999999,
  eip1559Transition: 999999999999,
  eip2929Transition: 999999999999,
  eip3198Transition: 0,
  eip3529Transition: 999999999999,
  eip3541Transition: 999999999999,
  eip3554Transition: 999999999999,
  eip4399Transition: 999999999999,
  eip3651Transition: 999999999999,
  eip3855Transition: 0,
  eip3860Transition: 999999999999,
  eip6049Transition: 999999999999,
  eip1153Transition: 999999999999,
  eip4844Transition: 999999999999,
  eip5656Transition: 999999999999,
  eip6780Transition: 999999999999,
  eip7516Transition: 999999999999,
  eip1559ElasticityMultiplier: '0x1',
  eip7Transition: 1,
  eip161abcTransition: 3,
  eip161dTransition: 3,
  eip140Transition: 4,
  eip211Transition: 4,
  eip214Transition: 4,
  eip658Transition: 4,
  MaxCodeSizeTransition: 3,
  MaxCodeSize: 24576,
  // Not in the reference spec, and not emitted under this name: pickMaxCodeSize
  // reads it off whichever table is in play to decide the value of MaxCodeSize.
  // Without it a subnet stating osakaBlock emits no MaxCodeSize at all.
  MaxCodeSizeOsaka: 32768,
};


// Engine constants for what genesis.json does not state (copied from
// chainspec.json). Spread into the engine block whole, so key order here is the
// emitted order and every key here is emitted. These are fallbacks only:
// anything genesis states wins, whether it arrives as chain data under the same
// name or through the ENGINE_GENESIS_KEYS rename -- see translate().
const DEFAULT_ENGINE = {
  mergeSignRange: 15,
  RangeReturnSigner: 150,
  tip2019Block: 1,
  DynamicGasLimitBlock: 9999999999999,
  TipXDCX: 9999999999999,
  blackListHFNumber: 9999999999999,
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

// The XDPoSSubnet engine plugin binds DIFFERENT property names than XDPoS, so a
// subnet chainspec is not just XDPoS with a renamed engine block:
//   XDPoS                      XDPoSSubnet
//   mergeSignRange          -> MergeSignRange
//   blackListHFNumber       -> BlackListHFNumber
//   XDCXAddressBinary       -> XDCXAddrBinary          (a different name, not case)
//   TradingStateAddressBinary -> tradingStateAddressBinary
//   TipXDCX/TIPXDCXMinerDisable/TIPXDCXReceiverDisable -> not used at all
//   TipTrc21Fee             -> TipTrc21Fee              (same name, and last)
// A name the engine does not bind is silently ignored and its own default
// applies, which is how a chainspec can look correct and still diverge from the
// Go nodes. Values below match a working Nethermind+Go subnet deployment.
//
// Key order is the emitted order: translate() spreads this table into the
// engine block whole, so a key is added, removed or moved here and nowhere
// else. Fallbacks only, as with DEFAULT_ENGINE -- genesis always wins.
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
  XDCXAddrBinary: '0x0000000000000000000000000000000000000091',
  tradingStateAddressBinary: '0x0000000000000000000000000000000000000092',
  XDCXLendingAddressBinary: '0x0000000000000000000000000000000000000093',
  XDCXLendingFinalizedTradeAddressBinary: '0x0000000000000000000000000000000000000094',
  // genesis states no switchEpoch on a subnet and the engine wants it present.
  // When genesis does state one (v2.switchEpoch / v2.SwitchEpoch) that wins --
  // see the merge in translate().
  switchEpoch: 0,
};

// A subnet value that is NOT an engine param, so it is kept out of the table
// above: that table is spread into the engine block wholesale and anything in it
// is emitted, whereas maxMasternodes goes inside each v2Configs entry. genesis
// allConfigs carries none; this is XDC's own default and what the working subnet
// chainspec states explicitly.
const DEFAULT_SUBNET_EXTRAS = {
  maxMasternodes: 108,
};

/* ------------------------------------------------------------------ *
 * Maps — which genesis.json key feeds which chainspec key. Values come
 * from the tables above when genesis states nothing.
 * ------------------------------------------------------------------ */


// Which hardfork block in genesis.config activates each chainspec transition.
// One entry per DEFAULT_PARAMS transition key, same order and same fork
// headings, so the two tables read side by side. Order matters twice over: it
// is also the key order of the generated params object.
//
//   'someBlock' = genesis.config.someBlock activates the EIP; when genesis does
//                 not state that fork, the DEFAULT_PARAMS entry stands in.
//   [a, b, ...]  = more than one genesis key activates it, whichever states the
//                 earliest block. XDPoSChain has forks that are reached two
//                 ways: IsIstanbul is
//                 `isForked(TIPXDCXCancellationFeeBlock) || isForked(IstanbulBlock)`
//                 (params/config_forks.go), a compatibility path for older XDC
//                 configs that never set istanbulBlock -- Apothem is one, and it
//                 runs Istanbul from tipXDCXCancellationFeeBlock.
//   null        = no genesis fork may activate it. XDPoSChain does not
//                 implement the EIP, so the DEFAULT_PARAMS never-block
//                 (999999999999) always stands and the key is emitted
//                 explicitly off. Turning one of these on for Nethermind alone
//                 is exactly the state-root (or block-header) divergence this
//                 mapping exists to prevent: the Go nodes would compute
//                 something else and the chain would stall at the first block
//                 that touches it.
//
// The null verdicts were read off XDPoSChain itself, not off the EIP list:
// core/vm/jump_table.go for the per-fork instruction sets, core/vm/contracts.go
// for the precompile sets, and the Is<Fork> call sites; then cross-checked
// against the chainspec Nethermind ships for Apothem (chainspec/xdc-testnet.json
// in the image), which is the same mapping with real block numbers on it.
//
// Watch for 'eip1559Block' below. XDPoSChain does NOT follow the canonical
// Ethereum fork schedule: core/vm/evm.go picks ONE instruction set by a switch
// on chainRules, and newEip1559InstructionSet is Shanghai plus 2929, 3529 and
// 3860 -- newBerlinInstructionSet has its enable2929 commented out. So a whole
// group of Berlin/London/Shanghai EIPs really activates at EIP1559Block
// (params/config_forks.go: IsEIP1559 is isForked(c.EIP1559Block, num), nothing
// else feeds it). Apothem is the proof: berlin = london = merge = shanghai =
// 61290000 but eip1559Block = 71550000, and xdc-testnet.json puts eip1559,
// 2929, 3529 and 3860 together on 71550000.
const TRANSITION_FORKS = {
  // Chain identity. Not a transition, but it is read out of genesis.config
  // exactly like one, so keeping it here lets params be built in a single pass
  // with no hand-written head. It has no DEFAULT_PARAMS* entry: a chainspec
  // should not invent a chain id, and pick() leaving it undefined drops the
  // key, which is what we want.
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
  // EIP-170. The limit itself is a constant, not a transition, so translate()
  // emits maxCodeSize straight from DEFAULT_PARAMS alongside this.
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
  // block reward cut and difficulty-bomb delay: XDPoS pays its own rewards
  // (eth/hooks/engine_v2_hooks.go) and has no bomb to postpone
  eip1234Transition: null,
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
  // in params/protocol_params.go and referenced nowhere in the tree. Nethermind
  // at 16 gas per non-zero byte would misprice every call with calldata.
  // xdc-testnet.json agrees: 999999999999 while the rest of Istanbul is live.
  eip2028Transition: null,
  eip2200Transition: ['istanbulBlock', 'tipXDCXCancellationFeeBlock'],

  // Berlin -- none of it hangs off berlinBlock, see the eip1559Block note above
  // 2565: PrecompiledContractsXDCv2 still has eip2565:false; the first set that
  // turns it on is PrecompiledContractsEIP1559 (core/vm/contracts.go)
  eip2565Transition: 'eip1559Block',
  // 2718: same txpool gate as 2930 below -- every non-legacy tx type is
  // rejected while !rules.IsEIP1559
  eip2718Transition: 'eip1559Block',
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
  eip3554Transition: null,           // another bomb delay, nothing to delay

  // Merge
  eip4399Transition: 'mergeBlock',   // PREVRANDAO, newMergeInstructionSet

  // Shanghai. Only PUSH0 is really gated on shanghaiBlock: enable3855 is the
  // sole entry in newShanghaiInstructionSet.
  // 3651: the warm-coinbase AddAddress sits inside Prepare's IsEIP1559 branch
  eip3651Transition: 'eip1559Block',
  eip3855Transition: 'shanghaiBlock',
  // 3860: IntrinsicGas takes rules.IsEIP1559 as its isEIP3860 argument
  eip3860Transition: 'eip1559Block',
  // announces SELFDESTRUCT's deprecation and changes no rule; nothing in
  // XDPoSChain reads it
  eip6049Transition: null,
  // withdrawals: XDPoSChain's header type has no withdrawalsRoot, so Nethermind
  // must not start expecting one
  eip4895Transition: null,

  // Cancun
  eip1153Transition: 'cancunBlock',
  // beacon-roots system call at the top of every block; XDPoSChain makes no
  // such call and carries no parentBeaconBlockRoot
  eip4788Transition: null,
  eip4844Transition: 'cancunBlock',
  eip5656Transition: 'cancunBlock',
  eip6780Transition: 'cancunBlock',
  eip7516Transition: 'cancunBlock',  // BLOBBASEFEE, enable7516 in the Cancun set

  // Prague. XDPoSChain gates three EIPs on IsPrague: 2935 (history contract),
  // 7623 (calldata floor cost) and 7702 (setcode tx, the only opcode-level
  // change — newPragueInstructionSet is Cancun plus enable7702).
  eip2537Transition: null,   // BLS precompiles: activePrecompiledContracts has
                             // no Prague case, it falls through to the
                             // EIP-1559 set
  eip2935Transition: 'pragueBlock',
  eip6110Transition: null,   // beacon-chain EIPs; each would also put an
  eip7002Transition: null,   // EIP-7685 requestsHash in the block header
  eip7251Transition: null,
  eip7702Transition: 'pragueBlock',
  eip7623Transition: 'pragueBlock',

  // Osaka is unreachable from a chainspec, so the whole fork is null. XDPoSChain
  // does gate five of these on IsOsaka -- 7823 and 7883 (modexp input cap and
  // repricing, in PrecompiledContractsOsaka), 7825 (tx gas cap, params.MaxTxGas),
  // 7934 (RLP block size cap, params.MaxBlockSize) and 7939 (CLZ opcode:
  // newOsakaInstructionSet is Prague plus enable7939) -- but Nethermind's XDC
  // build declares EVERY Osaka EIP as eipNNNNTransitionTimestamp only, with no
  // block-numbered eipNNNNTransition property to bind (verified against
  // Nethermind.Specs.dll in nethermindeth/nethermind:xdc-fixes). A block value
  // under those names is an unknown JSON member and is silently ignored, so
  // emitting one would read as "Osaka is on" while Nethermind ran without it.
  // See the osakaBlock warning in translate(): no chainspec can follow a Go node
  // into Osaka, EIP-7907's 32768-byte code limit included.
  eip7594Transition: null,   // also not implemented: PeerDAS, no blobs here
  eip7823Transition: null,
  eip7825Transition: null,
  eip7883Transition: null,
  eip7918Transition: null,   // also not implemented: no blob header fields
  eip7934Transition: null,
  eip7939Transition: null,
  eip7951Transition: null,   // also not implemented: P256VERIFY is not in
                             // PrecompiledContractsOsaka
};

// The second way genesis reaches an engine param: a flat genesis.config key
// whose name differs from the chainspec key. (The first is chain data that keeps
// its name, which translate() merges by name.) Per engine, chainspec key -> the
// genesis.config key it comes from. The two engines bind
// different names for the same thing, so the tables are separate rather than
// one table with a rename step. A key here that is not in the matching
// DEFAULT_ENGINE* table is emitted only when genesis states it.
const ENGINE_GENESIS_KEYS = {
  XDPoS: {
    tip2019Block: 'tip2019Block',
    DynamicGasLimitBlock: 'dynamicGasLimitBlock',
    TipXDCX: 'tipXDCXBlock',
    blackListHFNumber: 'denylistBlock',
    TipTrc21Fee: 'tipTRC21FeeBlock',
    TIPXDCXMinerDisable: 'tipXDCXMinerDisableBlock',
    TIPXDCXReceiverDisable: 'tipXDCXReceiverDisableBlock',
  },
  XDPoSSubnet: {
    DynamicGasLimitBlock: 'dynamicGasLimitBlock',
    tip2019Block: 'tip2019Block',
    BlackListHFNumber: 'denylistBlock',
    TipTrc21Fee: 'tipTRC21FeeBlock',
  },
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

// Lowercase, 0x-prefixed. Clients accept this fine; we don't bother with the
// cosmetic EIP-55 mixed-case checksum.
function normalizeAddress(addr) {
  return '0x' + String(addr).toLowerCase().replace(/^0x/, '');
}

/* ------------------------------------------------------------------ *
 * Builders — one per section of the chainspec
 * ------------------------------------------------------------------ */

// engine.<name>.params.v2Configs: the per-round XDPoS V2 settings, in round
// order. Every field is carried through as genesis states it, bar
// expTimeoutConfig, which the chainspec schema has no key for and so is dropped
// rather than invented.
function buildV2Configs(v2, opts) {
  return Object.keys(v2.allConfigs || {})
    .sort((a, b) => Number(a) - Number(b))
    .map((round) => {
      const { expTimeoutConfig, ...rest } = v2.allConfigs[round];
      if (!opts.subnet) {
        return rest;
      }
      // genesis carries no maxMasternodes on a subnet, but the working subnet
      // chainspec states it. Key spellings are left as genesis writes them --
      // the reference capitalises them, but binding is case-insensitive.
      return { maxMasternodes: DEFAULT_SUBNET_EXTRAS.maxMasternodes, ...rest };
    });
}

// engine.XDPoS.params, or engine.XDPoSSubnet.params with opts.subnet. Which
// default table and which genesis-key map apply is the only difference between
// the two engines here; the engine block is named by translate().
function buildEngineParams(cfg, opts) {
  const xdpos = cfg.XDPoS || {};
  const v2 = xdpos.v2 || {};

  // chain data, read the same way for both engines
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
    v2Configs: buildV2Configs(v2, opts),
  };

  const engineDefaults = opts.subnet ? DEFAULT_ENGINE_SUBNET : DEFAULT_ENGINE;
  const engineGenesisKeys = opts.subnet
    ? ENGINE_GENESIS_KEYS.XDPoSSubnet
    : ENGINE_GENESIS_KEYS.XDPoS;

  // The whole default table is spread in rather than restated key by key: a
  // value belongs to exactly one place, the DEFAULT_ENGINE* table, which also
  // fixes the emitted key order. Adding a constant there is all it takes to have
  // it emitted -- the older hand-copied version silently dropped any key whose
  // assignment nobody remembered to write out.
  //
  // One rule for what follows: the table is a fallback, never a winner.
  // Whatever genesis states beats it, and a table entry only shows up where
  // genesis is silent. Genesis reaches a key two ways, hence two passes; both
  // re-assign keys the spread already created, so key order stays the table's.
  const engineParams = { ...shared, ...engineDefaults };

  // 1. chain data off genesis.config.XDPoS, which keeps its name. A table key of
  //    the same name (e.g. switchEpoch) backstops it rather than overwriting it:
  //    the raw spread alone would let the constant win and silently replace, say,
  //    a switchEpoch of 900 with 0, putting the two clients on different epochs.
  for (const key of Object.keys(engineDefaults)) {
    if (key in shared) {
      engineParams[key] = pick(shared[key], engineDefaults[key]);
    }
  }
  // 2. flat genesis.config keys, which are named differently on each side
  for (const [key, genesisKey] of Object.entries(engineGenesisKeys)) {
    engineParams[key] = pick(cfg[genesisKey], engineDefaults[key]);
  }

  // XDC hardfork blocks carried straight through. Absent in genesis => absent
  // from the chainspec, so the fork stays off rather than activating at 0.
  // These are XDPoS spellings; the subnet engine binds none of them, and the
  // working subnet chainspec carries none.
  if (!opts.subnet) {
    for (const [key, genesisKey] of Object.entries(ENGINE_FORKS)) {
      engineParams[key] = cfg[genesisKey];
    }
  }

  return engineParams;
}

// params: the chain rules, which here is almost entirely EIP transitions.
function buildParams(cfg, opts) {
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
  params.MaxCodeSize = pickMaxCodeSize(cfg, params.MaxCodeSizeTransition, paramDefaults);

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
function pickMaxCodeSize(cfg, maxCodeSizeTransition, paramDefaults) {
  const osakaBlock = cfg.osakaBlock;
  if (osakaBlock === undefined || osakaBlock === null) {
    return paramDefaults.MaxCodeSize;
  }

  // maxCodeSize is the one piece of Osaka a chainspec can carry at all.
  console.error(
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
  console.error(
    `Warning: genesis states osakaBlock ${osakaBlock}, later than ` +
      `maxCodeSizeTransition ${maxCodeSizeTransition}. XDPoSChain raises ` +
      'its code limit to 32768 there; the chainspec holds one limit only, so it ' +
      'keeps 24576 and the Nethermind nodes stay stricter from osakaBlock on.'
  );
  return paramDefaults.MaxCodeSize;
}

// genesis: the genesis block header, carried through verbatim except for the
// base fee, which genesis.json leaves null.
function buildGenesisBlock(genesis, opts) {
  return {
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
    baseFeePerGas: pick(genesis.baseFeePerGas, DEFAULT_BASE_FEE_PER_GAS),
  };
}

/* ------------------------------------------------------------------ *
 * Translation
 * ------------------------------------------------------------------ */

function translate(genesis, opts = {}) {
  const cfg = genesis.config || {};

  // Subnet nodes run a different consensus plugin than a standalone XDPoS
  // network, and Nethermind selects it by this key. The mapping notes above
  // spell it "engine.XDPoS" throughout; with opts.subnet the whole block is
  // named engine.XDPoSSubnet instead, contents unchanged.
  const engineName = opts.subnet ? 'XDPoSSubnet' : 'XDPoS';

  return {
    name: opts.name || DEFAULT_CHAIN_NAME,
    engine: { [engineName]: { params: buildEngineParams(cfg, opts) } },
    params: buildParams(cfg, opts),
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
