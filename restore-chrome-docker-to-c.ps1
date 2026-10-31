$ErrorActionPreference = 'Stop'
$log='D:\Tai lieu\ki6\TLCN\cleanup-c-drive.log'
function Log($s) { $line="$(Get-Date -Format s) $s"; Add-Content -LiteralPath $log -Value $line; Write-Output $line }
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(chrome|Docker Desktop|com\.docker\..*)$' } | Stop-Process -Force
wsl.exe --terminate docker-desktop
Start-Sleep -Seconds 3
function Restore-ToC($original,$data) {
  $link=Get-Item -LiteralPath $original -Force
  if ($link.FullName -ne $original -or $link.LinkType -ne 'Junction' -or $link.Target -ne $data) { throw "Unexpected junction: $original" }
  if (!$data.StartsWith('D:\C-Drive-Data\',[StringComparison]::OrdinalIgnoreCase)) {throw 'Invalid source'}
  $source=Get-Item -LiteralPath $data -Force
  if($source.FullName -ne $data -or ($source.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Invalid source directory'}
  $stage=$original+'.restore-to-C'
  $savedLink=$original+'.old-junction'
  if ((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $savedLink)) {throw 'Restore staging path already exists'}
  Log "RESTORING $data -> $original"
  New-Item -ItemType Directory -Path $stage | Out-Null
  & robocopy.exe $data $stage /E /COPY:DAT /DCOPY:DAT /XJ /MT:16 /R:1 /W:1 /NP /NFL /NDL /NJH /NJS | Out-Null
  if($LASTEXITCODE -ge 8){throw "Restore copy failed $LASTEXITCODE"}
  & robocopy.exe $data $stage /E /COPY:DAT /DCOPY:DAT /XJ /L /R:0 /W:0 /NP /NFL /NDL /NJH /NJS | Out-Null
  if($LASTEXITCODE -ne 0){throw "Restore verification failed $LASTEXITCODE"}
  if($original -like '*Docker*') {
    $expected=(Get-FileHash -LiteralPath ($data+'\docker_data.vhdx') -Algorithm SHA256).Hash
    $actual=(Get-FileHash -LiteralPath ($stage+'\docker_data.vhdx') -Algorithm SHA256).Hash
    if($expected -ne $actual){throw 'Docker disk hash differs'}
    Log 'Docker SHA256 verified'
  }
  Rename-Item -LiteralPath $original -NewName ([IO.Path]::GetFileName($savedLink))
  try {Rename-Item -LiteralPath $stage -NewName ([IO.Path]::GetFileName($original))} catch {Rename-Item -LiteralPath $savedLink -NewName ([IO.Path]::GetFileName($original));throw}
  $restored=Get-Item -LiteralPath $original -Force
  if($restored.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Restored folder is still a link'}
  $old=Get-Item -LiteralPath $savedLink -Force
  if($old.LinkType -ne 'Junction' -or $old.Target -ne $data){throw 'Unexpected saved junction'}
  [IO.Directory]::Delete($savedLink)
  Log "RESTORED AND VERIFIED $original"
  if((Get-Item -LiteralPath $data -Force).FullName -ne $data){throw 'Delete source mismatch'}
  Remove-Item -LiteralPath $data -Recurse -Force
  Log "REMOVED D DUPLICATE $data"
}
Restore-ToC 'C:\Users\LENOVO\AppData\Local\Docker\wsl\disk' 'D:\C-Drive-Data\Docker\disk'
Restore-ToC 'C:\Users\LENOVO\AppData\Local\Google\Chrome' 'D:\C-Drive-Data\AppData\Chrome'
Log 'CHROME AND DOCKER RESTORE COMPLETE'
