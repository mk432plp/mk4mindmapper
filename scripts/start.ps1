param(
  [int]$Port = 4174,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$prefix = "http://localhost:$Port/"

function Write-Response {
  param(
    [System.IO.Stream]$Stream,
    [int]$StatusCode,
    [string]$ContentType,
    [byte[]]$Body
  )
  $reason = if ($StatusCode -eq 200) { "OK" } elseif ($StatusCode -eq 403) { "Forbidden" } else { "Not Found" }
  $headers = "HTTP/1.1 $StatusCode $reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  $Stream.Write($Body, 0, $Body.Length)
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

Write-Host "MK4 MindMapper is running at $prefix"
Write-Host "Press Ctrl+C to stop the local app server."

$programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
$browserCandidates = @(
  (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $programFilesX86 "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path $programFilesX86 "Google\Chrome\Application\chrome.exe")
)
$browser = $browserCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $NoOpen) {
  if ($browser) {
    Start-Process -FilePath $browser -ArgumentList "--app=$prefix"
  } else {
    Start-Process $prefix
  }
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
    $requestLine = $reader.ReadLine()
    while ($true) {
      $headerLine = $reader.ReadLine()
      if ([string]::IsNullOrEmpty($headerLine)) { break }
    }
    if ([string]::IsNullOrWhiteSpace($requestLine)) {
      $client.Close()
      continue
    }
    $requestTarget = ($requestLine -split " ")[1]
    $requestPath = [Uri]::UnescapeDataString(($requestTarget -split "\?")[0].TrimStart("/"))
    if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = "index.html" }
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $requestPath))
    if (-not $candidate.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
      Write-Response $stream 403 "text/plain" ([System.Text.Encoding]::UTF8.GetBytes("Forbidden"))
      $client.Close()
      continue
    }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      Write-Response $stream 404 "text/plain" ([System.Text.Encoding]::UTF8.GetBytes("Not found"))
      $client.Close()
      continue
    }
    $ext = [System.IO.Path]::GetExtension($candidate).ToLowerInvariant()
    $types = @{
      ".html" = "text/html; charset=utf-8"
      ".css" = "text/css; charset=utf-8"
      ".js" = "text/javascript; charset=utf-8"
      ".json" = "application/json; charset=utf-8"
      ".webmanifest" = "application/manifest+json; charset=utf-8"
      ".svg" = "image/svg+xml"
      ".png" = "image/png"
      ".md" = "text/markdown; charset=utf-8"
    }
    if ($types.ContainsKey($ext)) {
      $contentType = $types[$ext]
    } else {
      $contentType = "application/octet-stream"
    }
    $bytes = [System.IO.File]::ReadAllBytes($candidate)
    Write-Response $stream 200 $contentType $bytes
    $client.Close()
  }
}
finally {
  $listener.Stop()
}
