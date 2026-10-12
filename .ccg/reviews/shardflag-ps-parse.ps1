param([string]$Target, [string]$Label)
# Parse a script body with PowerShell's own parser and report: number of syntax errors,
# plus facts about the Start-Process command's own extent.
# Why the extent matters: the "comment inserted right after a backtick line-continuation" form
# reports PARSE_ERRORS=0 but silently re-groups the statement (extent collapses 334 -> 34 chars,
# -ArgumentList falls out of the command). So "no syntax error" is NOT evidence.
# ASCII-only by design: PS 5.1 reads BOM-less UTF-8 .ps1 as ANSI and fails at parse time.
$ErrorActionPreference = 'Stop'
$text = [IO.File]::ReadAllText($Target, [Text.Encoding]::UTF8)
$tokens = $null
$errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errs)
Write-Output ("LABEL|" + $Label)
Write-Output ("PARSE_ERRORS=" + @($errs).Count)
foreach ($e in @($errs)) {
  $sp = $e.Extent.StartScriptPosition
  Write-Output ("ERR_AT_LINE=" + $sp.lineNumber + " COL=" + $sp.columnNumber)
}
$found = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)
foreach ($c in @($found)) {
  $ext = $c.Extent.Text
  if ($ext -like '*Start-Process -FilePath*') {
    Write-Output ("SP_HAS_ARGUMENTLIST=" + ($ext -match '-ArgumentList'))
    Write-Output ("SP_HAS_SHARD=" + ($ext -match 'shard'))
    Write-Output ("SP_HAS_BARE_DASHDASH_ELEMENT=" + ($ext -match '(?s)"test",\s*"--",'))
    Write-Output ("SP_EXTENT_LEN=" + $ext.Length)
  }
}
Write-Output ("PSVERSION=" + $PSVersionTable.PSVersion.ToString())
