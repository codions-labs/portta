# SSH keys owned by Portta

Open **Settings → Environment → SSH keys** to generate, import, inspect, test or
remove credentials owned by this Portta installation.

## Generate or import

Generated keys use ED25519 by default. RSA is available at 4096 bits for a
service that requires it. An import accepts an unencrypted ED25519 or RSA
private key and derives the public key locally. The private value is write-only:
it is not returned by the API and the panel cannot display it later.

Copy the public key from the expanded row and add it to the GitHub, GitLab or
Bitbucket account that should accept it. **Test** performs only an SSH
authentication greeting against the selected forge; it does not clone, fetch
or push a repository. The greeting uses `StrictHostKeyChecking=yes` against
host keys Portta pins from each forge's published catalogue, so the first
connection cannot accept an unexpected host key. GitHub's successful greeting
exits with status 1, which Portta recognises as success.

## Storage and permissions

Private keys live in `state/ssh/<id>` with mode `0600`; public keys use
`state/ssh/<id>.pub` with mode `0644`. The directory uses `0700`. The database
contains public material and metadata only. Portta does not encrypt private
keys at rest, so host disk encryption and backup policy remain the operator's
responsibility.

Viewers and developers may list and copy public keys. Only owners and
administrators may generate, import, test or remove them. Audit entries for
those mutations contain the name and SHA256 fingerprint, never private key
material.

`portta envs report` includes the directory mode in the host-security report.
If it warns, run `portta repair` or set it directly:

```bash
chmod 700 "$PORTTA_HOME/state/ssh"
```

Removing a key permanently removes both files and its metadata. Remove its
public key from each forge separately if it should no longer authenticate.
