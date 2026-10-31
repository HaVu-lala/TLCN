$ErrorActionPreference = 'Stop'
$log = 'D:\Tai lieu\ki6\TLCN\cleanup-c-drive.log'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile('D:\Tai lieu\ki6\TLCN\cleanup-c-drive.ps1', [ref]$tokens, [ref]$parseErrors)
foreach ($name in @('Log','Delete-Exact','Relocate')) {
  $definition = $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]}, $false) | Where-Object Name -eq $name
  . ([scriptblock]::Create($definition.Extent.Text))
}
if (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(Docker Desktop|com\.docker\..*)$' }) { throw 'Docker is running; leaving data unchanged' }
$running = (wsl.exe --list --running --quiet | Out-String) -replace "`0",''
if ($running -match 'docker-desktop') { throw 'Docker WSL is running; leaving data unchanged' }
$disk = 'C:\Users\LENOVO\AppData\Local\Docker\wsl\disk\docker_data.vhdx'
$handle = [IO.File]::Open($disk, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
$handle.Dispose()
Relocate 'C:\Users\LENOVO\AppData\Local\Docker\wsl\disk' 'D:\C-Drive-Data\Docker\disk'
Log 'DOCKER DATA MOVED; startup validation pending'
