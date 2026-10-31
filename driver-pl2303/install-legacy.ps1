$ErrorActionPreference = 'Stop'
$logPath = 'D:\Tai lieu\ki6\TLCN\driver-pl2303\legacy-install.log'
Start-Transcript -Path $logPath -Force
try {
    pnputil /add-driver 'D:\Tai lieu\ki6\TLCN\driver-pl2303\legacy\pl2303-old-driver\ser2pl.inf'
    if ($LASTEXITCODE -ne 0) { throw 'Windows rejected the driver package.' }
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PL2303DriverUpdate {
    [DllImport("newdev.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool UpdateDriverForPlugAndPlayDevices(IntPtr hwndParent, string HardwareId, string FullInfPath, uint InstallFlags, out bool RebootRequired);
}
"@
    $rebootNeeded = $false
    $success = [PL2303DriverUpdate]::UpdateDriverForPlugAndPlayDevices([IntPtr]::Zero, 'USB\VID_067B&PID_2303', 'D:\Tai lieu\ki6\TLCN\driver-pl2303\legacy\pl2303-old-driver\ser2pl.inf', 1, [ref]$rebootNeeded)
    if (-not $success) { throw "Driver selection failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
    Write-Output "Driver update succeeded. Reboot required: $rebootNeeded"
    pnputil /enum-devices /class Ports /connected
} catch { Write-Output $_.Exception.Message } finally { Stop-Transcript }
