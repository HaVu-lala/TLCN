$ErrorActionPreference = 'Stop'
$log = 'D:\Tai lieu\ki6\TLCN\cleanup-c-drive.log'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile('D:\Tai lieu\ki6\TLCN\cleanup-c-drive.ps1', [ref]$tokens, [ref]$parseErrors)
foreach ($name in @('Log','Delete-Exact','Relocate')) {
  $definition = $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]}, $false) | Where-Object Name -eq $name
  . ([scriptblock]::Create($definition.Extent.Text))
}
Log 'EXTRA START'
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
if (Get-Process chrome -ErrorAction SilentlyContinue) { throw 'Chrome still running' }
Relocate 'C:\Users\LENOVO\AppData\Local\Google\Chrome' 'D:\C-Drive-Data\AppData\Chrome'
if (!(Get-Process -Name Code -ErrorAction SilentlyContinue)) {
  Relocate 'C:\Users\LENOVO\.vscode' 'D:\C-Drive-Data\AppData\vscode-extensions'
  Relocate 'C:\Users\LENOVO\AppData\Roaming\Code' 'D:\C-Drive-Data\AppData\Code'
}
Relocate 'C:\Users\LENOVO\AppData\Local\pip\Cache' 'D:\C-Drive-Data\Caches\pip'
Relocate 'C:\Users\LENOVO\AppData\Local\npm-cache' 'D:\C-Drive-Data\Caches\npm'
Relocate 'C:\Users\LENOVO\AppData\Local\ms-playwright' 'D:\C-Drive-Data\AppData\ms-playwright'
$distros = (wsl.exe --list --running --quiet | Out-String) -replace "`0",''
if ($distros -match 'kali-linux') { Log 'SKIPPED Kali: currently running' }
else {
  $dest = 'D:\C-Drive-Data\WSL\kali-linux'
  New-Item -ItemType Directory -Path 'D:\C-Drive-Data\WSL' -Force | Out-Null
  if (!(Test-Path -LiteralPath $dest)) {
    Log 'MOVING Kali via wsl --manage'
    wsl.exe --manage kali-linux --move $dest
    if ($LASTEXITCODE -ne 0) { Log "KALI MOVE FAILED $LASTEXITCODE" } else { Log 'MOVED Kali via WSL' }
  }
}
Log 'EXTRA DONE'
