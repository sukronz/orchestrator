# 🎛️ Orchestrator — Build Your AI Coding Team Inside VS Code

> **Turn three competing AI models into one coordinated engineering squad.**

Orchestrator is a VS Code extension that lets you assemble a team of AI sub-agents — backed by **Claude**, **GPT-4.1**, and **Gemini 2.5 Pro** — assign them specialized skills, and run multi-stage, closed-loop workflows that mirror how real engineering teams ship code: architect → plan → implement → review → debug → sign off.

No copy-pasting between chat windows. No juggling tabs. One control panel, one workflow, real file changes applied to your workspace.

---

## ✨ Why This Is Exciting

| Pain Point | What Orchestrator Does |
|---|---|
| Switching between AI chats to get different perspectives | Compose a **multi-provider team** in one panel — Claude for architecture, GPT for implementation, Gemini for review, or any mix you like |
| AI gives you code, you paste it manually | Agents emit structured **change-sets** that are automatically applied to your workspace files |
| No quality gate on AI output | A built-in **8-stage handoff pipeline** runs architect → planner → developer → reviewer → debugger → refinement → final review → sign-off |
| Every prompt starts from scratch | **Skills** act as reusable instruction templates you attach to agents — architect skills, planner skills, reviewer skills, etc. |
| Agents don't know what each other said | Each handoff stage passes its output as context to the **next stage**, creating a continuous chain of reasoning |

### The Big Idea

Most AI coding tools give you **one model, one conversation**. Orchestrator gives you a **team** — each agent has a role, a provider, and skills — and they collaborate through a structured pipeline just like real engineers on a pull request.

---

## 🚀 Features

### 🔑 Multi-Provider Support
Connect your API keys for **OpenAI (GPT-4.1)**, **Anthropic (Claude 3.7 Sonnet)**, and **Google (Gemini 2.5 Pro)**. Keys are stored securely in VS Code's secret storage — never on disk.

### 🧠 Skill System
Define reusable skill cards with a **name**, **category**, **description**, and **instructions**. Categories map to workflow stages:

- **Architect** — System design, constraints, interfaces
- **Planner** — Task breakdown, sequencing, dependencies
- **Developer** — Implementation and code generation
- **Reviewer** — Correctness, regressions, test coverage
- **Debugger** — Root cause analysis and stabilization
- **Custom** — Anything else you need

One-click **"Add Recommended Skills"** seeds a proven starter set.

### 🤖 Sub-Agent Creation
Create named agents, pick their backing LLM provider, describe their function, and attach skills. Examples:
- *"Claude Architect"* — Claude-backed, with Architect + Planner skills
- *"GPT Coder"* — GPT-backed, with Developer skills
- *"Gemini Reviewer"* — Gemini-backed, with Reviewer + Debugger skills

### 💬 Live Agent Chat
Send messages to any sub-agent and get real responses from the backing LLM. If the agent proposes code changes, they're **automatically parsed and applied** to your workspace via the structured `<orchestrator-change-set>` protocol.

### 📋 Task Tracking
Create and track tasks per agent. Tasks auto-generate when agents apply file changes, giving you an audit trail of everything that was modified.

### 🔄 Closed-Loop Handoff Execution
The headline feature. Enter a problem statement and Orchestrator runs an **8-stage pipeline**:

```
1. Architecture framing        → Architect agent
2. Execution planning          → Planner agent
3. Implementation pass         → Developer agent
4. Review pass                 → Reviewer agent
5. Bug fixing                  → Debugger agent
6. Refinement pass             → Developer agent
7. Final review                → Reviewer agent
8. Architecture sign-off       → Architect agent
```

Each stage is automatically routed to the best-matching agent based on skills. Output from each stage flows as context into the next. File changes are applied in real-time. Chat history and tasks are logged per agent.

### 🛡️ Safe Workspace Execution
- File changes are **sandboxed** to the current workspace folder — path traversal is blocked
- Validation commands are whitelisted (`npm run lint`, `npm run compile`, `npm test`) — arbitrary commands are rejected
- All edits go through VS Code's `WorkspaceEdit` API for undo support

---

## 📦 Getting Started

### Prerequisites
- VS Code **1.110.0** or later
- At least one API key: [OpenAI](https://platform.openai.com/api-keys), [Anthropic](https://console.anthropic.com/), or [Google AI Studio](https://aistudio.google.com/apikey)

### Install & Run

```bash
# Clone the repo
git clone https://github.com/your-username/orchestrator.git
cd orchestrator

# Install dependencies
npm install

# Compile
npm run compile

# Launch in VS Code Extension Development Host
# Press F5 in VS Code, or run:
code --extensionDevelopmentPath=.
```

### Quick Start

1. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run **"Open Orchestrator Control Panel"**
3. Paste your API key(s) in the **Provider Settings** section
4. Click **"Add Recommended Skills"** to seed the skill library
5. Create sub-agents and assign skills
6. Try **Live Chat** with a single agent, or enter a problem statement under **Closed-Loop Handoff** to run the full pipeline

---

## 🏗️ Architecture

```
src/
├── extension.ts              # VS Code activation, webview panel, UI rendering, message handling
├── core/
│   ├── types.ts              # TypeScript type definitions for agents, skills, tasks, workflows
│   └── orchestrator.ts       # Runtime: chat execution, stage execution, change-set application
├── providers/
│   └── index.ts              # ProviderRegistry: OpenAI, Anthropic, Gemini API integrations
├── runtime/
│   └── workspaceExecutor.ts  # File change application, path sandboxing, command validation
└── test/                     # Test suite
```

### Data Flow

```
User Input → OrchestratorPanel (webview)
           → OrchestratorRuntime
           → ProviderRegistry.generate() → LLM API call
           → Response with optional <orchestrator-change-set>
           → WorkspaceExecutor.applyChangeSet()
           → Files updated in workspace + chat/task state persisted
```

---

## 🛠️ Development

```bash
npm run compile          # One-time build
npm run watch            # Rebuild on changes
npm run lint             # Run ESLint
npm test                 # Run test suite
npm run package          # Production build
```

---

## 📝 License

This project is open source. See the repository for license details.

---

<p align="center">
  <em>Stop chatting with one AI. Start managing a team of them.</em>
</p>
