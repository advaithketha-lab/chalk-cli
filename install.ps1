# Chalk CLI - Windows Installation Script
# Run from the project directory: .\install.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  Installing Chalk CLI..." -ForegroundColor Cyan
Write-Host ""

# Check Node.js
try {
    $nodeVersion = & node -v 2>$null
    if (-not $nodeVersion) { throw "not found" }
    Write-Host "  Found Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  Error: Node.js is not installed." -ForegroundColor Red
    Write-Host "  Install it from https://nodejs.org (v18+ required)" -ForegroundColor Yellow
    exit 1
}

# Check version
$major = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
if ($major -lt 18) {
    Write-Host "  Error: Node.js 18+ required. You have $nodeVersion" -ForegroundColor Red
    exit 1
}

# Find project directory (where this script lives)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path "$scriptDir\package.json")) {
    Write-Host "  Error: package.json not found in $scriptDir" -ForegroundColor Red
    Write-Host "  Run this script from the chalk-cli project directory." -ForegroundColor Yellow
    exit 1
}

# Install dependencies
Write-Host "  Installing dependencies..." -ForegroundColor Cyan
Push-Location $scriptDir
npm install --silent 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Error: npm install failed" -ForegroundColor Red
    Pop-Location
    exit 1
}

# Build
Write-Host "  Building..." -ForegroundColor Cyan
npm run build 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Error: Build failed" -ForegroundColor Red
    Pop-Location
    exit 1
}

# Link globally
Write-Host "  Linking globally..." -ForegroundColor Cyan
npm link --force 2>$null
Pop-Location

# Create ~/.chalk directories
$chalkHome = "$env:USERPROFILE\.chalk"
New-Item -ItemType Directory -Force -Path "$chalkHome\sessions" | Out-Null
New-Item -ItemType Directory -Force -Path "$chalkHome\logs" | Out-Null

# Verify
try {
    $ver = & chalk --version 2>$null
    Write-Host ""
    Write-Host "  Chalk CLI installed successfully!" -ForegroundColor Green
    Write-Host "  Version: $ver" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Get started:" -ForegroundColor White
    Write-Host "    chalk login        Set up your API key" -ForegroundColor Gray
    Write-Host "    chalk              Start interactive mode" -ForegroundColor Gray
    Write-Host '    chalk "question"   One-shot prompt' -ForegroundColor Gray
    Write-Host "    chalk --help       Show all options" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host ""
    Write-Host "  Installed, but 'chalk' command not found in PATH." -ForegroundColor Yellow
    Write-Host "  Try reopening your terminal, or run:" -ForegroundColor Yellow
    Write-Host "    node $scriptDir\dist\index.js" -ForegroundColor Gray
    Write-Host ""
}
