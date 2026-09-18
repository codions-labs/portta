// Unit tests call command functions directly, so no CLI action ever registers
// a JSON schema for them. A default keeps `Output.data` under `--json` working
// in tests; the CLI itself sets the real name from the command path.
import { setJsonSchema } from '../src/output.js'

setJsonSchema('test')
