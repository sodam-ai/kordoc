param(
  [Parameter(Mandatory=$true)][string]$Src,
  [Parameter(Mandatory=$true)][string]$Out
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

$tmpDir = Join-Path $env:TEMP ('hwp-com-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $tmpDir -Force)
$tmpFile = Join-Path $tmpDir (Split-Path $Src -Leaf)
Copy-Item -LiteralPath $Src -Destination $tmpFile -Force
$tmpOut = Join-Path $tmpDir 'out.pdf'

try {
  $hwp = New-Object -ComObject HWPFrame.HwpObject
  $hwp.RegisterModule('FilePathCheckerModule', 'FilePathCheckerModuleExample') | Out-Null
  $hwp.Open($tmpFile, '', '') | Out-Null
  $pc = $hwp.PageCount
  $hwp.SaveAs($tmpOut, 'PDF', '') | Out-Null
  $hwp.Clear(1) | Out-Null
  try { $hwp.Quit() | Out-Null } catch { }
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($hwp) | Out-Null
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  Copy-Item -LiteralPath $tmpOut -Destination $Out -Force
  Write-Output ("OK pages=" + $pc)
} catch {
  Write-Output ("ERR " + $_.Exception.Message)
} finally {
  try { Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue } catch { }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
