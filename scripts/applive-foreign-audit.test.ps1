#requires -Version 7
# applive-foreign-audit.test.ps1 - contract tests for the start-app fastpath foreign-holder audit.
# Run: pwsh -File scripts/applive-foreign-audit.test.ps1
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'applive-foreign-audit.ps1')

$profile  = 'D:/Data/projects/Multi-Publish/shared-user-data'
$worktree = 'D:/Data/projects/mp-worktrees/mp-app-live2'

function FakeProc {
  param($Id, $Exe, $Cmd)
  [pscustomobject]@{ ProcessId = $Id; ExecutablePath = $Exe; CommandLine = $Cmd }
}

$exeSame = 'D:\Data\projects\mp-worktrees\mp-app-live2\node_modules\electron\dist\electron.exe'
$exeOut  = 'D:\Data\projects\mp-worktrees\mp-other\node_modules\electron\dist\electron.exe'
$procs = @(
  # 101: same worktree, backslash profile path in cmdline -> hit
  (FakeProc 101 $exeSame '--user-data-dir=D:\Data\projects\Multi-Publish\shared-user-data --disk-cache-dir=x'),
  # 102: same worktree, forward-slash profile path -> hit (variant match)
  (FakeProc 102 $exeSame '--user-data-dir=D:/Data/projects/Multi-Publish/shared-user-data --x'),
  # 103: foreign worktree renderer (has --type=) with quoted path -> hit but not main
  (FakeProc 103 $exeOut '--user-data-dir="D:\Data\projects\Multi-Publish\shared-user-data" --type=renderer'),
  # 104: foreign main -> hit, main
  (FakeProc 104 $exeOut '--user-data-dir=D:\Data\projects\Multi-Publish\shared-user-data --x'),
  # 105: suffix lookalike -> must NOT match
  (FakeProc 105 $exeOut '--user-data-dir=D:\Data\projects\Multi-Publish\shared-user-data-2 --x'),
  # 106: truncated prefix -> must NOT match
  (FakeProc 106 $exeOut '--user-data-dir=D:\Data\projects\Multi-Publish\shared-user-da --x'),
  # 107: unrelated electron without the profile flag -> must NOT match
  (FakeProc 107 $exeOut '--other-flag=1 --x')
)

# ---- 1) owner matching: slash variants + quotes + boundary negatives ----
$owners = @(Get-ElectronProfileOwners -ProfilePath $profile -Processes $procs)
$ids = @($owners | ForEach-Object { $_.Pid })
foreach ($want in @(101, 102, 103, 104)) {
  if ($ids -notcontains $want) { throw "FAIL: owner pid=$want missing (got $($ids -join ','))" }
}
foreach ($no in @(105, 106, 107)) {
  if ($ids -contains $no) { throw "FAIL: pid=$no false-positive match" }
}
if ($ids.Count -ne 4) { throw "FAIL: owners count=$($ids.Count) expect 4" }
$r103 = @($owners | Where-Object { $_.Pid -eq 103 })
if ($r103[0].IsMain) { throw 'FAIL: pid=103 carries --type= and must not be IsMain' }
Write-Host 'PASS owners-match'

# ---- 2) same/foreign split by worktree ownership ----
$split = Split-ForeignProfileOwners -Owners $owners -WorktreePath $worktree
if ($split.Same.Count -ne 2)        { throw "FAIL: Same=$($split.Same.Count) expect 2" }
if ($split.Foreign.Count -ne 2)     { throw "FAIL: Foreign=$($split.Foreign.Count) expect 2" }
if ($split.ForeignMain.Count -ne 1) { throw "FAIL: ForeignMain=$($split.ForeignMain.Count) expect 1" }
if ($split.ForeignMain[0].Pid -ne 104) { throw 'FAIL: ForeignMain should be pid=104' }
Write-Host 'PASS split'

# ---- 3) lock-holder diagnostics: electron mains only, renderers excluded ----
$cands = @(Get-ElectronLockHolderCandidates -Processes $procs)
# mains among fakes: 101,102,104,105,106,107 (103 is a renderer)
if ($cands.Count -ne 6) { throw "FAIL: candidates=$($cands.Count) expect 6" }
$joined = $cands -join "`n"
if ($joined -notmatch 'pid=104') { throw 'FAIL: candidate line for pid=104 missing' }
if ($joined -match 'pid=103')    { throw 'FAIL: renderer pid=103 must not appear' }
Write-Host 'PASS lock-holder-candidates'

# ---- 4) live smoke: default scan path returns well-formed objects (never throws) ----
$liveOwners = @(Get-ElectronProfileOwners -ProfilePath $profile)
$liveCands  = @(Get-ElectronLockHolderCandidates)
Write-Host ("SMOKE live owners={0} lockHolderCandidates={1}" -f $liveOwners.Count, $liveCands.Count)
Write-Host 'FOREIGN_AUDIT_TEST_OK'
