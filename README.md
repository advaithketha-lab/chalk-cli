# Arcee Codex CLI

A production-grade, multi-agent CLI tool powered by **Arcee AI Trinity Large Preview** via OpenRouter.

## Architecture

The system is composed of 5 specialized agents coordinated by an orchestrator:

```
┌────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR AGENT                       │
│  - Coordinates all agents via message bus                  │
│  - Manages REPL loop and task dispatch                     │
│  - Handles error recovery and graceful shutdown            │
├──────────┬──────────┬──────────┬──────────┬───────────────┤
│ FRONTEND │ BACKEND  │PERSISTENCE│UTILITIES │  RUST BACKEND │
│  AGENT   │  AGENT   │  AGENT   │  AGENT   │  (optional)   │
│          │          │          │          │               │
│ • CLI I/O│ • API    │ • Session│ • Logger │ • High-perf   │
│ • Syntax │   calls  │   store  │ • Token  │   API client  │
│   high-  │ • Retry  │ • Config │   counter│ • LRU cache   │
│   light  │ • Cache  │ • History│ • Command│ • Retry logic │
│ • Multi- │ • Concur-│ • Export │   parser │ • Streaming   │
│   line   │   rency  │          │          │               │
└──────────┴──────────┴──────────┴──────────┴───────────────┘
```

### Agent Communication Protocol

Agents communicate through typed messages with the following structure:

```typescript
interface AgentMessage {
  id: string;           // Unique message ID
  type: MessageType;    // e.g., 'chat_request', 'save_session'
  from: AgentId;        // Source agent
  to: AgentId;          // Target agent
  payload: unknown;     // Message data
  priority: Priority;   // low | normal | high | critical
  timestamp: Date;
}
```

## Quick Start

### Prerequisites

- **Node.js 18+** (required)
- **Python 3.8+** (optional, for tests)
- **Rust/Cargo** (optional, for Rust backend)

### Setup

```bash
# Clone and enter the project
cd arcee-codex-cli

# Run the setup script
# Windows:
setup.bat

# Linux/macOS:
chmod +x setup.sh && ./setup.sh

# Or manually:
npm install
npm run build
cp .env.example .env
# Edit .env and set OPENROUTER_API_KEY
```

### Configure API Key

Edit `.env` and set your OpenRouter API key:

```
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

### Run

```bash
# Development mode (with tsx, auto-recompile)
npm run dev

# Production mode (compiled JS)
npm start
```

## CLI Commands

| Command       | Description                          |
|--------------|--------------------------------------|
| `/help`      | Show available commands              |
| `/exit`      | Exit the CLI                         |
| `/clear`     | Clear the screen                     |
| `/history`   | Show conversation history            |
| `/save`      | Save current session                 |
| `/load <id>` | Load a saved session                 |
| `/sessions`  | List all saved sessions              |
| `/new`       | Start a new session                  |
| `/config`    | Show current configuration           |
| `/tokens`    | Show token usage for current session |
| `/export <f>`| Export session to text file           |
| `/model`     | Show or change the AI model          |
| `/status`    | Show agent health status             |

### Multi-line Input

Type ` ``` ` to start multi-line input, type ` ``` ` again to submit:

```
>>> ```
... def fibonacci(n):
...     if n <= 1:
...         return n
...     return fibonacci(n-1) + fibonacci(n-2)
... ```
```

## Example Session

```
  ╔══════════════════════════════════════════════╗
  ║          Arcee Codex CLI v1.0.0              ║
  ║   Multi-Agent AI Assistant powered by        ║
  ║   Arcee AI Trinity via OpenRouter            ║
  ╚══════════════════════════════════════════════╝
  Model: arcee-ai/trinity-large-preview:free
  Type /help for commands, ``` for multi-line input

>>> Write a Rust function to reverse a string

Arcee: Here's a Rust function to reverse a string:

  ── rust ──
  fn reverse_string(s: &str) -> String {
      s.chars().rev().collect()
  }

  fn main() {
      let original = "Hello, world!";
      let reversed = reverse_string(original);
      println!("{}", reversed); // !dlrow ,olleH
  }
  ──────────

  [tokens: 25 in / 48 out | total: 73 | cost: $0.000085]

>>> /status

Agent Status:

  Orchestrator Agent     healthy    errors: 0  uptime: 2m
  Frontend Agent         healthy    errors: 0  uptime: 2m
  Backend Agent          healthy    errors: 0  uptime: 2m
  Persistence Agent      healthy    errors: 0  uptime: 2m
  Utilities Agent        healthy    errors: 0  uptime: 2m

>>> /exit
[info] Goodbye!
```

## Project Structure

```
arcee-codex-cli/
├── src/
│   ├── index.ts                          # Entry point
│   ├── interfaces/
│   │   ├── agent.ts                      # Agent interface & base class
│   │   ├── message.ts                    # Message protocol types
│   │   └── config.ts                     # Configuration types
│   ├── types/
│   │   └── index.ts                      # Shared types
│   └── agents/
│       ├── orchestrator/
│       │   ├── index.ts                  # Orchestrator Agent
│       │   └── task-manager.ts           # Task tracking
│       ├── frontend/
│       │   ├── index.ts                  # Frontend Agent
│       │   ├── input-handler.ts          # Multi-line input
│       │   └── output-renderer.ts        # Syntax highlighting
│       ├── backend/
│       │   ├── index.ts                  # Backend Agent
│       │   ├── api-client.ts             # OpenRouter API client
│       │   ├── retry.ts                  # Retry with backoff
│       │   └── cache.ts                  # LRU response cache
│       ├── persistence/
│       │   ├── index.ts                  # Persistence Agent
│       │   ├── session-store.ts          # Session save/load
│       │   └── config-manager.ts         # Config from env/TOML
│       └── utilities/
│           ├── index.ts                  # Utilities Agent
│           ├── logger.ts                 # Winston structured logging
│           ├── token-counter.ts          # Token estimation
│           └── command-parser.ts         # CLI command parser
├── rust-backend/                         # Optional Rust backend
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs                       # Stdin/stdout JSON protocol
│       ├── api_client.rs                 # HTTP client with streaming
│       ├── cache.rs                      # LRU cache with TTL
│       └── retry.rs                      # Exponential backoff
├── tests/                                # Python test suite
│   ├── test_api.py                       # API client tests
│   ├── test_agents.py                    # Agent communication tests
│   └── test_integration.py              # End-to-end tests
├── config/
│   └── default.toml                      # Default configuration
├── package.json
├── tsconfig.json
├── .env.example
├── setup.bat                             # Windows setup
└── setup.sh                              # Linux/macOS setup
```

## Configuration

Configuration is loaded from multiple sources (highest priority first):

1. **Environment variables** — `OPENROUTER_API_KEY`, `ARCEE_MODEL`, etc.
2. **`.env` file** — Local environment overrides
3. **`config/default.toml`** — TOML configuration file
4. **Built-in defaults** — Hardcoded fallbacks

## Testing

```bash
# TypeScript unit tests
npm test

# Python test suite
cd tests
pip install -r requirements.txt
pytest -v

# Rust backend tests (if Rust is installed)
cd rust-backend
cargo test
```

## Production Features

- **Retry with exponential backoff** — Handles 429/5xx errors automatically
- **LRU response cache** — Avoids redundant API calls for identical prompts
- **Concurrency limiter** — Prevents API overload with max 3 parallel requests
- **Structured logging** — JSON logs with rotation via Winston
- **Session persistence** — Auto-saves conversations to disk
- **Graceful shutdown** — All agents clean up on Ctrl+D
- **Agent health monitoring** — `/status` shows real-time agent health

## License

MIT
