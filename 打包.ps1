param()
$ErrorActionPreference='Stop'
& node (Join-Path $PSScriptRoot 'build.cjs')
if($LASTEXITCODE -ne 0){throw '构建失败'}
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw|ConvertFrom-Json
$dist=Join-Path $PSScriptRoot 'dist'
New-Item -ItemType Directory -Path $dist -Force|Out-Null
$archive=Join-Path $dist ('notereply-'+$manifest.version+'.zip')
if(Test-Path -LiteralPath $archive){throw '安装包已存在，请先递增版本号。'}
$names=@('main.js','manifest.json','styles.css','pdf.mjs','pdf.worker.mjs','LICENSE','licenses','README.md','使用说明.md','第三方依赖说明.md')
$files=@($names|ForEach-Object{Join-Path $PSScriptRoot $_})
Compress-Archive -LiteralPath $files -DestinationPath $archive -CompressionLevel Optimal
Write-Output ('已生成：'+$archive)
