# dsh-forge/scripts/mount-ui.ps1
# Mount dsh-forge-ui into the deployment: copy package + patch web profile.
$ErrorActionPreference = 'Stop'
$src = 'C:/Users/SolimPurmiss/Desktop/DeepForge/dsh-forge/ui-plugin'
$dst = if ($env:DSH_DEPLOY_NM) { Join-Path $env:DSH_DEPLOY_NM 'dsh-forge-ui' } else { Join-Path $env:USERPROFILE '.npm_cache/_npx/1e7f6d9597241db0/node_modules/dsh-forge-ui' }
$patch = if ($env:DSH_HOME) { Join-Path $env:DSH_HOME 'profiles/web/cordis.patch.yml' } else { Join-Path $env:USERPROFILE '.dsh/profiles/web/cordis.patch.yml' }

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
