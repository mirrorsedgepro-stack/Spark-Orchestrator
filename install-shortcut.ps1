# Adds Nexus to the Start menu and desktop (pin it to the taskbar from either).
$root = $PSScriptRoot
$exe = Join-Path $root 'node_modules\electron\dist\electron.exe'
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'Nexus.lnk'))
  $lnk.TargetPath = $exe
  $lnk.Arguments = "`"$root`""
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = (Join-Path $root 'assets\icon.ico')
  $lnk.Description = 'Nexus - one terminal for Claude, Antigravity and shells across your LAN'
  $lnk.Save()
  Write-Host "Created $($lnk.FullName)"
}
