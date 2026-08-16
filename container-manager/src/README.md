# container-manager

`npm run dev`

## genesis.json -> chainspec.json

`npm run convert -- <genesis.json> <chainspec.json>` translates a go-ethereum /
XDC `genesis.json` into the `chainspec.json` the Nethermind nodes consume. Both
paths are required, there are no defaults. Optional: `--name <chain-name>`,
`--base-fee <0x..>`.

The deployment normally does this automatically (see `libs/exec.js`); the command
is for converting a genesis by hand from the host, as a one-off container. Run it
from the directory holding `start.sh`:

```bash
docker run --rm -v $PWD/generated:/mount/generated \
  xinfinorg/subnet-generator:v2.0.0 \
  npm run convert -- /mount/generated/genesis.json /mount/generated/chainspec.json
```

The trailing arguments replace the image's default `npm run start`, so no server
comes up and the container exits when the conversion is done. `/mount/generated`
inside the container is `./generated` on the host; relative paths resolve against
`/app`, so pass absolute container paths.

## Pre-boot check

`check-chainspec.sh` ships in every generated deployment folder, next to
`docker-up.sh`. Run it before booting: it re-translates `genesis.json` and
compares the result with `chainspec.json`, since a stale chainspec gives the
Nethermind nodes a different genesis block than the XDC nodes.

```bash
./check-chainspec.sh              # check, and repair if they differ
./check-chainspec.sh --dry-run    # report only
```

On a difference it lists the offending keys, moves the old file to
`archive/chainspec.<UTC timestamp>.json`, and writes the chainspec that
`genesis.json` translates to. Exit codes: `0` already matched, `1` differed,
`2` error — so `./check-chainspec.sh && ./docker-up.sh machine1` stops after a
repair and lets you decide whether node data directories need wiping.

It runs on the host's `node` if there is one, otherwise inside a throwaway
`node:24-alpine` container (`CHECK_IMAGE` overrides the image). The check itself
is `scripts/check-chainspec.js`, copied into the deployment folder at generation
time along with `scripts/genesis-to-chainspec.js`, so it needs neither this
container nor a network. Inside the container manager the same check is
`npm run check-chainspec -- <genesis.json> <chainspec.json>`.
