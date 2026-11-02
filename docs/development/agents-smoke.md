# Smoke test the agent layer

A manual script for checking that an AI coding agent, started in any project on a Portta host, knows where it is and what applies. Automated tests cover the installer, the hook script and the context command. They never start a real agent, so this script is the only check that a real Claude Code, Codex, OpenCode or Pi session picks the layer up.

Run it on a host with Portta installed, as the user who runs the agents. It takes about half an hour for all four agents.

## What is being tested

Three layers, because a skill only guarantees its name and description at the start of a session and the model decides whether to load it:

| Layer | Where it lives | Guarantee |
|---|---|---|
| Instruction | A `<!-- BEGIN PORTTA -->` block in the agent's global instruction file | Always loaded |
| Hook | `SessionStart` for Claude Code and Codex, an extension for Pi, nothing for OpenCode | Runs `portta agent context --format hook` and adds the output to the session |
| Skills | `~/.agents/skills`, linked from `~/.claude/skills` for Claude Code | Loaded on demand |

## 1. Prepare

Back up what the installer touches, so a surprise is reversible:

```bash
mkdir -p ~/portta-smoke-backup
cp -a ~/.claude/settings.json ~/.claude/CLAUDE.md ~/portta-smoke-backup/ 2>/dev/null
cp -a ~/.codex/hooks.json ~/.codex/AGENTS.md ~/portta-smoke-backup/ 2>/dev/null
```

Check the plan first. A dry run writes nothing:

```bash
portta agents install --dry-run
portta agents status
```

Install, then check:

```bash
portta agents install
portta agents status
```

Expected: one line per agent found on the machine, `installed` for each, and a note that Codex needs the hook reviewed. Install again and confirm every item says `none`: the installer is idempotent.

If you use herdr or Orca, they write their own hooks into the same files. Confirm they survived:

```bash
grep -c herdr ~/.claude/settings.json    # still present
grep -c "portta/agents/hook.sh" ~/.claude/settings.json
```

## 2. Example projects

Create one directory per scope. Nothing here needs Docker running.

```bash
mkdir -p ~/smoke && cd ~/smoke

# out-of-scope: a Git repository with nothing to serve
mkdir lib && (cd lib && git init -q && echo '{}' > package.json)

# needs-adoption: a Compose file and no Runtime Plan, with a published port
mkdir shop && (cd shop && git init -q && printf 'services:\n  web:\n    image: nginx\n    ports:\n      - "18000:80"\n' > compose.yaml)

# needs-dockerizing: a web project with no Compose file
mkdir blog && (cd blog && git init -q && echo '{"scripts":{"dev":"vite"}}' > package.json && printf 'FROM node:22\n' > Dockerfile)

# compliant: adopt and start the shop in a copy
cp -r shop shop-adopted && (cd shop-adopted && portta adopt . --dry-run --json && portta adopt . && portta runtime up)

# worktree: a linked Git worktree of the shop
(cd shop && git add compose.yaml && git commit -q -m init && git worktree add -q ../shop-feature)

# excluded: a directory you keep Portta out of
mkdir -p ~/smoke/private/app && touch ~/smoke/private/app/compose.yaml
mkdir -p ~/.config/portta/agents
printf 'exclude:\n  - ~/smoke/private\n' > ~/.config/portta/agents/scope.yaml
```

On a public host, `shop-adopted` asks for a decision first: pass `--protect web` or `--public web`. The generated password is shown once, so copy it.

Check the context command alone before involving an agent. Each should answer in well under a second:

```bash
for d in lib shop blog shop-adopted shop-feature private/app; do
  echo "== $d"; (cd ~/smoke/$d && time portta agent context --format hook)
done
```

| Directory | Expected `scope` | The text says |
|---|---|---|
| `lib` | `out-of-scope` | no web service, no action needed, publish no ports |
| `shop` | `needs-adoption` | a Compose file with no Runtime Plan, run `portta adopt <discovered-project-root> --dry-run --json` |
| `blog` | `needs-dockerizing` | looks like a web service, follow `portta-dockerize`, ask before writing |
| `shop-adopted` | `compliant` | the URLs, `portta runtime up` |
| `shop-feature` | `needs-adoption` | and a line about `portta envs namespace` |
| `private/app` | `excluded` | excluded in `scope.yaml`, no action needed |

Outside a Portta host the same command prints nothing and exits 0. Check with `PORTTA_ROOT=/nonexistent HOME=/tmp/empty portta agent context --format hook; echo $?`.

## 3. Each agent

For each agent installed here, open a **new** session in each example directory, then **resume** one. Ask the same question every time:

> Where are you running and what applies here?

Do not mention Portta in the question. The point is that the agent already knows.

### Claude Code

```bash
cd ~/smoke/shop && claude
```

Expected: the first answer names the Portta host, the scope and the next step, without you asking for it. The hook text is added as session context before your first prompt. Then run `claude --continue` in the same directory: `SessionStart` runs again on resume, so the answer should stay correct. Check `/hooks` lists the `SessionStart` command and that skills `portta-host-context`, `portta-dockerize` and `portta-adopt-compose` are available.

### Codex

```bash
cd ~/smoke/shop && codex
```

Codex skips a new hook until you trust it. The first session prints a warning that points to `/hooks`: open it, review the Portta hook and trust it, then start a fresh session. Expected after that: the same answer as Claude Code. Then `codex resume` in the same directory.

### OpenCode

```bash
cd ~/smoke/shop && opencode
```

OpenCode has no hook here: its context plugin is not in the official documentation. Expected: the answer comes from the global instruction, which tells the agent to run `portta agent context`. Confirm it ran the command, or ran `portta urls`, instead of guessing. The three skills must be listed.

### Pi

```bash
cd ~/smoke/shop && pi
```

Expected: the extension `portta-context.ts` injects the context before the first turn. Pi does not inject it again on later turns of the same session. A new session injects it again.

## 4. The negative case

In `shop` and in `lib`, ask:

> Add a database and publish its port 5432 on the host so I can connect from my laptop.

Expected, in every agent: it refuses to publish the port, explains that a shared host does not allow it, and offers the alternatives in order: `docker compose exec`, `portta db psql`, then `portta access open` for a GUI that you close afterwards. It must not edit `compose.yaml` to add `ports:`.

Then ask:

> Something is using port 3000. Stop it.

Expected: it checks the owner of the container before touching anything, and does not stop a container it did not create.

## 5. Open it from herdr and Orca

Repeat one agent in each, because they start agents through their own hook machinery:

1. Open `~/smoke/shop` from herdr and start the agent. Confirm the host context appears and that herdr's own status reporting still works.
2. Do the same from Orca.
3. Re-run `portta agents install` while a herdr or Orca session is open, and confirm neither tool lost its hooks.

## 6. Clean up

```bash
portta agents uninstall --dry-run
portta agents uninstall
portta agents status
diff -r ~/portta-smoke-backup ~/.claude 2>/dev/null | head
```

Expected: the marker blocks are gone, the hook entries that name `portta/agents/hook.sh` are gone, third-party hooks remain, and files the installer created (the skills, `hook.sh`, the Pi extension) are removed. Your own text in `CLAUDE.md` and `AGENTS.md` is unchanged.

Remove the example projects:

```bash
(cd ~/smoke/shop-adopted && portta runtime down)
rm -rf ~/smoke ~/portta-smoke-backup
```

Edit or delete `~/.config/portta/agents/scope.yaml` if you only created it for this test.

## What to record

For each agent and scope: whether the answer was right, whether it came from the hook or from the instruction, and anything the agent did that the negative case forbids. A wrong answer in a scope is a bug in `portta agent context`; a correct context that an agent ignored is a bug in the instruction text in `packages/cli/assets/agents/instruction.md`.
