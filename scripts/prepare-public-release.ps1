[CmdletBinding(SupportsShouldProcess)]
param(
  [switch]$KeepBuild,
  [switch]$KeepTestFixtures,
  [switch]$ScanWithGitleaks
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectRootWithSeparator = $projectRoot + [System.IO.Path]::DirectorySeparatorChar
$gitleaks = $null

if ($ScanWithGitleaks -and -not $WhatIfPreference) {
  $gitleaks = Get-Command gitleaks -ErrorAction SilentlyContinue
  if (-not $gitleaks) {
    throw 'Gitleaks is not installed. Install it, then rerun with -ScanWithGitleaks.'
  }
}

$generatedPaths = @(
  '.cache',
  'logs',
  'inputs',
  'output',
  'runtime',
  'models',
  'node_modules',
  'config.json',
  'jobs.json',
  'tools\yt-dlp',
  '.env'
)

if (-not $KeepBuild) {
  $generatedPaths += 'dist'
}

if (-not $KeepTestFixtures) {
  $generatedPaths += Get-ChildItem -LiteralPath $projectRoot -Directory -Filter 'audio-test-*' -ErrorAction SilentlyContinue |
    ForEach-Object { $_.Name }
}

foreach ($relativePath in $generatedPaths | Select-Object -Unique) {
  $targetPath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $relativePath))
  if (-not $targetPath.StartsWith($projectRootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a path outside the project: $targetPath"
  }

  if (Test-Path -LiteralPath $targetPath) {
    if ($PSCmdlet.ShouldProcess($targetPath, 'Remove generated local state')) {
      Remove-Item -LiteralPath $targetPath -Recurse -Force
    }
  }
}

if ($WhatIfPreference) {
  Write-Host 'Release cleanup preview complete. No files were removed.'
  return
}

if ($ScanWithGitleaks) {
  & $gitleaks.Source dir $projectRoot --redact
  if ($LASTEXITCODE -ne 0) { throw "Gitleaks worktree scan failed with exit code $LASTEXITCODE." }
  & $gitleaks.Source git $projectRoot --redact
  if ($LASTEXITCODE -ne 0) { throw "Gitleaks history scan failed with exit code $LASTEXITCODE." }
}

Write-Host 'Release cleanup complete.'
