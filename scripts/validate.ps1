$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$required = @(
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "service-worker.js",
  "src\app.js",
  "src\model.js",
  "src\layout.js",
  "src\history.js",
  "src\importExport.js",
  "tests\test-runner.html",
  "README.md"
)

foreach ($file in $required) {
  $path = Join-Path $root $file
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Missing required file: $file"
  }
}

$index = Get-Content -LiteralPath (Join-Path $root "index.html") -Raw
foreach ($needle in @("Topic Tree", "Infinite Canvas", "Properties", "Save .mk4map")) {
  if (-not $index.Contains($needle)) {
    throw "index.html is missing expected UI text: $needle"
  }
}

$imports = Select-String -Path (Join-Path $root "src\*.js") -Pattern "from `"./" -AllMatches
if ($imports.Count -lt 4) {
  throw "Expected ES module imports were not found."
}

$specTerms = Select-String -Path (Join-Path $root "src\*.js") -Pattern "xmind|mk4map|opml|autosave|relationship|boundary|summary" -AllMatches
if ($specTerms.Count -lt 7) {
  throw "Specification feature hooks are missing."
}

Write-Host "Static validation passed."
Write-Host "Open tests/test-runner.html in a modern browser to run the module-level browser tests."
