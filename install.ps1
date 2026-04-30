# install.ps1 - Idempotent installer for the /youtube-content-workflow skill.
# Copies SKILL.md and schemas to ~/.claude/skills/youtube-content-workflow/, creates state
# directories, and registers the slash command in ~/.claude/CLAUDE.md.
#
# Re-running is safe; nothing is duplicated.

$ErrorActionPreference = 'Stop'

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ClaudeDir   = Join-Path $HOME '.claude'
$SkillsDir   = Join-Path $ClaudeDir 'skills'
$InstallDir  = Join-Path $SkillsDir 'youtube-content-workflow'
$SchemasDst  = Join-Path $InstallDir 'schemas'
$StateDir    = Join-Path $InstallDir 'state'
$ChannelsDir = Join-Path $StateDir 'channels'
$RunsDir     = Join-Path $StateDir 'runs'
$ClaudeMd    = Join-Path $ClaudeDir 'CLAUDE.md'

Write-Host "Installing youtube-content-workflow skill"
Write-Host "  source : $ScriptDir"
Write-Host "  target : $InstallDir"
Write-Host ""

# 1. Ensure directories exist.
foreach ($d in @($ClaudeDir, $SkillsDir, $InstallDir, $SchemasDst, $StateDir, $ChannelsDir, $RunsDir)) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        Write-Host "  created dir : $d"
    }
}

# 2. Copy SKILL.md (overwrite).
$SkillSrc = Join-Path $ScriptDir 'SKILL.md'
$SkillDst = Join-Path $InstallDir 'SKILL.md'
if (-not (Test-Path $SkillSrc)) {
    Write-Error "Source SKILL.md not found at $SkillSrc"
    exit 1
}
Copy-Item -Path $SkillSrc -Destination $SkillDst -Force
Write-Host "  copied      : SKILL.md"

# 3. Copy schemas/ contents (overwrite).
$SchemasSrc = Join-Path $ScriptDir 'schemas'
if (Test-Path $SchemasSrc) {
    Get-ChildItem -Path $SchemasSrc -File | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination (Join-Path $SchemasDst $_.Name) -Force
    }
    Write-Host "  copied      : schemas/"
}

# 4. Register the slash command in CLAUDE.md (idempotent).
$marker  = '# youtube-content-workflow'
$block = @'

# youtube-content-workflow
- **youtube-content-workflow** (`~/.claude/skills/youtube-content-workflow/SKILL.md`) - End-to-end YouTube production pipeline (channel context -> Notion calendar -> SUCCESS-framework titles -> NotebookLM deep research -> Explainer video -> transcript -> description -> thumbnail -> tags -> scheduled upload, never public). Trigger: `/youtube-content-workflow`
When the user types `/youtube-content-workflow`, invoke the Skill tool with `skill: "youtube-content-workflow"` before doing anything else.
'@

if (-not (Test-Path $ClaudeMd)) {
    Set-Content -Path $ClaudeMd -Value $block.TrimStart() -Encoding utf8
    Write-Host "  created     : $ClaudeMd (with registration block)"
} else {
    $existing = Get-Content -Path $ClaudeMd -Raw -Encoding utf8
    if ($existing -match [regex]::Escape($marker)) {
        Write-Host "  CLAUDE.md   : already registered (skipped)"
    } else {
        Add-Content -Path $ClaudeMd -Value $block -Encoding utf8
        Write-Host "  appended    : registration block to CLAUDE.md"
    }
}

Write-Host ""
Write-Host "Done. Trigger with: /youtube-content-workflow"
Write-Host "Note: install missing prerequisite MCPs (YouTube + image gen) before first use."
