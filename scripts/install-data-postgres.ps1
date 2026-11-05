param([string]$ProjectRoot=(Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference='Stop'
$runtime=Join-Path $ProjectRoot 'data\postgres-runtime'
$archive=Join-Path $runtime 'postgresql-binaries.zip'
$binary=Join-Path $runtime 'pgsql\bin\initdb.exe'
if (!(Test-Path -LiteralPath $binary)) {
  New-Item -ItemType Directory -Path $runtime -Force | Out-Null
  Invoke-WebRequest -Uri 'https://sbp.enterprisedb.com/getfile.jsp?fileid=1260609' -OutFile $archive
  $digest=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($digest -ne 'e2246ba91d22345bc3d017586c09ede52d9df180b1eeb480f050445f1cad84e2') { throw 'PostgreSQL archive checksum mismatch' }
  Expand-Archive -LiteralPath $archive -DestinationPath $runtime
}
python -m pip install 'psycopg[binary]>=3.3.6,<4'
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL driver installation failed' }
python (Join-Path $PSScriptRoot 'setup-data-postgres.py') --root $ProjectRoot
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL setup failed' }
