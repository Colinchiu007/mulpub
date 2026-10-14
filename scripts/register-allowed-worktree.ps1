<#
.SYNOPSIS
    Single recommended entry point for the managed foreign-worktree registry
    (register / purge dead entries / self-check).
.DESCRIPTION
    Background: the registry (%LOCALAPPDATA%\Mulpub\session-isolation\allowed-worktrees.json)
    is a machine-local file outside git. It used to be editable only by hand, which caused
    two observed problems:

    1) No lifecycle management. Once a registered worktree was deleted its entry stayed
       forever, with nothing in the report flagging it. Observed case: wt-mp-ccgrecord
       disappeared around 2026-10-07 but its entry was still in the table on 2026-10-14.
    2) harness-level agent tools (auto-exec family) register linked worktrees outside the
       isolation directory, and they never register them, so the `outside` criterion in
       mp-worktree-health.ps1 turns red deterministically and start-mp-task.ps1 cannot run
       to completion. This is a mechanical consequence, not an accident.

    This script funnels the register action into one self-checking entry point:

      -Register <path>  register a foreign worktree (exact full-path match, no prefix glob)
      -Remove <path>    unregister an entry
      -Clean            drop every dead entry (path absent AND not a registered linked worktree)
      -Verify           read-only self-check: report liveness of each entry, write nothing
      -List             read-only print of the current registry

    Register/purge actions append to an audit log (same directory as safe-delete) so that
    "who registered what" stays traceable. The matching rule is identical to
    mp-worktree-health.ps1: exact match after normalisation (slash unification, trailing
    slash removal, lower-casing).

    NOTE ON ENCODING: this file is deliberately ASCII-only. Windows PowerShell 5.1 reads a
    BOM-less UTF-8 file as GBK, so any non-ASCII byte (even inside a comment) can decode into
    a stray quote/paren and break the parser. Observed while writing the first draft of this
    script: 5.1 reported ParserError at lines that only differed by a Chinese comment.
    Keep it ASCII, or add a BOM and re-verify under 5.1.

.EXAMPLE
    pwsh -File scripts/register-allowed-worktree.ps1 -Register D:\Temp\egress-base
.EXAMPLE
    pwsh -File scripts/register-allowed-worktree.ps1 -Verify
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$Register = '',
    [string]$Remove = '',
    [switch]$Clean,
    [switch]$Verify,
    [switch]$List,
    [string]$RegistryPath = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sessionDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Mulpub\session-isolation'
if ([string]::IsNullOrWhiteSpace($RegistryPath)) { $RegistryPath = Join-Path $sessionDir 'allowed-worktrees.json' }
$auditLog = Join-Path $sessionDir 'allowed-worktrees-audit.log'

function NormKey([string]$p) {
    if ([string]::IsNullOrWhiteSpace($p)) { return '' }
    return $p.Replace('\', '/').TrimEnd('/').ToLowerInvariant()
}

function Write-Audit([string]$action, [string]$detail) {
    try {
        if (-not (Test-Path -LiteralPath $sessionDir)) { New-Item -ItemType Directory -Force -Path $sessionDir | Out-Null }
        $line = ('{0} [{1}] {2} {3}' -f (Get-Date).ToUniversalTime().ToString('o'), $env:USERNAME, $action, $detail)
        Add-Content -LiteralPath $auditLog -Value $line -Encoding UTF8
    } catch {
        Write-Warning "audit log write failed (the registry action itself still applies): $($_.Exception.Message)"
    }
}

function Read-Registry([string]$path) {
    # Parse failure is treated as an empty table with a warning. This matches the
    # fail-closed rule in mp-worktree-health.ps1, where a parse failure sets
    # allowedRegistry.valid=false and therefore turns unregistered outside worktrees red again.
    if (-not (Test-Path -LiteralPath $path)) { return @() }
    try {
        $parsed = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        $out = @()
        foreach ($e in @($parsed)) {
            if ($e -is [string] -and $e.Trim()) { $out += $e.Trim() }
            else { Write-Warning "registry contains a non-string entry (ignored): $e" }
        }
        return $out
    } catch {
        Write-Warning "registry JSON parse failed, treating as empty table: $($_.Exception.Message)"
        return @()
    }
}

function Write-Registry([string]$path, [string[]]$keys) {
    $dir = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    # Sort before writing: the same set yields the same file regardless of registration
    # order, which keeps diffs reviewable.
    $sorted = @($keys | Sort-Object -Unique)
    # UTF8 without BOM: Set-Content -Encoding UTF8 under PowerShell 5.1 emits a BOM.
    # ConvertFrom-Json tolerates it, but staying BOM-less matches the other JSON carriers.
    [IO.File]::WriteAllText($path, ($sorted | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
}

# Live linked worktrees of this repo: an entry counts as live while it is still listed by
# `git worktree list`, even if the path is temporarily unreachable (e.g. a moved drive).
$git = $env:MP_GIT
if (-not $git) {
    $gitCmd = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($gitCmd -and $gitCmd.Source) { $git = $gitCmd.Source }
}
if (-not $git) { $git = 'git' }
$liveWorktrees = @()
try {
    $lines = & $git -C $repoRoot worktree list --porcelain 2>$null
    $liveWorktrees = @($lines | Where-Object { $_ -like 'worktree *' } | ForEach-Object { NormKey $_.Substring(9) })
} catch {
    Write-Warning "reading git worktree list failed (liveness degrades to 'path exists only'): $($_.Exception.Message)"
}

function Is-Live([string]$key) {
    if (-not $key) { return $false }
    if ($liveWorktrees -contains $key) { return $true }
    return (Test-Path -LiteralPath ($key -replace '/', '\'))
}

$entries = Read-Registry $RegistryPath
$keys = @($entries | ForEach-Object { NormKey $_ } | Where-Object { $_ })

$didSomething = $false

if ($Register) {
    $k = NormKey $Register
    if (-not $k) { throw '-Register needs a non-empty path' }
    $resolved = ($k -replace '/', '\')
    try { $resolved = (Resolve-Path -LiteralPath ($k -replace '/', '\') -ErrorAction Stop).Path } catch { }
    $rk = NormKey $resolved
    if ($keys -contains $rk) {
        Write-Host "already registered: $rk"
    } else {
        $keys += $rk
        Write-Registry $RegistryPath $keys
        $liveNote = if (Is-Live $rk) { 'live=true' } else { 'live=false (target did not exist at registration time)' }
        Write-Audit 'REGISTER' ("path=$rk $liveNote")
        Write-Host "registered: $rk"
        $didSomething = $true
    }
}

if ($Remove) {
    $k = NormKey $Remove
    if (-not $k) { throw '-Remove needs a non-empty path' }
    if ($keys -contains $k) {
        $keys = @($keys | Where-Object { $_ -ne $k })
        Write-Registry $RegistryPath $keys
        Write-Audit 'REMOVE' "path=$k"
        Write-Host "unregistered: $k"
        $didSomething = $true
    } else {
        Write-Host "not registered (no-op): $k"
    }
}

if ($Clean) {
    $stale = @($keys | Where-Object { -not (Is-Live $_) })
    if ($stale.Count -eq 0) {
        Write-Host 'no dead entries.'
    } else {
        $keys = @($keys | Where-Object { $stale -notcontains $_ })
        Write-Registry $RegistryPath $keys
        Write-Audit 'CLEAN' ("removed=" + ($stale -join ' ; '))
        Write-Host ("purged {0} dead entr(y|ies): {1}" -f $stale.Count, ($stale -join ' ; '))
        $didSomething = $true
    }
}

# -Verify / -List do not exclude the mutating switches above: apply changes first, then
# self-check, so what you see is always the new state.
if ($Verify -or $List -or -not $didSomething) {
    if ($keys.Count -eq 0) {
        Write-Host 'registry is empty.'
    } else {
        $staleCount = 0
        foreach ($k in ($keys | Sort-Object)) {
            $live = Is-Live $k
            if (-not $live) { $staleCount++ }
            $mark = if ($live) { 'live ' } else { 'STALE' }
            Write-Host ("  [{0}] {1}" -f $mark, $k)
        }
        Write-Host ("total {0} entr(y|ies), {1} dead." -f $keys.Count, $staleCount)
        if ($staleCount -gt 0) {
            Write-Host 'purge: pwsh -File scripts/register-allowed-worktree.ps1 -Clean'
        }
    }
}

if ($didSomething) {
    Write-Host "registry: $RegistryPath"
    Write-Host "audit log: $auditLog"
}
