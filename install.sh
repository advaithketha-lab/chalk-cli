#!/usr/bin/env bash
# Chalk CLI - Installation Script (macOS/Linux)
# Run from the project directory: bash install.sh

set -e

echo ""
echo "  Installing Chalk CLI..."
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "  Error: Node.js is not installed."
    echo "  Install it from https://nodejs.org (v18+ required)"
    exit 1
fi

NODE_VER=$(node -v)
MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\)\..*/\1/')
echo "  Found Node.js $NODE_VER"

if [ "$MAJOR" -lt 18 ]; then
    echo "  Error: Node.js 18+ required. You have $NODE_VER"
    exit 1
fi

# Find project directory (where this script lives)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$SCRIPT_DIR/package.json" ]; then
    echo "  Error: package.json not found in $SCRIPT_DIR"
    echo "  Run this script from the chalk-cli project directory."
    exit 1
fi

# Install and build
echo "  Installing dependencies..."
cd "$SCRIPT_DIR"
npm install --silent 2>/dev/null

echo "  Building..."
npm run build 2>/dev/null

echo "  Linking globally..."
npm link --force 2>/dev/null || sudo npm link --force 2>/dev/null

# Create directories
mkdir -p "$HOME/.chalk/sessions" "$HOME/.chalk/logs"

# Verify
if command -v chalk &> /dev/null; then
    VERSION=$(chalk --version 2>/dev/null)
    echo ""
    echo "  Chalk CLI installed successfully!"
    echo "  Version: $VERSION"
    echo ""
    echo "  Get started:"
    echo "    chalk login        Set up your API key"
    echo "    chalk              Start interactive mode"
    echo "    chalk \"question\"   One-shot prompt"
    echo "    chalk --help       Show all options"
    echo ""
else
    echo ""
    echo "  Installed, but 'chalk' not found in PATH."
    echo "  Try: node $SCRIPT_DIR/dist/index.js"
    echo ""
fi
