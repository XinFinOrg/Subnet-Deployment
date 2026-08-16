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
