param(
  [string]$Port = "",
  [switch]$Upload,
  [switch]$Receiver
)

$ErrorActionPreference = 'Stop'
if ($Upload -and -not $Port) { throw 'Podaj -Port COMx dla ESP32.' }

$repoPath = Split-Path -Parent $PSScriptRoot
$cliPath = (Get-Command arduino-cli -ErrorAction SilentlyContinue).Source
$cliOptions = @()
if (-not $cliPath) {
  $cliPath = 'C:\Program Files\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'
  $ideConfig = Join-Path $env:USERPROFILE '.arduinoIDE\arduino-cli.yaml'
  if (Test-Path -LiteralPath $ideConfig) {
    $cliOptions = @('--config-file', $ideConfig)
  }
}
if (-not (Test-Path -LiteralPath $cliPath)) { throw 'Zainstaluj Arduino IDE 2 lub arduino-cli.' }

if ($Receiver) {
  $sketchName = 'ParakopterReceiver'
  $source = 'examples\receiver\main.cpp'
  $supportFiles = @('lib\IrFormat\IrFormat.h', 'lib\IrFormat\IrFormat.cpp')
  $buildPath = Join-Path $repoPath '.local\receiver-firmware'
} else {
  $sketchName = 'Parakopter'
  $source = 'src\main.cpp'
  $supportFiles = @('lib\S107Controller\S107Controller.h')
  $buildPath = Join-Path $repoPath '.local\firmware'
}

$sketchPath = Join-Path $repoPath ".local\sketch\$sketchName"
New-Item -ItemType Directory -Force $sketchPath,$buildPath | Out-Null
Copy-Item -LiteralPath (Join-Path $repoPath $source) -Destination (Join-Path $sketchPath "$sketchName.ino")
foreach ($file in $supportFiles) {
  Copy-Item -LiteralPath (Join-Path $repoPath $file) -Destination $sketchPath
}

$fqbn = 'esp32:esp32:esp32:UploadSpeed=115200,FlashFreq=40,FlashMode=dio,FlashSize=4M,PartitionScheme=default,PSRAM=disabled'
& $cliPath @cliOptions compile --fqbn $fqbn --build-path $buildPath $sketchPath
if ($LASTEXITCODE -ne 0) { throw "Blad kompilacji szkicu $sketchName." }
if ($Upload) {
  & $cliPath @cliOptions upload --fqbn $fqbn --port $Port --input-dir $buildPath $sketchPath
  if ($LASTEXITCODE -ne 0) { throw "Blad wgrywania szkicu $sketchName." }
}
