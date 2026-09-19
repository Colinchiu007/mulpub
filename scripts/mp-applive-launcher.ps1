# mp-applive-launcher.ps1 - Detached launcher for Multi-Publish desktop.
# Launches the app via WMI Win32_Process.Create so it survives the parent
# PowerShell session / agent job exit. Pure ASCII. No Chinese. No BOM.
[CmdletBinding()]
param(
  [string]$Worktree = 'D:/Data/projects/mp-worktrees/mp-app-live2',
  [string]$Profile  = 'D:/Data/projects/Multi-Publish/shared-user-data'
)
$ErrorActionPreference = 'Stop'
function Write-Info($m){ Write-Host $m }

# node self-locate
$nodeExe = $null
$c = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
if ($c) { $nodeExe = $c.Source }
if (-not $nodeExe) {
  $cand = Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions\22.22.2\node.exe'
  if (Test-Path -LiteralPath $cand) { $nodeExe = $cand }
}
if (-not $nodeExe) { Write-Info 'ERROR: node not found'; exit 1 }
$nodeDir = Split-Path $nodeExe -Parent
Write-Info ("node = " + $nodeExe)

# python self-locate (system 3.12)
$pyExe = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
if (Test-Path -LiteralPath $pyExe) {
  Write-Info ("python = " + $pyExe)
} else {
  Write-Info 'python 3.12 not found at LOCALAPPDATA; relying on PATH python'
  $pyExe = 'python'
}

# repo root via git common-dir (parent of shared .git)
$repoRoot = 'D:/Data/projects/Multi-Publish'
try {
  $common = (git -C $Worktree rev-parse --git-common-dir 2>$null)
  if ($common) { $repoRoot = Split-Path (Resolve-Path $common).Path }
} catch {}

# derive ports by worktree path
$portScript = Join-Path $repoRoot 'apps/desktop/scripts/dev-ports.js'
$portErr = $null
$portsJson = & $nodeExe -e 'const { resolveDevPorts } = require(process.argv[1]); process.stdout.write(JSON.stringify(resolveDevPorts(process.argv[2])))' $portScript $Worktree 2>$portErr
$ports = $portsJson | ConvertFrom-Json
$vitePort = [int]$ports.vite
$cdpPort = [int]$ports.cdp
Write-Info ("ports vite=" + $vitePort + " cdp=" + $cdpPort)

# stop existing electron from this worktree (single-instance)
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($Worktree + '*') } | ForEach-Object { Stop-Process -Id $_.Id -Force; Write-Info ("stop old electron pid=" + $_.Id) }
Start-Sleep -Seconds 2

# build detached launch command line (env-set via cmd /c)
$desktopDir = Join-Path $Worktree 'apps/desktop'
$inner = "set PATH=$nodeDir;%PATH% & set MP_VITE_PORT=$vitePort & set MP_CDP_PORT=$cdpPort & set ELECTRON_USER_DATA_DIR=$Profile & set MP_PYTHON=$pyExe & set MP_CDP_ALLOW_ALL_ORIGINS=1 & cd /d $desktopDir & node scripts/dev.js"
$cmdLine = "cmd.exe /c $inner"
Write-Info ("launch cmd: " + $cmdLine)

# WMI/Win32_Process.Create breaks the agent job association -> true detach.
# Use Invoke-CimMethod (avoids the deserialized-object quirk of Get-WmiObject).
# Fallback to Start-Process when WMI is unavailable (e.g. normal interactive terminal).
$launched = $false
try {
  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdLine }
  if ($result.ReturnValue -eq 0) {
    Write-Info ("CHILD_PID=" + $result.ProcessId)
    $launched = $true
  } else {
    Write-Info ("WARN: WMI launch rc=" + $result.ReturnValue + "; falling back to Start-Process")
  }
} catch {
  Write-Info ("WARN: WMI unavailable (" + $_.Exception.Message + "); falling back to Start-Process")
}
if (-not $launched) {
  Start-Process cmd.exe -ArgumentList ('/c ' + $cmdLine) -WindowStyle Normal
  Write-Info 'CHILD launched via Start-Process'
}

# poll for visible electron window
$deadline = (Get-Date).AddSeconds(150)
$win = $null
while ((Get-Date) -lt $deadline) {
  $win = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($Worktree + '*') -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($win) { break }
  Start-Sleep -Seconds 3
}
if ($win) {
  Write-Info ("WINDOW pid=" + $win.Id + " handle=" + $win.MainWindowHandle + " title=" + $win.MainWindowTitle)
  Write-Info 'START_CONTRACT_OK'
} else {
  Write-Info 'WARN: no visible window within 150s; app may still be starting'
}
