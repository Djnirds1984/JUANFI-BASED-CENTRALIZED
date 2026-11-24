# Builds the Pisonet desktop agent with nothing but what Windows already ships.
#
#   powershell -ExecutionPolicy Bypass -File .\cafe-client\build.ps1
#
# The output, cafe-client\dist\JuanFiCafe.exe, is what the panel hands out at
# GET /api/cafe/agent/download and what the Pisonet -> Setup page links to. There
# is no project file and no SDK to install: csc.exe comes with .NET Framework 4.x,
# which is part of every Windows 10/11 box, so a cafe PC can rebuild the agent
# itself if it ever has to.
param(
    [string]$OutDir = "$PSScriptRoot\dist",
    [string]$ExeName = "JuanFiCafe.exe"
)

$ErrorActionPreference = 'Stop'

$candidates = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)

$csc = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) {
    Write-Host 'No .NET Framework 4.x compiler found (csc.exe). Install the .NET Framework 4.8 developer pack.' -ForegroundColor Red
    exit 1
}

$sources = Get-ChildItem -Path "$PSScriptRoot\src" -Filter *.cs | ForEach-Object { $_.FullName }
if (-not $sources) {
    Write-Host "No sources under $PSScriptRoot\src" -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$out = Join-Path $OutDir $ExeName

$refs = @(
    '/r:System.dll',
    '/r:System.Core.dll',
    '/r:System.Drawing.dll',
    '/r:System.Windows.Forms.dll'
)

Write-Host "compiling $($sources.Count) files -> $out"
& $csc /nologo /target:winexe /platform:anycpu /optimize+ /warn:3 `
    /out:"$out" $refs $sources

if ($LASTEXITCODE -ne 0) {
    Write-Host 'build failed' -ForegroundColor Red
    exit $LASTEXITCODE
}

$item = Get-Item $out
Write-Host ("built {0}  {1:N0} bytes" -f $item.Name, $item.Length) -ForegroundColor Green
