param(
 [Parameter(Mandatory=$true)][string]$VaultPath,
 [string]$ConfigDir = '.obsidian',
 [switch]$Enable
)
$ErrorActionPreference='Stop'
$vaultRoot=(Resolve-Path -LiteralPath $VaultPath).Path
$configRoot=[System.IO.Path]::GetFullPath((Join-Path $vaultRoot $ConfigDir))
if (-not $configRoot.StartsWith($vaultRoot+[System.IO.Path]::DirectorySeparatorChar,[System.StringComparison]::OrdinalIgnoreCase)) { throw '配置目录必须位于仓库内部。' }
if (-not (Test-Path -LiteralPath $configRoot -PathType Container)) { throw '找不到 Obsidian 配置目录，请先在 Obsidian 中打开该仓库。' }
$pluginId='jeanmk-obsidian-ai'
$target=Join-Path (Join-Path $configRoot 'plugins') $pluginId
$files=@('main.js','manifest.json','styles.css','pdf.mjs','pdf.worker.mjs','第三方依赖说明.md','LICENSE')
foreach($file in $files){if(-not(Test-Path -LiteralPath (Join-Path $PSScriptRoot $file))){throw ('缺少发布文件：'+$file)}}
if (Test-Path -LiteralPath $target) {
 $backup=Join-Path $PSScriptRoot ('安装前备份-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
 New-Item -ItemType Directory -Path $backup | Out-Null
 foreach($file in $files){$old=Join-Path $target $file;if(Test-Path -LiteralPath $old){Copy-Item -LiteralPath $old -Destination $backup}}
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
foreach($file in $files){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $target $file) -Force}
$licenseSource=Join-Path $PSScriptRoot 'licenses'
if(Test-Path -LiteralPath $licenseSource){Copy-Item -LiteralPath $licenseSource -Destination $target -Recurse -Force}
if($Enable){
 $listPath=Join-Path $configRoot 'community-plugins.json'
 $list=@();if(Test-Path -LiteralPath $listPath){$list=@(Get-Content -LiteralPath $listPath -Raw | ConvertFrom-Json)}
 if($list -notcontains $pluginId){
  if(Test-Path -LiteralPath $listPath){Copy-Item -LiteralPath $listPath -Destination (Join-Path $PSScriptRoot 'community-plugins.before-install.json') -Force}
  $list+= $pluginId
  [System.IO.File]::WriteAllText($listPath,(ConvertTo-Json -InputObject @($list)) + "`n",[System.Text.UTF8Encoding]::new($false))
 }
}
Write-Output ('已安装：'+$target)
Write-Output '重新打开 Obsidian 后，在插件设置中配置 DeepSeek API Key。现有 data.json 和附件缓存保持不变。'
