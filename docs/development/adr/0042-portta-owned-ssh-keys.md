# 0042. Portta-owned SSH keys use a narrow panel boundary

**Status:** Accepted

## Context

Repository and remote-host workflows need SSH credentials. The existing host
runner accepts only typed Compose lifecycle requests; turning it into a general
command or secret runner would enlarge a deliberately small trust boundary.
Keeping private material in the panel's database would also make it easier for an API or
backup to expose it accidentally.

## Decision

The panel owns a dedicated `state/ssh` directory, mounted read-write and scoped
to one Portta installation. The directory is `0700`; private files are created
as `0600` and public files as `0644`. The panel's database stores only name, description,
algorithm, fingerprint, public key, origin and creation time. There is no
private-key column.

The panel image includes the OpenSSH client and exposes typed operations only:
generate ED25519 or RSA-4096, derive a public key from an imported unencrypted
private key, remove a key, and test it against a fixed forge catalogue. Each
operation builds a fixed argv and never invokes a shell. There is no arbitrary
hostname or command surface. A forge test writes that forge's published host
keys and uses `StrictHostKeyChecking=yes`, so the first greeting cannot pin
an unexpected key.

The API never returns private material. Audit rows identify the key by name and
fingerprint only. `ssh:read` is granted to every role; `ssh:manage` only to
owner and administrator. The panel container runs with `PORTTA_WEB_USER`, so
new files have the installation owner's uid from creation rather than being
repaired afterward.

## Consequences

The panel is now a credential-owning process and must keep its dedicated mount
small. Backing up `state/ssh` is an explicit operator decision; Portta does not
encrypt these files at rest. Passphrase-protected imports are refused because
the non-interactive service cannot safely prompt. A future agent-forwarding or
hardware-key feature needs a separate decision rather than weakening this
boundary.
