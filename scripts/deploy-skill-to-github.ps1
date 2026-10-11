# 部署更新后的 SKILL.md 到 GitHub 仓库
# 一键执行：powershell -File scripts/deploy-skill-to-github.ps1

$source = "d:\Data\projects\mulpub\SKILL.md"
$targetDir = "D:\Data\projects\github-project-analysis-skill"
$target = "$targetDir\SKILL.md"
$originDir = "C:\Users\邱领\profiles\coo\skills\software-development\competitor-tech-analysis"

$commitMsg = "feat: upgrade to v2.0.0 - merge Colinchiu007 skill + Pixelle-Video practical experience"

Write-Host "=== 1. 复制 SKILL.md 到 GitHub 仓库 ===" -ForegroundColor Cyan
Copy-Item $source $target -Force
if ($?) {
    Write-Host "  [OK] 复制成功" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] 复制失败" -ForegroundColor Red
    exit 1
}

Write-Host "=== 2. Git 提交 ===" -ForegroundColor Cyan
Push-Location $targetDir
git add SKILL.md
git commit -m $commitMsg
if ($?) {
    Write-Host "  [OK] Commit 成功" -ForegroundColor Green
} else {
    Write-Host "  [WARN] 可能没有变更需要提交" -ForegroundColor Yellow
}

Write-Host "=== 3. 推送到 GitHub ===" -ForegroundColor Cyan
git push origin master
if ($?) {
    Write-Host "  [OK] 推送成功" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] 推送失败，请检查网络或认证" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

Write-Host "=== 4. 同步到 profiles skill 目录 ===" -ForegroundColor Cyan
if (Test-Path $originDir) {
    Copy-Item $source "$originDir\SKILL.md" -Force
    Write-Host "  [OK] 已同步到 profiles skill 目录" -ForegroundColor Green
} else {
    Write-Host "  [WARN] profiles skill 目录不存在，跳过" -ForegroundColor Yellow
}

Write-Host "=== 全部完成 ===" -ForegroundColor Green