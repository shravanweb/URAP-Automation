$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$base = Join-Path $root ".tools\mariadb-11.4.13-winx64\bin\mysqld.exe"
$ini = Join-Path $root ".tools\mariadb-data\my.ini"
if (-not (Test-Path $base)) {
  Write-Error "MariaDB is not extracted. See docs/installation-guide.md."
  exit 1
}
& $base --defaults-file=$ini --console
