# 参考产品应用系统截图脚本
# HWND=19663524, PID=19492, 屏幕 1920x1080

$scriptPath = "D:\Data\projects\Multi-Publish\_screenshot_helper.ps1"
$outputDir = "D:\Data\projects\Multi-Publish\screenshots\mp\v4\r2"

# 辅助函数：点击并截图
function ClickAndScreenshot {
    param(
        [int]$X,
        [int]$Y,
        [string]$Name,
        [int]$WaitMs = 2000,
        [int]$Hwnd = 19663524
    )
    $outputPath = Join-Path $outputDir $Name
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Clicking ($X, $Y) -> $Name"
    powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -X $X -Y $Y -OutputPath $outputPath -WaitMs $WaitMs -Hwnd $Hwnd
    Write-Host "  Screenshot saved: $Name"
}

# 辅助函数：仅截图（不点击）
function ScreenshotOnly {
    param(
        [string]$Name,
        [int]$WaitMs = 1000,
        [int]$Hwnd = 19663524
    )
    $outputPath = Join-Path $outputDir $Name
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Screenshot only -> $Name"
    powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -X 0 -Y 0 -OutputPath $outputPath -WaitMs $WaitMs -Hwnd $Hwnd -NoClick
    Write-Host "  Screenshot saved: $Name"
}

Write-Host "=== 参考产品应用系统截图 ==="
Write-Host "时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ""

# ========== 1. 首页 ==========
Write-Host "--- 1. 首页 ---"
ScreenshotOnly -Name "r2_01_home_initial.png" -WaitMs 1000

# 点击"添加账号"按钮（右上角蓝色按钮）
ClickAndScreenshot -X 1380 -Y 170 -Name "r2_02_add_account_page.png" -WaitMs 3000

Write-Host "截图完成，等待进一步指令..."
