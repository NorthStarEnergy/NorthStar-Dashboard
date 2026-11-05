[CmdletBinding()]
param(
    [string]$DriveRecoveryRoot = 'H:\My Drive\Work Projects\NorthStar\Operations\Recovery',
    [switch]$ConfirmSensitiveUpload
)

$ErrorActionPreference = 'Stop'

if (-not $ConfirmSensitiveUpload) {
    throw 'Sensitive operational data upload was not confirmed. Re-run with -ConfirmSensitiveUpload only after owner approval.'
}

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dataRoot = Join-Path $projectRoot 'data'
$backupRoot = Join-Path $dataRoot 'backups'
$secretSource = Join-Path $dataRoot '.northstar-qr-secret'
$databaseTarget = Join-Path $DriveRecoveryRoot 'Database Backups'
$secretTarget = Join-Path $DriveRecoveryRoot 'QR Secret'
$sourceTarget = Join-Path $DriveRecoveryRoot 'Source Bundles'

if (-not (Test-Path -LiteralPath $DriveRecoveryRoot -PathType Container)) {
    throw "Google Drive recovery root is unavailable: $DriveRecoveryRoot"
}
if (-not (Test-Path -LiteralPath $secretSource -PathType Leaf)) {
    throw "QR signing secret is missing: $secretSource"
}

$backups = @(Get-ChildItem -LiteralPath $backupRoot -Filter 'northstar-*.db' -File |
    Sort-Object Name)
if (-not $backups.Count) {
    throw "No database backups were found under $backupRoot"
}

foreach ($directory in @($databaseTarget, $secretTarget, $sourceTarget)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$verified = @()
foreach ($backup in $backups) {
    $destination = Join-Path $databaseTarget $backup.Name
    Copy-Item -LiteralPath $backup.FullName -Destination $destination -Force
    $sourceHash = (Get-FileHash -LiteralPath $backup.FullName -Algorithm SHA256).Hash
    $destinationHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    if ($sourceHash -ne $destinationHash) {
        throw "Backup hash verification failed for $($backup.Name)"
    }
    $verified += [pscustomobject]@{
        Type = 'database-backup'
        Name = $backup.Name
        Bytes = $backup.Length
        Sha256 = $destinationHash
    }
}

$secretDestination = Join-Path $secretTarget '.northstar-qr-secret'
Copy-Item -LiteralPath $secretSource -Destination $secretDestination -Force
$secretSourceHash = (Get-FileHash -LiteralPath $secretSource -Algorithm SHA256).Hash
$secretDestinationHash = (Get-FileHash -LiteralPath $secretDestination -Algorithm SHA256).Hash
if ($secretSourceHash -ne $secretDestinationHash) {
    throw 'QR signing secret hash verification failed.'
}
$verified += [pscustomobject]@{
    Type = 'qr-signing-secret'
    Name = '.northstar-qr-secret'
    Bytes = (Get-Item -LiteralPath $secretDestination).Length
    Sha256 = $secretDestinationHash
}

$bundleName = "northstar-source-$((git -C $projectRoot rev-parse --short=12 HEAD).Trim()).bundle"
$bundleDestination = Join-Path $sourceTarget $bundleName
git -C $projectRoot bundle create $bundleDestination --all
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $bundleDestination -PathType Leaf)) {
    throw 'Git source bundle creation failed.'
}
git -C $projectRoot bundle verify $bundleDestination | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Git source bundle verification failed.'
}
$verified += [pscustomobject]@{
    Type = 'source-bundle'
    Name = $bundleName
    Bytes = (Get-Item -LiteralPath $bundleDestination).Length
    Sha256 = (Get-FileHash -LiteralPath $bundleDestination -Algorithm SHA256).Hash
}

$latestRemoteBackup = Join-Path $databaseTarget $backups[-1].Name
& python (Join-Path $projectRoot 'scripts\restore_drill.py') $latestRemoteBackup
if ($LASTEXITCODE -ne 0) {
    throw 'The copied Google Drive backup failed the restore drill.'
}

[Environment]::SetEnvironmentVariable(
    'NORTHSTAR_BACKUP_MIRROR',
    $databaseTarget,
    [EnvironmentVariableTarget]::User
)

$manifest = [pscustomobject]@{
    CreatedAtUtc = [DateTime]::UtcNow.ToString('o')
    GitCommit = (git -C $projectRoot rev-parse HEAD).Trim()
    BackupMirror = $databaseTarget
    Files = $verified
}
$manifestPath = Join-Path $DriveRecoveryRoot 'recovery-manifest.json'
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8

[pscustomobject]@{
    DatabaseBackups = $backups.Count
    QrSecretVerified = $true
    SourceBundleVerified = $true
    RestoreDrillPassed = $true
    BackupMirrorConfiguredForUser = $true
    Manifest = $manifestPath
}
