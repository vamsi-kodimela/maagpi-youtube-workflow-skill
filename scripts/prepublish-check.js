#!/usr/bin/env node
// Prepublish sanity check. Runs via `npm run prepublishOnly` before publish
// and via `npm run prepack` before `npm pack`. Verifies that every artifact
// the published package promises is actually present, non-empty, and that
// SKILL.md still binds to the expected skill name.

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const required = [
    'SKILL.md',
    'README.md',
    'LICENSE',
    'package.json',
    'bin/cli.js',
    'schemas/notion-databases.md',
    'schemas/channel-state.example.json',
];

let failed = false;

for (const rel of required) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) {
        console.error(`MISSING: ${rel}`);
        failed = true;
        continue;
    }
    if (fs.statSync(p).size === 0) {
        console.error(`EMPTY  : ${rel}`);
        failed = true;
    }
}

// SKILL.md must declare the right skill name in its frontmatter, otherwise
// /youtube-content-workflow won't dispatch after install.
const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
if (!skill.startsWith('---\n')) {
    console.error('SKILL.md does not start with YAML frontmatter');
    failed = true;
}
if (!/^name:\s*youtube-content-workflow\s*$/m.test(skill)) {
    console.error('SKILL.md frontmatter is missing `name: youtube-content-workflow`');
    failed = true;
}

// CLI must be a Node script with the shebang so npm sets the executable bit
// on POSIX systems.
const cli = fs.readFileSync(path.join(ROOT, 'bin/cli.js'), 'utf8');
if (!cli.startsWith('#!/usr/bin/env node')) {
    console.error('bin/cli.js is missing the `#!/usr/bin/env node` shebang');
    failed = true;
}

if (failed) {
    console.error('\nPrepublish check FAILED.');
    process.exit(1);
}
console.log('Prepublish check passed.');
