# Portta: convenience wrapper around ./bin/portta.
#
# Just is a shortcut, never a requirement: every recipe below is a one-line
# call to the CLI, which is the stable operational contract. Flags go through
# as written: `just up --demo`, `just reset --yes --demo`, `just dev --reset --demo`.

# Checkout-only. Portta images are built from the Dockerfiles here, never
# pulled from the published registry. Third-party images stay pinned.
gw := "./bin/portta"

[private]
default:
    @just --list

# Build every Portta-owned image, tagged with a fixed local dev identity
# (never a release version — that's assigned only by CI/CD).
build:
    @{{gw}} build

# Start the gateway from the already-built local release
up *args:
    @{{gw}} up --local-release {{args}}

# Start the gateway and the panel with hot reloading.
# dev rebuilds packages/cli dist when it is stale, then the panel image, and
# links this checkout's `portta` into ~/.local/bin (see `just link`).
dev *args:
    @node tooling/link-cli.mjs link --soft
    @{{gw}} dev {{args}}

# Put this checkout's `portta` on PATH (~/.local/bin, or PORTTA_LINK_DIR).
# Checkout tooling, not a CLI command; never replaces a portta it did not create.
link:
    @node tooling/link-cli.mjs link

# Remove the link created by `just link`
unlink:
    @node tooling/link-cli.mjs unlink

# Stop the gateway; consumer projects keep running unless --demo
down *args:
    @{{gw}} down {{args}}

# Stop every Portta-managed stack, drop volumes, and start like a fresh clone
reset *args:
    @{{gw}} reset {{args}}

# Prepare this checkout (no published Portta image pull)
bootstrap *args:
    @{{gw}} bootstrap --skip-pull {{args}}

# Restart gateway components
restart *args:
    @{{gw}} restart {{args}}

# Compact status overview
status *args:
    @{{gw}} status {{args}}

# Deep diagnostics
doctor *args:
    @{{gw}} doctor {{args}}

# List the hostnames currently routed
urls *args:
    @{{gw}} urls {{args}}

# Follow gateway logs
logs *args:
    @{{gw}} logs {{args}}

# Print the resolved configuration
inspect *args:
    @{{gw}} inspect {{args}}

# Pull pinned images and recreate
update *args:
    @{{gw}} update {{args}}

# Panel: up, dev, down, ...
web *args:
    @{{gw}} web --local-release {{args}}

# Apply pending panel SQL without restarting the panel
db-migrate:
    @{{gw}} db migrate

# Broad integration validation; pass --lint, --e2e or --release
test *args:
    @node tests/run.mjs {{args}}
