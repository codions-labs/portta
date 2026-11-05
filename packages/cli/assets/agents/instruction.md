## Portta host

This machine may run Portta, which routes every Docker project at `<project>--<service>.<domain>`.
At the start of a session, run `portta agent context` unless its output is already in your context.

Never: publish a host port, run `docker * prune`, stop or remove what you did not create, take the gateway down, or reuse another environment's volume or namespace.
Always: report URLs from `portta urls`, and follow the `portta-host-context` skill when starting or exposing containers.
If the command is missing, this is not a Portta host and none of this applies.
