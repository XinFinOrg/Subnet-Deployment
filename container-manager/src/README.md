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

`scripts/check-chainspec.sh` ships in every generated deployment folder, and
`docker-up.sh` runs it before starting any container: it re-translates
`genesis.json` and compares the result with `chainspec.json`, since a stale
chainspec gives the Nethermind nodes a different config than the XDC nodes.

```bash
./scripts/check-chainspec.sh              # check, and repair if they differ
./scripts/check-chainspec.sh --dry-run    # report only
```

On a difference it lists the offending keys, moves the old file to
`archive/chainspec.<UTC timestamp>.json`, and writes the chainspec that
`genesis.json` translates to. Exit codes: `0` already matched, `3` differed,
`2` error — `3` rather than `1`, since the check runs in a container and node
exits `1` when it crashes. `docker-up.sh` stops on anything but `0`, so a
repaired chainspec leaves you free to wipe node data directories before running
it again.

The check runs in a throwaway subnet-generator container, which already carries
the converter — the host needs docker only, no node. The image is the one that
generated the deployment: the manager inspects its own container during genesis
generation and records it in `gen.env` as `GENERATOR_IMAGE_VERSION`, so the
check always uses the converter version the chainspec was built with. Export
`GENERATOR_IMAGE_VERSION` to override it. Inside the container manager the same
check is `npm run check-chainspec -- <genesis.json> <chainspec.json>`.
