$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$guard = Join-Path $root 'scripts/guard-shared-root-writes.ps1'
if (-not (Test-Path -LiteralPath $guard)) { throw 'guard script missing: ' + $guard }

$tmpRoot = Join-Path ([IO.Path]::GetTempPath()) ('mp-write-guard-' + [guid]::NewGuid().ToString('N'))
$quarantine = Join-Path $tmpRoot 'quarantine'
$repo = Join-Path $tmpRoot 'repo'
New-Item -ItemType Directory -Force -Path $repo | Out-Null
New-Item -ItemType Directory -Force -Path $quarantine | Out-Null
$passed = 0
function Assert([bool]$condition, [string]$message) { if (-not $condition) { throw "FAIL: $message" }; $script:passed++; Write-Host "PASS: $message" }
try {
    Push-Location $repo
    & git init -q
    & git config user.name 'Write Guard Test'
    & git config user.email 'guard@test.local'
    New-Item -ItemType Directory -Force -Path 'apps' | Out-Null
    New-Item -ItemType Directory -Force -Path 'docs' | Out-Null
    New-Item -ItemType Directory -Force -Path 'node_modules/pkg' | Out-Null
    Set-Content -LiteralPath 'apps/tracked.js' -Value "export const tracked = 'v1'`n" -Encoding UTF8
    Set-Content -LiteralPath 'docs/readme.md' -Value '# docs' -Encoding UTF8
    Set-Content -LiteralPath 'node_modules/pkg/index.js' -Value 'module.exports = 1' -Encoding UTF8
    # 夹具必须与真实仓库同形：真实 .gitignore 含 .agent_context/（见仓库根 .gitignore），
    # 而守护在拦截时会往仓库根写 .agent_context/write-guard-alert.json 供后续会话感知。
    # 不在夹具里忽略它，下面的「restore 后 status 仍干净」会把这个设计内的告警文件误判为脏。
    Set-Content -LiteralPath '.gitignore' -Value "node_modules/`ndist/`n.agent_context/`n" -Encoding UTF8
    & git add -A
    & git commit -q -m 'fixture'
    Pop-Location
    Assert ($LASTEXITCODE -eq 0) 'temporary git repository is created'

    $common = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$guard,'-Root',$repo,'-QuarantineRoot',$quarantine)
    function GuardPath([string]$path) { & powershell.exe @common -ProcessPaths $path -Quiet; if ($LASTEXITCODE -ne 0) { throw "guard failed for $path" } }

    Set-Content -LiteralPath (Join-Path $repo 'apps/untracked.js') -Value 'console.log(1)' -Encoding UTF8
    GuardPath 'apps/untracked.js'
    Assert (-not (Test-Path -LiteralPath (Join-Path $repo 'apps/untracked.js'))) 'untracked runtime file is quarantined'
    Assert ((Get-ChildItem -LiteralPath $quarantine -Recurse -File | Where-Object { $_.Name -like '*untracked.js' }).Count -eq 1) 'quarantine contains untracked copy'
    Assert (Test-Path -LiteralPath (Join-Path $quarantine 'violations.jsonl')) 'violation log is written outside repo'

    Set-Content -LiteralPath (Join-Path $repo 'apps/tracked.js') -Value "export const tracked = 'v2'`n" -Encoding UTF8
    GuardPath 'apps/tracked.js'
    $restored = (git -C $repo show HEAD:apps/tracked.js) -join "`n"
    Assert ($restored -match "tracked = 'v1'") 'tracked file is restored from HEAD'
    Assert ((git -C $repo status --porcelain=v1 | Measure-Object).Count -eq 0) 'shared status stays clean after tracked restore'

    Set-Content -LiteralPath (Join-Path $repo 'docs/new.md') -Value '# allowed' -Encoding UTF8
    GuardPath 'docs/new.md'
    Assert (Test-Path -LiteralPath (Join-Path $repo 'docs/new.md')) 'docs directory write is allowed'
    Remove-Item -LiteralPath (Join-Path $repo 'docs/new.md') -Force

    Set-Content -LiteralPath (Join-Path $repo 'node_modules/pkg/new.js') -Value 'module.exports = 2' -Encoding UTF8
    GuardPath 'node_modules/pkg/new.js'
    Assert (Test-Path -LiteralPath (Join-Path $repo 'node_modules/pkg/new.js')) 'gitignored artifact is allowed'

    Remove-Item -LiteralPath (Join-Path $repo 'apps/tracked.js') -Force
    GuardPath 'apps/tracked.js'
    Assert (Test-Path -LiteralPath (Join-Path $repo 'apps/tracked.js')) 'deleted tracked file is restored'
    Assert ((git -C $repo status --porcelain=v1 | Measure-Object).Count -eq 0) 'status is clean after delete restore'

    New-Item -ItemType Directory -Force -Path (Join-Path $repo 'apps/nested') | Out-Null
    Set-Content -LiteralPath (Join-Path $repo 'apps/nested/inside.js') -Value 'export default 99' -Encoding UTF8
    & git -C $repo add apps/nested/inside.js
    & git -C $repo commit -q -m 'nested fixture'
    $violationBaseline = @(Get-Content -LiteralPath (Join-Path $quarantine 'violations.jsonl') | Where-Object { $_.Trim() }).Count
    GuardPath 'apps/nested'
    Assert (Test-Path -LiteralPath (Join-Path $repo 'apps/nested/inside.js')) 'directory event does not quarantine tracked subtree'
    Assert ((git -C $repo status --porcelain=v1 | Measure-Object).Count -eq 0) 'status stays clean after directory event'
    $violationAfter = @(Get-Content -LiteralPath (Join-Path $quarantine 'violations.jsonl') | Where-Object { $_.Trim() }).Count
    Assert ($violationAfter -eq $violationBaseline) 'directory event is not recorded as a violation'

    $violations = @(Get-Content -LiteralPath (Join-Path $quarantine 'violations.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
    Assert (($violations | Measure-Object).Count -ge 2) 'violation log records intercepted writes'
    Write-Host "PASS: $passed session write guard checks" -ForegroundColor Green
} finally {
    Pop-Location -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
}
