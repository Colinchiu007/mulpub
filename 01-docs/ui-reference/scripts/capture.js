// @ts-nocheck
// 
// capture.js - Screenshot参考产品 window using Node.js + PowerShell interop
// Usage: node capture.js [--all] [--nav N] [--name FILENAME]

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = 'D:\\Data\\projects\\Multi-Publish\\01-docs\\ui-reference\\screenshots\\full-app';

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// PowerShell script as a template string (no file encoding issues)
function buildPSScript(options = {}) {
  const { navIndex, fileName, captureAll } = options;
  
  return `
Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Drawing;

public class WinCap {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWinProc cb, IntPtr lp);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    public delegate bool EnumWinProc(IntPtr h, IntPtr lp);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int L, T, R, B; }
    public static void Shot(IntPtr h, string p) {
        RECT r;
        GetClientRect(h, out r);
        int w = r.R, ht = r.B;
        if (w <= 0 || ht <= 0) return;
        Bitmap bmp = new Bitmap(w, ht, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp)) {
            IntPtr hdc = g.GetHdc();
            PrintWindow(h, hdc, 2);
            g.ReleaseHdc(hdc);
        }
        bmp.Save(p, System.Drawing.Imaging.ImageFormat.Png);
        bmp.Dispose();
    }
    public static void Click(IntPtr h, int x, int y) {
        SetForegroundWindow(h);
        System.Threading.Thread.Sleep(100);
        IntPtr lp = (IntPtr)((y << 16) | (x & 0xFFFF));
        SendMessage(h, 0x0201, IntPtr.Zero, lp);
        System.Threading.Thread.Sleep(50);
        SendMessage(h, 0x0202, IntPtr.Zero, lp);
    }
}
"@

# Find window
$hw = [IntPtr]::Zero
[WinCap]::EnumWindows({
    param($h, $lp)
    if ([WinCap]::IsWindowVisible($h)) {
        $l = [WinCap]::GetWindowTextLength($h)
        if ($l -gt 0) {
            $sb = New-Object System.Text.StringBuilder($l + 1)
            [WinCap]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
            $t = $sb.ToString()
            if ($t -match '4\\.0') {
                $script:hw = $h
                Write-Host "[FOUND] $t"
                return $false
            }
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

if ($hw -eq [IntPtr]::Zero) {
    $p = Get-Process -EA SilentlyContinue | Where-Object { $_.ProcessName -match 'mp' }
    if ($p) {
        $hw = $p.MainWindowHandle
        Write-Host "[FOUND-PROC] $($p.MainWindowTitle)"
    }
}

if ($hw -eq [IntPtr]::Zero) {
    Write-Host "[ERROR] Window not found"
    exit 1
}

$rect = New-Object WinCap+RECT
[WinCap]::GetClientRect($hw, [ref]$rect) | Out-Null
Write-Host "[INFO] Size: $($rect.R) x $($rect.B)"

${captureAll ? `
# Capture all nav pages
$menus = @(
    @{i=0;n='home';l='Home'},
    @{i=1;n='publish';l='Publish'},
    @{i=2;n='accounts';l='Accounts'},
    @{i=3;n='data';l='Data'},
    @{i=4;n='tools';l='Tools'},
    @{i=5;n='comments';l='Comments'},
    @{i=6;n='creation';l='Creation'},
    @{i=7;n='ai';l='AI'},
    @{i=8;n='team';l='Team'},
    @{i=9;n='material';l='Material'},
    @{i=10;n='settings';l='Settings'}
)

foreach ($m in $menus) {
    $idx = $m.i
    Write-Host "[$($idx+1)/11] $($m.l) ..." -NoNewline
    $cy = 80 + ($idx * 55)
    [WinCap]::Click($hw, 35, $cy)
    Start-Sleep -Milliseconds 800
    $fp = Join-Path '${OUTPUT_DIR.replace(/\\/g, '\\\\')}' ("{0:D2}-{1}.png" -f ($idx+1), $m.n)
    [WinCap]::Shot($hw, $fp)
    Write-Host " OK"
}
` : navIndex !== undefined ? `
# Capture specific nav page
$navIdx = ${navIndex}
$names = @('home','publish','accounts','data','tools','comments','creation','ai','team','material','settings')
$labels = @('Home','Publish','Accounts','Data','Tools','Comments','Creation','AI','Team','Material','Settings')
$idx = $navIdx
Write-Host "[$($idx+1)/11] $($labels[$idx]) ..." -NoNewline
$cy = 80 + ($idx * 55)
[WinCap]::Click($hw, 35, $cy)
Start-Sleep -Milliseconds 800
$fp = Join-Path '${OUTPUT_DIR.replace(/\\/g, '\\\\')}' ("{0:D2}-{1}.png" -f ($idx+1), $names[$idx])
[WinCap]::Shot($hw, $fp)
Write-Host " OK"
` : `
# Capture current state
$fp = Join-Path '${OUTPUT_DIR.replace(/\\/g, '\\\\')}' '${fileName || '00-current-state.png'}'
[WinCap]::Shot($hw, $fp)
Write-Host "[OK] Saved: $fp"
`}
Write-Host "[DONE]"
`;
}

// Main
const args = process.argv.slice(2);
const captureAll = args.includes('--all');
const navIdx = args.find((a, i) => args[i-1] === '--nav');
const fileName = args.find((a, i) => args[i-1] === '--name');

const psScript = buildPSScript({
  captureAll,
  navIndex: navIdx !== undefined ? parseInt(navIdx) : undefined,
  fileName
});

// Write temp script file with BOM
const tmpScript = path.join(__dirname, '_tmp_capture.ps1');
const BOM = '\uFEFF';
fs.writeFileSync(tmpScript, BOM + psScript, 'utf16le');

console.log('[RUN] Executing PowerShell screenshot script...');
try {
  const output = execSync(
    `powershell -ExecutionPolicy Bypass -NoProfile -File "${tmpScript}"`,
    { encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  console.log(output);
} catch (err) {
  console.error('[ERROR]', err.message);
  if (err.stdout) console.log(err.stdout);
  if (err.stderr) console.error(err.stderr);
} finally {
  // Cleanup temp file
  try { fs.unlinkSync(tmpScript); } catch(e) {}
}
