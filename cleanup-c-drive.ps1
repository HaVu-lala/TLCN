$ErrorActionPreference = 'Stop'
$log = 'D:\Tai lieu\ki6\TLCN\cleanup-c-drive.log'
function Log($message) { $line = "$(Get-Date -Format s) $message"; Add-Content -LiteralPath $log -Value $line; Write-Output $line }
function Delete-Exact($path) {
  if (!(Test-Path -LiteralPath $path)) { return }
  $item = Get-Item -LiteralPath $path -Force
  if ($item.FullName -ne $path -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Unsafe delete: $path" }
  Remove-Item -LiteralPath $path -Recurse -Force
  Log "DELETED $path"
}
Log 'START'
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(gns3|gns3server|Roblox.*|CapCut.*|TLauncher.*)$' } | Stop-Process -Force
try { Get-AppxPackage | Where-Object { $_.Name -match 'Roblox|CapCut' } | ForEach-Object { Remove-AppxPackage -Package $_.PackageFullName; Log "UNINSTALLED $($_.Name)" } } catch { Log "APPX WARNING $($_.Exception.Message)" }
if (Test-Path -LiteralPath 'C:\Program Files\GNS3\Uninstall.exe') {
  $proc = Start-Process -FilePath 'C:\Program Files\GNS3\Uninstall.exe' -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
  Log "GNS3 uninstaller exit $($proc.ExitCode)"
}
$deletePaths = @(
'C:\Users\LENOVO\Documents\Virtual Machines\GNS3 VM',
'C:\Users\LENOVO\AppData\Roaming\GNS3',
'C:\Users\LENOVO\AppData\Local\Roblox',
'C:\Users\LENOVO\AppData\Local\RobloxPCGDK',
'C:\Users\LENOVO\AppData\Roaming\.tlauncher',
'C:\Users\LENOVO\AppData\Local\CapCut'
)
foreach ($path in $deletePaths) { try { Delete-Exact $path } catch { Log "DELETE FAILED $path : $($_.Exception.Message)" } }
function Relocate($source, $destination) {
  if (!(Test-Path -LiteralPath $source)) { Log "MISSING $source"; return }
  $sourceItem = Get-Item -LiteralPath $source -Force
  if ($sourceItem.FullName -ne $source -or ($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Log "SKIPPED LINK $source"; return }
  if (Test-Path -LiteralPath $destination) { throw "Destination exists: $destination" }
  if (!$destination.StartsWith('D:\C-Drive-Data\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid destination' }
  $backup = $source + '.migration-backup'
  if (Test-Path -LiteralPath $backup) { throw "Backup exists: $backup" }
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  Log "COPYING $source -> $destination"
  & robocopy.exe $source $destination /E /COPY:DAT /DCOPY:DAT /XJ /R:1 /W:1 /NP /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copy failed: $source ($LASTEXITCODE)" }
  & robocopy.exe $source $destination /E /COPY:DAT /DCOPY:DAT /XJ /R:0 /W:0 /L /NP /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Verification differs: $source ($LASTEXITCODE)" }
  Rename-Item -LiteralPath $source -NewName ([IO.Path]::GetFileName($backup))
  try { New-Item -ItemType Junction -Path $source -Target $destination | Out-Null } catch { Rename-Item -LiteralPath $backup -NewName ([IO.Path]::GetFileName($source)); throw }
  $link = Get-Item -LiteralPath $source -Force
  if ($link.LinkType -ne 'Junction' -or $link.Target -ne $destination) { throw "Junction verification failed: $source" }
  Delete-Exact $backup
  Log "MOVED AND VERIFIED $source -> $destination"
}
Relocate 'C:\Users\LENOVO\Level Up Games\NghichThuyHan' 'D:\C-Drive-Data\Games\NghichThuyHan'
if (!(Get-Process vmware-vmx -ErrorAction SilentlyContinue)) {
  Relocate 'C:\Users\LENOVO\Documents\Virtual Machines\Ubuntu 64-bit' 'D:\C-Drive-Data\Virtual Machines\Ubuntu 64-bit'
} else { Log 'SKIPPED Ubuntu: VM running' }
Relocate 'C:\Users\LENOVO\AppData\Roaming\.minecraft' 'D:\C-Drive-Data\Minecraft-preserved'
Log ('FREE SPACE ' + ((Get-PSDrive C,D | Select-Object Name,@{N='FreeGB';E={[math]::Round($_.Free/1GB,2)}} | ConvertTo-Json -Compress)))
Log 'DONE'
