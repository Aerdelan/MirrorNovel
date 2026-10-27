param(
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [string]$PreviousDirectory = '',
  [Parameter(Mandatory = $true)][string]$ExecutableName,
  [ValidateSet('Check', 'Close')][string]$Mode = 'Check',
  [string]$LogFile = ''
)

$ErrorActionPreference = 'Stop'
function Write-InstallLog([string]$Message) {
  $line = ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message)
  Write-Output $line
  if ($LogFile) { try { Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8 } catch {} }
}

try {
  if ([IO.Path]::GetFileName($ExecutableName) -ne $ExecutableName -or [IO.Path]::GetExtension($ExecutableName) -ne '.exe') {
    throw 'Invalid executable name'
  }
  $targets = @($InstallDirectory, $PreviousDirectory) | Where-Object { $_ } | ForEach-Object {
    [IO.Path]::GetFullPath([IO.Path]::Combine($_, $ExecutableName))
  } | Select-Object -Unique
  $processName = [IO.Path]::GetFileNameWithoutExtension($ExecutableName)
  $sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
  function Get-TargetProcesses {
    @(Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object {
      $candidate = $_
      try { $image = $candidate.Path } catch { $image = $null }
      if (!$image -and !$candidate.HasExited) { throw 'Cannot inspect a running application process. Exit it, including elevated copies, before updating.' }
      if ($image -and @($targets | Where-Object { [string]::Equals($_, $image, [StringComparison]::OrdinalIgnoreCase) }).Count) {
        if ($candidate.SessionId -ne $sessionId) { throw 'The target application is running in another Windows session. Close it there before updating.' }
        $true
      } else { $false }
    })
  }
  $running = @(Get-TargetProcesses)
  if (!$running.Count) { Write-InstallLog 'No application process is holding the target installation.'; exit 0 }
  if ($Mode -eq 'Check') { Write-InstallLog ('Target application is running ({0} processes).' -f $running.Count); exit 2 }

  # New versions route this argument to the existing main process, including
  # tray-only instances. Old versions use CloseMainWindow and the bounded
  # path-verified fallback below instead of starting another old instance.
  foreach ($target in $targets) {
    if (!(Test-Path -LiteralPath $target)) { continue }
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($target)
    if ($version.FileMajorPart -gt 1 -or ($version.FileMajorPart -eq 1 -and ($version.FileMinorPart -gt 1 -or ($version.FileMinorPart -eq 1 -and $version.FileBuildPart -ge 2)))) {
      Start-Process -FilePath $target -ArgumentList '--quit-for-update' -WindowStyle Hidden | Out-Null
    }
  }
  foreach ($candidate in $running) { try { $null = $candidate.CloseMainWindow() } catch {} }
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  while ([DateTime]::UtcNow -lt $deadline -and @(Get-TargetProcesses).Count) { Start-Sleep -Milliseconds 200 }
  foreach ($candidate in @(Get-TargetProcesses)) {
    # Recheck identity immediately before stopping a PID; never kill by name
    # or a process tree that might include a copy from another directory.
    $fresh = Get-Process -Id $candidate.Id -ErrorAction SilentlyContinue
    if ($fresh -and $targets -contains $fresh.Path -and $fresh.SessionId -eq $sessionId) {
      Write-InstallLog ('Closing remaining target process PID {0}.' -f $fresh.Id)
      Stop-Process -Id $fresh.Id -Force -ErrorAction Stop
    }
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(3)
  while ([DateTime]::UtcNow -lt $deadline -and @(Get-TargetProcesses).Count) { Start-Sleep -Milliseconds 150 }
  if (@(Get-TargetProcesses).Count) { throw 'The application is still running. Exit it from its tray menu and retry.' }
  Write-InstallLog 'Target application closed; continuing installation.'
  exit 0
} catch {
  Write-InstallLog ('Process check failed: ' + $_.Exception.Message)
  exit 3
}
