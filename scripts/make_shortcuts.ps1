# EXDA shortcuts for Windows, called by Setup-EXDA-WIN.bat.
#
# Places (all for the current user only, no admin rights):
#  - Start menu: always.
#  - The EXDA parent folder, next to the app folder and EXDA-Projects, when the
#    app sits in its own folder (recommended layout EXDA\EXDA-dashboard).
#    Otherwise inside the app folder itself.
#  - Desktop: only if the user says yes (an existing EXDA shortcut there is
#    simply updated, so the question is asked once).
# Nothing else is changed. Every shortcut written is printed.
param(
    [Parameter(Mandatory = $true)][string]$AppDir
)

$ErrorActionPreference = 'Stop'
$AppDir = (Resolve-Path -LiteralPath $AppDir).Path.TrimEnd('\')
$Parent = Split-Path -Parent $AppDir
$Target = Join-Path $AppDir 'Run-EXDA-WIN.bat'
$Icon = Join-Path $AppDir 'scripts\EXDA.ico'
$Shell = New-Object -ComObject WScript.Shell

function Write-ExdaShortcut([string]$Folder) {
    $path = Join-Path $Folder 'EXDA.lnk'
    $lnk = $Shell.CreateShortcut($path)
    $lnk.TargetPath = $Target
    $lnk.WorkingDirectory = $AppDir
    $lnk.IconLocation = "$Icon,0"
    $lnk.Description = 'EXDA - EXperimental DAta'
    $lnk.Save()
    Write-Host "  $path"
}

# The app is "in its own folder" when the parent is not a general place
# (drive root, user folder, Desktop, Documents, Downloads) and either is named
# EXDA... or holds nothing but EXDA items (app folder, EXDA-Projects, EXDA.lnk).
function Test-OwnFolder {
    if (-not $Parent) { return $false }
    if ($Parent.TrimEnd('\') -eq ([IO.Path]::GetPathRoot($Parent)).TrimEnd('\')) { return $false }
    $profileDir = [Environment]::GetFolderPath('UserProfile')
    $general = @(
        $profileDir,
        [Environment]::GetFolderPath('Desktop'),
        [Environment]::GetFolderPath('MyDocuments'),
        (Join-Path $profileDir 'Desktop'),
        (Join-Path $profileDir 'Documents'),
        (Join-Path $profileDir 'Downloads')
    ) | ForEach-Object { $_.TrimEnd('\') }
    if ($general -contains $Parent.TrimEnd('\')) { return $false }
    if ((Split-Path -Leaf $Parent) -like 'EXDA*') { return $true }
    $others = @(Get-ChildItem -LiteralPath $Parent -Force | Where-Object {
        $_.Name -notlike '.*' -and $_.Name -notlike 'EXDA*' -and $_.Name -ne 'desktop.ini'
    })
    return ($others.Count -eq 0)
}

Write-Host 'EXDA shortcut:'
Write-ExdaShortcut ([Environment]::GetFolderPath('Programs'))

if (Test-OwnFolder) {
    Write-ExdaShortcut $Parent
    # Older versions put the folder shortcut inside the app folder.
    $old = Join-Path $AppDir 'EXDA.lnk'
    if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force }
} else {
    Write-ExdaShortcut $AppDir
    Write-Host ''
    Write-Host 'Tip: put this app folder inside its own EXDA folder, for example'
    Write-Host '     C:\EXDA\EXDA-dashboard. EXDA then keeps the app, EXDA-Projects and'
    Write-Host '     the EXDA shortcut together in that one folder.'
}

$desktop = [Environment]::GetFolderPath('Desktop')
if ($desktop -and (Test-Path -LiteralPath (Join-Path $desktop 'EXDA.lnk'))) {
    Write-ExdaShortcut $desktop
} elseif ($desktop) {
    Write-Host ''
    $answer = Read-Host 'Also add an EXDA shortcut to your Desktop? [y/N]'
    if ($answer -match '^(y|yes)$') { Write-ExdaShortcut $desktop }
}
