# dsh-forge/scripts/mount-ui.ps1
# Mount dsh-forge-ui into the deployment: copy package + patch web profile.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root 'ui-plugin'
$home = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$dst = if ($env:DSH_DEPLOY_NM) { Join-Path $env:DSH_DEPLOY_NM 'dsh-forge-ui' } else { $null }
if (-not $dst) {
  $profileNm = Join-Path $home 'profiles/web/node_modules'
  if (Test-Path (Join-Path $profileNm '@deepseek-ai/dsh-base/package.json')) { $dst = Join-Path $profileNm 'dsh-forge-ui' }
}
if (-not $dst) { throw 'Could not locate deployment node_modules. Set DSH_DEPLOY_NM to the node_modules containing @deepseek-ai/dsh-base.' }
$patch = Join-Path $home 'profiles/web/cordis.patch.yml'

New-Item -ItemType Directory -Force -Path (Join-Path $dst 'lib') | Out-Null
Copy-Item (Join-Path $src 'package.json') -Destination $dst -Force
Copy-Item (Join-Path $src 'lib/index.js') -Destination (Join-Path $dst 'lib') -Force
Copy-Item (Join-Path $src 'lib/client.js') -Destination (Join-Path $dst 'lib') -Force
Write-Output ('copied -> ' + $dst)

$content = Get-Content $patch -Raw
if ($content -match 'dsh-forge-ui') {
  Write-Output 'row already present; patch untouched'
} else {
  $row = "- insert:`r`n    - id: forge-ui`r`n      name: 'dsh-forge-ui'`r`n"
  $content = $content.TrimEnd() + "`r`n" + $row
  Set-Content -Path $patch -Value $content -Encoding utf8
  Write-Output 'row added to profile patch'
}
Get-ChildItem $dst -Recurse -File | Select-Object -ExpandProperty FullName
Write-Output '---PATCH---'
Get-Content $patch
