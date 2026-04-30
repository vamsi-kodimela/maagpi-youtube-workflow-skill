# uninstall.ps1 - Reverses install.ps1. Removes the deployed SKILL.md, schemas,
# and the CLAUDE.md registration block. Preserves state/ by default; pass
# -Purge to also delete state/ (irreversible).
#
# Usage:
#   ./uninstall.ps1             # remove SKILL.md + schemas + CLAUDE.md block, KEEP state/
#   ./uninstall.ps1 -Purge      # also delete state/ (irreversible)
#   ./uninstall.ps1 -Yes        # skip confirmation prompt

[CmdletBinding()]
param(
    [switch]$Purge,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'

$ClaudeDir   = Join-Path $HOME '.claude'
$InstallDir  = Join-Path (Join-Path $ClaudeDir 'skills') 'youtube-content-workflow'
$ClaudeMd    = Join-Path $ClaudeDir 'CLAUDE.md'

$dirExists   = Test-Path $InstallDir
$blockExists = $false
if (Test-Path $ClaudeMd) {
    $blockExists = (Select-String -Path $ClaudeMd -Pattern '^# youtube-content-workflow$' -Quiet)
}

if (-not $dirExists -and -not $blockExists) {
    Write-Host "Nothing to uninstall."
    exit 0
}

Write-Host "About to uninstall:"
if ($dirExists) {
    if ($Purge) {
        Write-Host "  - $InstallDir (including state/)"
    } else {
        Write-Host "  - SKILL.md and schemas/ from $InstallDir (state/ preserved)"
    }
}
if ($blockExists) {
    Write-Host "  - registration block in $ClaudeMd"
}

if (-not $Yes) {
    $ans = Read-Host "Proceed? [y/N]"
    if ($ans -notmatch '^(y|Y|yes|YES)$') {
        Write-Host "Aborted."
        exit 1
    }
}

# 1. Remove the install dir (or just SKILL.md + schemas).
if ($dirExists) {
    if ($Purge) {
        Remove-Item -Path $InstallDir -Recurse -Force
        Write-Host "  removed : $InstallDir (including state/)"
    } else {
        $skillFile = Join-Path $InstallDir 'SKILL.md'
        $schemasDir = Join-Path $InstallDir 'schemas'
        if (Test-Path $skillFile)  { Remove-Item -Path $skillFile -Force }
        if (Test-Path $schemasDir) { Remove-Item -Path $schemasDir -Recurse -Force }

        # If state/channels and state/runs are both empty, clean up entirely.
        $channelsDir = Join-Path $InstallDir 'state\channels'
        $runsDir     = Join-Path $InstallDir 'state\runs'
        $channelsEmpty = -not (Test-Path $channelsDir) -or (@(Get-ChildItem -Path $channelsDir -Force -ErrorAction SilentlyContinue).Count -eq 0)
        $runsEmpty     = -not (Test-Path $runsDir)     -or (@(Get-ChildItem -Path $runsDir     -Force -ErrorAction SilentlyContinue).Count -eq 0)
        if ($channelsEmpty -and $runsEmpty) {
            Remove-Item -Path $InstallDir -Recurse -Force
            Write-Host "  removed : $InstallDir (state was empty)"
        } else {
            Write-Host "  removed : SKILL.md + schemas/ (state/ kept under $InstallDir)"
        }
    }
}

# 2. Strip the registration block from CLAUDE.md.
if ($blockExists) {
    $lines = Get-Content -Path $ClaudeMd -Encoding utf8
    $out   = New-Object System.Collections.Generic.List[string]
    $skip  = $false

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]

        if ($line -eq '# youtube-content-workflow') {
            $skip = $true
            # Drop the previous blank line (artifact of installer leading newline).
            if ($out.Count -gt 0 -and $out[$out.Count - 1] -eq '') {
                $out.RemoveAt($out.Count - 1)
            }
            continue
        }
        if ($skip -and $line -match '^When the user types `/youtube-content-workflow`') {
            $skip = $false
            continue
        }
        if ($skip) { continue }
        $out.Add($line)
    }

    Set-Content -Path $ClaudeMd -Value $out -Encoding utf8
    Write-Host "  removed : registration block from $ClaudeMd"
}

Write-Host ""
Write-Host "Done."
