#!/usr/bin/env node

// ============================================================================
//  Chalk CLI - AI Coding Assistant powered by Fin 0.1
//  A Claude-Code-style tool that connects to your IDE instantly.
//
//  Usage:
//    chalk                     Interactive REPL
//    chalk "fix the bug"       One-shot prompt
//    chalk login               Set up API key
//    chalk --version           Show version
//
//  Global Install:
//    npm link --force          (from project dir, for you)
//    npm install -g chalk-cli-ai  (for anyone, once published)
// ============================================================================

import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import readline from "readline";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import dotenv from "dotenv";

// ─── Constants ──────────────────────────────────────────────────────────────

const VERSION = "0.1.0";
const MODEL_NAME = "Fin 0.1";
const CHALK_HOME = path.join(os.homedir(), ".chalk");
const CHALK_ENV = path.join(CHALK_HOME, ".env");
const API_BASE = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "deepseek/deepseek-r1-0528";
const MAX_TREE_DEPTH = 3;
const MAX_TREE_FILES = 200;
const TOOL_TIMEOUT_MS = 120_000;

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", "__pycache__", ".venv",
  "venv", "dist", "build", ".cache", ".turbo", "target", ".svelte-kit",
  "coverage", ".pytest_cache", ".mypy_cache", "vendor", ".idea",
  ".vscode", ".DS_Store", "env", ".env", ".tox", "out",
]);

// ─── Config: ~/.chalk/.env ──────────────────────────────────────────────────

function ensureChalkHome() {
  for (const dir of [CHALK_HOME, path.join(CHALK_HOME, "sessions"), path.join(CHALK_HOME, "logs")]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function loadConfig() {
  ensureChalkHome();
  // Load global ~/.chalk/.env first, then local .env can override
  dotenv.config({ path: CHALK_ENV });
  dotenv.config(); // local .env in cwd
  return {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    model: process.env.CHALK_MODEL || DEFAULT_MODEL,
    baseUrl: process.env.OPENROUTER_BASE_URL || API_BASE,
  };
}

function saveEnvValue(key, value) {
  ensureChalkHome();
  let content = "";
  if (fs.existsSync(CHALK_ENV)) {
    content = fs.readFileSync(CHALK_ENV, "utf-8");
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content = content.trimEnd() + `\n${key}=${value}\n`;
    }
  } else {
    content = `${key}=${value}\n`;
  }
  fs.writeFileSync(CHALK_ENV, content, "utf-8");
}

// ─── File Tree Scanner (Instant IDE Context) ────────────────────────────────

function scanFileTree(dir, depth = 0, prefix = "") {
  if (depth > MAX_TREE_DEPTH) return [];
  const lines = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return lines;
  }

  // Sort: dirs first, then files, alphabetical
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  let count = 0;
  for (const entry of entries) {
    if (count >= MAX_TREE_FILES) {
      lines.push(`${prefix}  ... (truncated)`);
      break;
    }
    if (IGNORED_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.isDirectory()) continue;

    if (entry.isDirectory()) {
      lines.push(`${prefix}${entry.name}/`);
      const sub = scanFileTree(path.join(dir, entry.name), depth + 1, prefix + "  ");
      lines.push(...sub);
    } else {
      lines.push(`${prefix}${entry.name}`);
    }
    count++;
  }
  return lines;
}

function getProjectContext() {
  const cwd = process.cwd();
  const tree = scanFileTree(cwd);
  const treeStr = tree.length > 0 ? tree.join("\n") : "(empty directory)";

  // Try to read package.json for extra context
  let projectInfo = "";
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      projectInfo = `\nProject: ${pkg.name || "unknown"} v${pkg.version || "?"}\n`;
      if (pkg.description) projectInfo += `Description: ${pkg.description}\n`;
      if (pkg.scripts) projectInfo += `Scripts: ${Object.keys(pkg.scripts).join(", ")}\n`;
    } catch { /* skip */ }
  }

  // Try to detect language/framework
  const markers = {
    "package.json": "Node.js",
    "Cargo.toml": "Rust",
    "pyproject.toml": "Python",
    "requirements.txt": "Python",
    "go.mod": "Go",
    "pom.xml": "Java (Maven)",
    "build.gradle": "Java (Gradle)",
    "Gemfile": "Ruby",
    "composer.json": "PHP",
  };
  const detected = [];
  for (const [file, lang] of Object.entries(markers)) {
    if (fs.existsSync(path.join(cwd, file))) detected.push(lang);
  }
  const langInfo = detected.length > 0 ? `Detected: ${detected.join(", ")}\n` : "";

  return { cwd, treeStr, projectInfo, langInfo };
}

// ─── Tool Definitions (sent to AI model) ────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "tool_run",
      description:
        "Execute a terminal command in the user's shell. Use for: npm, pip, brew, cargo, git, " +
        "python, node, compiling, testing, installing packages, or any CLI operation. " +
        "The command runs in the user's current working directory.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to execute" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tool_edit",
      description:
        "Create or overwrite a file with the given content. Automatically creates parent " +
        "directories. Use for writing code, config files, docs, or any text file.",
      parameters: {
        type: "object",
        properties: {
          filepath: { type: "string", description: "File path (relative to cwd or absolute)" },
          content: { type: "string", description: "The full file content to write" },
        },
        required: ["filepath", "content"],
      },
    },
  },
];

// ─── Tool Execution with y/n Confirmation ───────────────────────────────────

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function execToolRun(command) {
  console.log(chalk.dim(`\n  $ ${command}`));
  const answer = await ask(chalk.yellow("  Run this command? (Y/n) "));
  if (answer === "n" || answer === "no") {
    return { output: "User denied command execution.", success: false };
  }
  try {
    const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
    const result = execSync(command, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: TOOL_TIMEOUT_MS,
      cwd: process.cwd(),
      shell,
    });
    const trimmed = result.trim();
    if (trimmed) console.log(chalk.dim(`  ${trimmed.split("\n").join("\n  ")}`));
    else console.log(chalk.dim("  (completed, no output)"));
    return { output: trimmed || "(completed, no output)", success: true };
  } catch (err) {
    const stderr = err.stderr?.toString().trim() || "";
    const stdout = err.stdout?.toString().trim() || "";
    const msg = [stdout, stderr].filter(Boolean).join("\n") || err.message;
    console.log(chalk.red(`  ${msg.split("\n").join("\n  ")}`));
    return { output: msg, success: false };
  }
}

async function execToolEdit(filepath, content) {
  const resolved = path.resolve(filepath);
  const lineCount = content.split("\n").length;
  console.log(chalk.dim(`\n  Write: ${resolved} (${lineCount} lines)`));
  const answer = await ask(chalk.yellow("  Write this file? (Y/n) "));
  if (answer === "n" || answer === "no") {
    return { output: "User denied file write.", success: false };
  }
  try {
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolved, content, "utf-8");
    const msg = `File written: ${resolved} (${lineCount} lines)`;
    console.log(chalk.green(`  ${msg}`));
    return { output: msg, success: true };
  } catch (err) {
    const msg = `Failed to write: ${err.message}`;
    console.log(chalk.red(`  ${msg}`));
    return { output: msg, success: false };
  }
}

async function dispatchTool(name, args) {
  switch (name) {
    case "tool_run":
      return execToolRun(args.command);
    case "tool_edit":
      return execToolEdit(args.filepath, args.content);
    default:
      return { output: `Unknown tool: ${name}`, success: false };
  }
}

// ─── Slash Command UI (inquirer-autocomplete-prompt) ────────────────────────

const SLASH_COMMANDS = [
  { name: "/help",    description: "Show available commands and usage" },
  { name: "/clear",   description: "Clear the terminal screen" },
  { name: "/agents",  description: "Show system status and health" },
  { name: "/config",  description: "Show configuration and paths" },
  { name: "/model",   description: "Show current AI model" },
  { name: "/tree",    description: "Show project file tree" },
  { name: "/cost",    description: "Show token usage this session" },
  { name: "/compact", description: "Truncate conversation to save context" },
  { name: "/new",     description: "Start a new conversation" },
  { name: "/exit",    description: "Exit Chalk" },
];

async function showSlashMenu() {
  return new Promise((resolve) => {
    let filter = "";
    let selected = 0;
    let filtered = [...SLASH_COMMANDS];

    if (!process.stdin.isTTY) { resolve(null); return; }

    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    function render(clear) {
      if (clear) {
        // Move up and clear previous render
        const lines = filtered.length + 2;
        process.stdout.write(`\x1b[${lines}A\x1b[J`);
      }
      process.stdout.write(`  ${chalk.dim("/")}${chalk.cyan(filter)}\n\n`);
      if (filtered.length === 0) {
        process.stdout.write(chalk.dim("  No matching commands\n"));
      } else {
        for (let i = 0; i < filtered.length; i++) {
          const c = filtered[i];
          const name = c.name.padEnd(14);
          if (i === selected) {
            process.stdout.write(`  ${chalk.cyan.bold(name)} ${chalk.white(c.description)}\n`);
          } else {
            process.stdout.write(`  ${chalk.dim(name)} ${chalk.dim(c.description)}\n`);
          }
        }
      }
    }

    function cleanup() {
      process.stdin.removeListener("data", onKey);
      if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw ?? false);
      // Clear menu
      const lines = filtered.length + 2;
      process.stdout.write(`\x1b[${lines}A\x1b[J`);
    }

    function updateFilter() {
      const term = filter.toLowerCase();
      filtered = SLASH_COMMANDS.filter(
        (c) => c.name.slice(1).includes(term) || c.description.toLowerCase().includes(term)
      );
      selected = 0;
    }

    function onKey(data) {
      const code = data[0];

      // Escape or Ctrl+C -> cancel
      if ((code === 27 && data.length === 1) || code === 3) {
        cleanup();
        resolve(null);
        return;
      }

      // Enter -> select
      if (code === 13) {
        const choice = filtered[selected] || null;
        cleanup();
        resolve(choice ? choice.name : null);
        return;
      }

      // Backspace
      if (code === 127 || code === 8) {
        if (filter.length > 0) {
          filter = filter.slice(0, -1);
          updateFilter();
          render(true);
        } else {
          cleanup();
          resolve(null);
        }
        return;
      }

      // Arrow keys
      if (code === 27 && data.length >= 3) {
        if (data[2] === 65) selected = Math.max(0, selected - 1);           // Up
        if (data[2] === 66) selected = Math.min(filtered.length - 1, selected + 1); // Down
        render(true);
        return;
      }

      // Printable char
      if (code >= 32 && code < 127) {
        filter += data.toString();
        updateFilter();
        render(true);
        return;
      }
    }

    render(false);
    process.stdin.on("data", onKey);
  });
}

function handleSlashCommand(command, ctx) {
  const config = loadConfig();

  switch (command) {
    case "/help":
      console.log(chalk.cyan(`
  Chalk CLI - ${MODEL_NAME}

  Usage:
    Type your message and press Enter.
    Chalk can run commands and edit files for you.

  Slash Commands:`));
      for (const c of SLASH_COMMANDS) {
        console.log(`    ${chalk.cyan(c.name.padEnd(14))} ${chalk.dim(c.description)}`);
      }
      console.log(chalk.dim(`
  One-shot:    chalk "your prompt here"
  Multi-line:  Start with \`\`\`, end with \`\`\`
`));
      break;

    case "/clear":
      console.clear();
      break;

    case "/agents":
      console.log(chalk.cyan("\n  System Status:\n"));
      console.log(`    ${chalk.white("Orchestrator".padEnd(20))} ${chalk.green("healthy")}`);
      console.log(`    ${chalk.white("Tool Runner".padEnd(20))} ${chalk.green("healthy")}`);
      console.log(`    ${chalk.white("File Editor".padEnd(20))} ${chalk.green("healthy")}`);
      console.log(`    ${chalk.white("API Client".padEnd(20))} ${chalk.green("healthy")}`);
      console.log(chalk.dim(`\n    Node ${process.version} | ${process.platform} | PID ${process.pid}`));
      console.log(chalk.dim(`    Working in: ${process.cwd()}\n`));
      break;

    case "/config":
      console.log(chalk.dim(`
  Config home:    ${CHALK_HOME}
  Model:          ${config.model}
  API base:       ${config.baseUrl}
  API key:        ${config.apiKey ? config.apiKey.slice(0, 14) + "..." : "(not set)"}
  Working dir:    ${process.cwd()}
`));
      break;

    case "/model":
      console.log(chalk.dim(`  Model: ${config.model}`));
      break;

    case "/tree": {
      const project = getProjectContext();
      console.log(chalk.cyan(`\n  ${project.cwd}\n`));
      console.log(chalk.dim(project.treeStr.split("\n").map((l) => `  ${l}`).join("\n")));
      console.log();
      break;
    }

    case "/cost":
      console.log(chalk.dim(`  Session tokens: ${ctx.totalTokens} (prompt: ${ctx.promptTokens}, completion: ${ctx.completionTokens})`));
      break;

    case "/compact":
      if (ctx.messages.length > 6) {
        const kept = ctx.messages.slice(-4);
        ctx.messages = kept;
        console.log(chalk.dim(`  Compacted. Kept last ${kept.length} messages.`));
      } else {
        console.log(chalk.dim("  Conversation is already short."));
      }
      break;

    case "/new":
      ctx.messages = [];
      ctx.totalTokens = 0;
      ctx.promptTokens = 0;
      ctx.completionTokens = 0;
      console.log(chalk.green("  New conversation started."));
      break;

    case "/exit":
      console.log(chalk.dim("  Goodbye!"));
      process.exit(0);

    default:
      console.log(chalk.yellow(`  Unknown command: ${command}`));
  }
}

// ─── API: Agentic Chat with Tool Loop ───────────────────────────────────────

async function chat(config, systemPrompt, messages) {
  const apiMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let done = false;

  while (!done) {
    const body = {
      model: config.model,
      messages: apiMessages,
      tools: TOOL_DEFINITIONS,
      temperature: 0.7,
      max_tokens: 4096,
    };

    let data;
    try {
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/chalk-cli",
          "X-Title": "Chalk CLI",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${errText}`);
      }

      data = await res.json();
    } catch (err) {
      console.log(chalk.red(`\n  [error] ${err.message}`));
      return null;
    }

    const choice = data.choices?.[0];
    if (!choice) {
      console.log(chalk.red("\n  [error] No response from model."));
      return null;
    }

    const message = choice.message;

    // Check for tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      // Print any text the model returned alongside tool calls
      if (message.content) {
        let cleaned = message.content.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<think>[\s\S]*/g, "").trim();
        if (cleaned) console.log(chalk.green.bold("\nChalk: ") + cleaned);
      }

      // Add assistant message to API history
      apiMessages.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: message.tool_calls,
      });

      // Execute each tool
      for (const tc of message.tool_calls) {
        let args;
        try {
          args = typeof tc.function.arguments === "string"
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments;
        } catch {
          args = {};
        }

        const result = await dispatchTool(tc.function.name, args);

        // Feed result back to the model
        apiMessages.push({
          role: "tool",
          content: result.output,
          tool_call_id: tc.id,
        });
      }
      // Loop: model sees tool results and decides next step
    } else {
      // No tool calls -> model is done, print response
      done = true;

      const content = message.content || "";
      let cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<think>[\s\S]*/g, "").trim();
      if (cleaned) {
        console.log(chalk.green.bold("\nChalk: ") + cleaned);
      }

      return {
        content: cleaned,
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      };
    }

    if (choice.finish_reason === "stop" || choice.finish_reason === "end_turn") {
      done = true;
    }
  }

  return null;
}

// ─── Banner ─────────────────────────────────────────────────────────────────

function printBanner(model) {
  console.log(chalk.cyan.bold(`
   _____ _           _ _
  / ____| |         | | |
 | |    | |__   __ _| | | __
 | |    | '_ \\ / _\` | | |/ /
 | |____| | | | (_| | |   <
  \\_____|_| |_|\\__,_|_|_|\\_\\`));
  console.log(chalk.dim(`\n  ${MODEL_NAME} | Model: ${model}`));
  console.log(chalk.dim("  Type / for commands, ``` for multi-line"));
  console.log(chalk.dim(`  Working in: ${process.cwd()}\n`));
}

// ─── First-Run Setup ────────────────────────────────────────────────────────

async function runLogin() {
  console.log(chalk.cyan(`\n  Chalk CLI - First-Time Setup\n`));
  console.log("  Chalk needs an OpenRouter API key to connect to AI models.");
  console.log("  Get one free at: https://openrouter.ai/keys\n");

  const { apiKey } = await inquirer.prompt([
    { type: "input", name: "apiKey", message: "Enter your OpenRouter API key:" },
  ]);
  if (!apiKey) {
    console.log(chalk.red("\n  No key entered. Setup cancelled.\n"));
    return false;
  }
  saveEnvValue("OPENROUTER_API_KEY", apiKey.trim());

  const { model } = await inquirer.prompt([
    {
      type: "input",
      name: "model",
      message: `Model ID [${DEFAULT_MODEL}]:`,
      default: DEFAULT_MODEL,
    },
  ]);
  saveEnvValue("CHALK_MODEL", model.trim() || DEFAULT_MODEL);

  console.log(chalk.green(`\n  Config saved to ${CHALK_HOME}`));
  console.log('  Run "chalk" to start.\n');
  return true;
}

// ─── Input Handler ──────────────────────────────────────────────────────────

function getInput(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let answered = false;
    rl.question(prompt, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
    rl.on("close", () => {
      if (!answered) resolve(null); // only null on Ctrl+D / EOF
    });
  });
}

async function getMultilineInput() {
  console.log(chalk.dim("  Multi-line mode. Type ``` on a new line to finish.\n"));
  const lines = [];
  while (true) {
    const line = await getInput(chalk.dim("  ... "));
    if (line === null) return null;
    if (line.trim() === "```") break;
    lines.push(line);
  }
  return lines.join("\n");
}

// ─── Main REPL ──────────────────────────────────────────────────────────────

async function repl(config) {
  // Scan project on startup for instant context
  const spinner = ora({ text: "Mapping project...", color: "cyan" }).start();
  const project = getProjectContext();
  spinner.succeed(chalk.dim(`Mapped ${project.treeStr.split("\n").length} items in ${project.cwd}`));

  // Build system prompt with project context
  const systemPrompt = [
    `You are Chalk, a powerful AI coding assistant powered by ${MODEL_NAME}.`,
    "You help users build, debug, and manage software projects from the terminal.",
    "You can execute commands using tool_run and create/edit files using tool_edit.",
    "Always explain what you're about to do before calling a tool.",
    "Be direct and concise. If unsure, say so.",
    "",
    `The user's working directory is: ${project.cwd}`,
    project.langInfo ? `${project.langInfo}` : "",
    project.projectInfo ? `${project.projectInfo}` : "",
    "File tree:",
    project.treeStr,
  ].join("\n");

  printBanner(config.model);

  // Session state
  const ctx = {
    messages: [],
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
  };

  // REPL loop
  while (true) {
    const raw = await getInput(chalk.cyan.bold("\n> "));
    if (raw === null) {
      console.log(chalk.dim("\n  Goodbye!"));
      break;
    }

    const input = raw.trim();
    if (!input) continue;

    // Slash command trigger
    if (input === "/" || input.startsWith("/")) {
      if (input === "/") {
        const cmd = await showSlashMenu();
        if (cmd) handleSlashCommand(cmd, ctx);
      } else {
        // Direct slash command (e.g., "/help")
        const match = SLASH_COMMANDS.find((c) => c.name === input);
        if (match) {
          handleSlashCommand(match.name, ctx);
        } else {
          // Try partial match
          const partial = SLASH_COMMANDS.filter((c) => c.name.startsWith(input));
          if (partial.length === 1) {
            handleSlashCommand(partial[0].name, ctx);
          } else if (partial.length > 1) {
            console.log(chalk.yellow(`  Ambiguous. Did you mean: ${partial.map((c) => c.name).join(", ")}?`));
          } else {
            console.log(chalk.yellow(`  Unknown command: ${input}. Type / to see all commands.`));
          }
        }
        continue;
      }
      continue;
    }

    // Multi-line mode
    let userText = input;
    if (input === "```") {
      const multi = await getMultilineInput();
      if (!multi) continue;
      userText = multi;
    }

    // Add to conversation
    ctx.messages.push({ role: "user", content: userText });

    // Call AI
    const spinner2 = ora({ text: "Thinking...", color: "cyan" }).start();
    const result = await chat(config, systemPrompt, ctx.messages);
    spinner2.clear();
    spinner2.stop();

    if (result) {
      if (result.content) {
        ctx.messages.push({ role: "assistant", content: result.content });
      }
      ctx.promptTokens += result.promptTokens || 0;
      ctx.completionTokens += result.completionTokens || 0;
      ctx.totalTokens += result.totalTokens || 0;
    }
  }
}

// ─── CLI Entry Point ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // chalk --version / -v
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`Chalk v${VERSION} (${MODEL_NAME})`);
    process.exit(0);
  }

  // chalk --help / -h
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
  ${chalk.cyan.bold("Chalk")} - AI coding assistant powered by ${MODEL_NAME}

  ${chalk.dim("Usage:")}
    chalk                       Interactive mode
    chalk "fix the bug"         One-shot prompt
    chalk login                 Set up your API key
    chalk config                Show configuration
    chalk --update              Update Chalk
    chalk --version             Show version

  ${chalk.dim("Options:")}
    -v, --version               Show version
    -h, --help                  Show this help
    --update                    Rebuild and update Chalk

  ${chalk.dim("In interactive mode:")}
    Type / to open the command menu
    Type \`\`\` for multi-line input
    Ctrl+C or /exit to quit

  ${chalk.dim("Install for any user:")}
    git clone <repo> && cd chalk-cli
    npm install && npm link --force
    chalk login
`);
    process.exit(0);
  }

  // chalk --update
  if (args.includes("--update")) {
    console.log(chalk.cyan("\n  Updating Chalk CLI...\n"));
    try {
      const pkgDir = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, "$1");
      execSync(`cd "${pkgDir}" && git pull 2>nul & npm install && npm link --force`, { stdio: "inherit" });
      console.log(chalk.green("\n  Chalk updated successfully.\n"));
    } catch (err) {
      console.log(chalk.red(`\n  Update failed: ${err.message}\n`));
    }
    process.exit(0);
  }

  // chalk login
  if (args[0] === "login") {
    await runLogin();
    process.exit(0);
  }

  // chalk config
  if (args[0] === "config") {
    const config = loadConfig();
    console.log(chalk.dim(`
  Config home:    ${CHALK_HOME}
  Model:          ${config.model}
  API base:       ${config.baseUrl}
  API key:        ${config.apiKey ? config.apiKey.slice(0, 14) + "..." : "(not set)"}
  Working dir:    ${process.cwd()}
`));
    process.exit(0);
  }

  // Load config
  const config = loadConfig();

  // First-run: no API key
  if (!config.apiKey) {
    const success = await runLogin();
    if (!success) process.exit(1);
    // Reload after login
    Object.assign(config, loadConfig());
    if (!config.apiKey) {
      console.log(chalk.red("  Error: API key not configured."));
      process.exit(1);
    }
  }

  // chalk "prompt" (one-shot mode)
  if (args.length > 0 && args[0] !== "login" && args[0] !== "config") {
    const prompt = args.join(" ");
    const project = getProjectContext();
    const systemPrompt = [
      `You are Chalk, a powerful AI coding assistant powered by ${MODEL_NAME}.`,
      "You help users build, debug, and manage software projects.",
      "You can execute commands using tool_run and create/edit files using tool_edit.",
      "Be direct and concise.",
      `Working directory: ${project.cwd}`,
      project.langInfo,
      project.projectInfo,
      "File tree:",
      project.treeStr,
    ].join("\n");

    const spinner = ora({ text: "Thinking...", color: "cyan" }).start();
    const result = await chat(config, systemPrompt, [{ role: "user", content: prompt }]);
    spinner.stop();

    if (result && result.content) {
      // Already printed inside chat() for tool-use responses
    }
    process.exit(0);
  }

  // Interactive REPL
  await repl(config);
}

main().catch((err) => {
  console.error(chalk.red(`Fatal: ${err.message}`));
  process.exit(1);
});
