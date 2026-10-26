/**
 * Test preload: the app's settings config goes to a scratch file per test
 * run, so no test can read or overwrite the user's real settings.json.
 */
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

process.env.JASKMONEY_CONFIG = join(mkdtempSync(join(tmpdir(), "jaskmoney-test-")), "settings.json")
