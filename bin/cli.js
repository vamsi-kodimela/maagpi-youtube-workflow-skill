#!/usr/bin/env node
// CLI entry point for the youtube-content-workflow Claude Code skill.
// Invoked as:
//   npx youtube-content-workflow install
//   npx youtube-content-workflow uninstall [--purge] [--yes]
//   npx youtube-content-workflow --help
//
// Mirrors install.sh / install.ps1 — installer is idempotent.

'use strict';

const fs       = require('node:fs');
const path     = require('node:path');
const os       = require('node:os');
const readline = require('node:readline');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SKILL_NAME   = 'youtube-content-workflow';
const HOME         = os.homedir();
const CLAUDE_DIR   = path.join(HOME, '.claude');
const SKILLS_DIR   = path.join(CLAUDE_DIR, 'skills');
const INSTALL_DIR  = path.join(SKILLS_DIR, SKILL_NAME);
const SCHEMAS_DST  = path.join(INSTALL_DIR, 'schemas');
const STATE_DIR    = path.join(INSTALL_DIR, 'state');
const CHANNELS_DIR = path.join(STATE_DIR, 'channels');
const RUNS_DIR     = path.join(STATE_DIR, 'runs');
const CLAUDE_MD    = path.join(CLAUDE_DIR, 'CLAUDE.md');

const REGISTRATION_BLOCK =
`
# youtube-content-workflow
- **youtube-content-workflow** (\`~/.claude/skills/youtube-content-workflow/SKILL.md\`) - End-to-end YouTube production pipeline (channel context -> Notion calendar -> SUCCESS-framework titles -> NotebookLM deep research -> Explainer video -> transcript -> description -> thumbnail -> tags -> scheduled upload, never public). Trigger: \`/youtube-content-workflow\`
When the user types \`/youtube-content-workflow\`, invoke the Skill tool with \`skill: "youtube-content-workflow"\` before doing anything else.
`;

const HEADER_RE  = /^# youtube-content-workflow$/m;
const FOOTER_RE  = /^When the user types `\/youtube-content-workflow`/;

function printHelp() {
    console.log(
`youtube-content-workflow — Claude Code skill installer

Usage:
  npx youtube-content-workflow install              Install (idempotent; safe to re-run)
  npx youtube-content-workflow uninstall            Remove SKILL.md + CLAUDE.md block, KEEP state/
  npx youtube-content-workflow uninstall --purge    Also delete state/ (irreversible)
  npx youtube-content-workflow uninstall --yes      Skip confirmation prompt
  npx youtube-content-workflow --help               Show this help

After install, trigger the skill in Claude Code with:
  /youtube-content-workflow

Prerequisite MCPs (install separately):
  - YouTube MCP            (channels list, schedule upload, privacy private/unlisted)
  - Image generation MCP   (Nano Banana Pro preferred)
  - Notion MCP             (already installed if you use the legacy youtube skills)
  - NotebookLM MCP         (already installed if you use the legacy youtube skills)

Privacy: skill never publishes public — pre-flight assertion enforced.`
    );
}

function ensureDir(p) {
    if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true });
        console.log(`  created dir : ${p}`);
    }
}

function install() {
    console.log('Installing youtube-content-workflow skill');
    console.log(`  source : ${PACKAGE_ROOT}`);
    console.log(`  target : ${INSTALL_DIR}`);
    console.log('');

    // 1. Ensure directory tree.
    ensureDir(CLAUDE_DIR);
    ensureDir(SKILLS_DIR);
    ensureDir(INSTALL_DIR);
    ensureDir(SCHEMAS_DST);
    ensureDir(STATE_DIR);
    ensureDir(CHANNELS_DIR);
    ensureDir(RUNS_DIR);

    // 2. Copy SKILL.md.
    const skillSrc = path.join(PACKAGE_ROOT, 'SKILL.md');
    if (!fs.existsSync(skillSrc)) {
        console.error(`ERROR: SKILL.md not found at ${skillSrc}`);
        process.exit(1);
    }
    fs.copyFileSync(skillSrc, path.join(INSTALL_DIR, 'SKILL.md'));
    console.log('  copied      : SKILL.md');

    // 3. Copy schemas/ contents.
    const schemasSrc = path.join(PACKAGE_ROOT, 'schemas');
    if (fs.existsSync(schemasSrc) && fs.statSync(schemasSrc).isDirectory()) {
        for (const entry of fs.readdirSync(schemasSrc)) {
            const srcFile = path.join(schemasSrc, entry);
            if (fs.statSync(srcFile).isFile()) {
                fs.copyFileSync(srcFile, path.join(SCHEMAS_DST, entry));
            }
        }
        console.log('  copied      : schemas/');
    }

    // 4. CLAUDE.md registration (idempotent).
    if (!fs.existsSync(CLAUDE_MD)) {
        fs.writeFileSync(CLAUDE_MD, REGISTRATION_BLOCK.trimStart(), 'utf8');
        console.log(`  created     : ${CLAUDE_MD} (with registration block)`);
    } else {
        const existing = fs.readFileSync(CLAUDE_MD, 'utf8');
        if (HEADER_RE.test(existing)) {
            console.log('  CLAUDE.md   : already registered (skipped)');
        } else {
            fs.appendFileSync(CLAUDE_MD, REGISTRATION_BLOCK, 'utf8');
            console.log(`  appended    : registration block to ${CLAUDE_MD}`);
        }
    }

    console.log('');
    console.log('Done. Trigger with: /youtube-content-workflow');
    console.log('Note: install missing prerequisite MCPs (YouTube + image gen) before first use.');
}

function prompt(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

async function uninstall({ purge, yes }) {
    const dirExists = fs.existsSync(INSTALL_DIR);
    let blockExists = false;
    if (fs.existsSync(CLAUDE_MD)) {
        blockExists = HEADER_RE.test(fs.readFileSync(CLAUDE_MD, 'utf8'));
    }

    if (!dirExists && !blockExists) {
        console.log('Nothing to uninstall.');
        return;
    }

    console.log('About to uninstall:');
    if (dirExists) {
        if (purge) console.log(`  - ${INSTALL_DIR} (including state/)`);
        else       console.log(`  - SKILL.md and schemas/ from ${INSTALL_DIR} (state/ preserved)`);
    }
    if (blockExists) console.log(`  - registration block in ${CLAUDE_MD}`);

    if (!yes) {
        const ans = (await prompt('Proceed? [y/N] ')).trim().toLowerCase();
        if (ans !== 'y' && ans !== 'yes') {
            console.log('Aborted.');
            process.exit(1);
        }
    }

    // 1. Remove the install dir (or just SKILL.md + schemas/).
    if (dirExists) {
        if (purge) {
            fs.rmSync(INSTALL_DIR, { recursive: true, force: true });
            console.log(`  removed : ${INSTALL_DIR} (including state/)`);
        } else {
            const skillFile  = path.join(INSTALL_DIR, 'SKILL.md');
            const schemasDir = path.join(INSTALL_DIR, 'schemas');
            if (fs.existsSync(skillFile))  fs.rmSync(skillFile,  { force: true });
            if (fs.existsSync(schemasDir)) fs.rmSync(schemasDir, { recursive: true, force: true });

            const channelsEmpty = !fs.existsSync(CHANNELS_DIR) || fs.readdirSync(CHANNELS_DIR).length === 0;
            const runsEmpty     = !fs.existsSync(RUNS_DIR)     || fs.readdirSync(RUNS_DIR).length === 0;
            if (channelsEmpty && runsEmpty) {
                fs.rmSync(INSTALL_DIR, { recursive: true, force: true });
                console.log(`  removed : ${INSTALL_DIR} (state was empty)`);
            } else {
                console.log(`  removed : SKILL.md + schemas/ (state/ kept under ${INSTALL_DIR})`);
            }
        }
    }

    // 2. Strip the registration block from CLAUDE.md.
    if (blockExists) {
        const lines = fs.readFileSync(CLAUDE_MD, 'utf8').split(/\r?\n/);
        const out = [];
        let skip = false;
        for (const line of lines) {
            if (line === '# youtube-content-workflow') {
                skip = true;
                if (out.length > 0 && out[out.length - 1] === '') out.pop();
                continue;
            }
            if (skip && FOOTER_RE.test(line)) { skip = false; continue; }
            if (skip) continue;
            out.push(line);
        }
        fs.writeFileSync(CLAUDE_MD, out.join('\n'), 'utf8');
        console.log(`  removed : registration block from ${CLAUDE_MD}`);
    }

    console.log('');
    console.log('Done.');
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
        printHelp();
        return;
    }

    const command = args[0];
    const flags = {
        purge: args.includes('--purge'),
        yes:   args.includes('--yes') || args.includes('-y'),
    };

    switch (command) {
        case 'install':
            install();
            break;
        case 'uninstall':
            await uninstall(flags);
            break;
        default:
            console.error(`Unknown command: ${command}`);
            console.error('');
            printHelp();
            process.exit(2);
    }
}

main().catch((err) => {
    console.error(err && err.stack || err);
    process.exit(1);
});
