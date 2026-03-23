import * as vscode from 'vscode';
import { OrchestratorRuntime, findBestAgentForCategory } from './core/orchestrator';
import {
	AgentDefinition,
	AgentTask,
	ChatMessage,
	HandoffRun,
	ProviderId,
	SkillCategory,
	SkillDefinition,
	TaskStatus,
	WorkflowStage,
} from './core/types';
import { ProviderRegistry } from './providers';
import { WorkspaceExecutor } from './runtime/workspaceExecutor';

const SECRET_KEYS: Record<ProviderId, string> = {
	copilot: 'orchestrator.copilotApiKey',
	claude: 'orchestrator.claudeApiKey',
	gemini: 'orchestrator.geminiApiKey',
};

const PROVIDER_LABELS: Record<ProviderId, string> = {
	copilot: 'GPT / OpenAI',
	claude: 'Claude',
	gemini: 'Gemini',
};

const SKILL_CATEGORY_LABELS: Record<SkillCategory, string> = {
	architect: 'Architect',
	planner: 'Planner',
	developer: 'Developer',
	reviewer: 'Reviewer',
	debugger: 'Debugger',
	custom: 'Custom',
};

const AGENTS_STATE_KEY = 'orchestrator.subAgents';
const SKILLS_STATE_KEY = 'orchestrator.skills';
const CHAT_STATE_KEY = 'orchestrator.chatMessages';
const TASKS_STATE_KEY = 'orchestrator.tasks';
const ACTIVE_AGENT_STATE_KEY = 'orchestrator.activeAgentId';
const HANDOFF_RUN_STATE_KEY = 'orchestrator.lastHandoffRun';

export function activate(context: vscode.ExtensionContext) {
	const runtime = new OrchestratorRuntime(new ProviderRegistry(context), new WorkspaceExecutor());

	const disposable = vscode.commands.registerCommand('orchestrator.openControlPanel', () => {
		OrchestratorPanel.createOrShow(context, runtime);
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}

class OrchestratorPanel {
	private static currentPanel: OrchestratorPanel | undefined;

	public static createOrShow(context: vscode.ExtensionContext, runtime: OrchestratorRuntime) {
		if (OrchestratorPanel.currentPanel) {
			OrchestratorPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
			void OrchestratorPanel.currentPanel.refresh();
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'orchestrator.controlPanel',
			'Orchestrator Control Panel',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
			}
		);

		OrchestratorPanel.currentPanel = new OrchestratorPanel(panel, context, runtime);
	}

	private readonly panel: vscode.WebviewPanel;
	private readonly context: vscode.ExtensionContext;
	private readonly runtime: OrchestratorRuntime;

	private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, runtime: OrchestratorRuntime) {
		this.panel = panel;
		this.context = context;
		this.runtime = runtime;

		this.panel.onDidDispose(() => {
			OrchestratorPanel.currentPanel = undefined;
		});

		this.panel.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'saveApiKeys':
					await this.saveApiKeys(message.payload);
					return;
				case 'createSkill':
					await this.createSkill(message.payload);
					return;
				case 'seedDefaultSkills':
					await this.seedDefaultSkills();
					return;
				case 'createAgent':
					await this.createAgent(message.payload);
					return;
				case 'updateAgentSkills':
					await this.updateAgentSkills(message.payload);
					return;
				case 'deleteAgent':
					await this.deleteAgent(message.payload?.id);
					return;
				case 'sendChatMessage':
					await this.sendChatMessage(message.payload);
					return;
				case 'createTask':
					await this.createTask(message.payload);
					return;
				case 'updateTaskStatus':
					await this.updateTaskStatus(message.payload);
					return;
				case 'setActiveAgent':
					await this.setActiveAgent(message.payload?.agentId);
					return;
				case 'runHandoff':
					await this.runHandoff(message.payload);
					return;
				default:
					return;
			}
		});

		void this.refresh();
	}

	private async refresh() {
		this.panel.webview.html = await this.getHtml();
	}

	private async getHtml() {
		const nonce = getNonce();
		const apiKeyStatus = await this.getApiKeyStatus();
		const skills = this.getSkills();
		const agents = this.getAgents();
		const selectedAgentId = this.getSelectedAgentId(agents);
		const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
		const chatMessages = selectedAgentId ? this.getMessagesForAgent(selectedAgentId) : [];
		const tasks = selectedAgentId ? this.getTasksForAgent(selectedAgentId) : [];
		const lastRun = this.getLastHandoffRun();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Orchestrator Control Panel</title>
	<style>
		:root {
			color-scheme: light dark;
			--panel: #16213a;
			--panel-soft: #1b2945;
			--border: rgba(255,255,255,0.09);
			--text: #edf3ff;
			--muted: #a8b7d1;
			--accent: #74d1ff;
			--accent-strong: #2f9fd2;
			--success: #8fedba;
			--warning: #ffd580;
			--danger: #ff9a9a;
		}
		* { box-sizing: border-box; }
		body {
			margin: 0;
			padding: 24px;
			font-family: var(--vscode-font-family, sans-serif);
			background:
				radial-gradient(circle at top right, rgba(116, 209, 255, 0.18), transparent 28%),
				linear-gradient(180deg, #0f1627 0%, #0b1019 100%);
			color: var(--text);
		}
		main { max-width: 1080px; margin: 0 auto; display: grid; gap: 20px; }
		.hero, .card {
			padding: 20px;
			border-radius: 18px;
			border: 1px solid var(--border);
			background: var(--panel);
			box-shadow: 0 18px 44px rgba(0,0,0,0.18);
		}
		.hero { background: linear-gradient(135deg, rgba(116, 209, 255, 0.14), rgba(255,255,255,0.03)); }
		h1, h2, h3, p { margin-top: 0; }
		p, .helper, .agent-meta, .status { color: var(--muted); }
		.grid, .two-column { display: grid; gap: 20px; }
		.grid { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
		.two-column { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
		form { display: grid; gap: 14px; }
		label { display: grid; gap: 8px; font-weight: 600; }
		input, select, textarea, button { font: inherit; }
		input, select, textarea {
			width: 100%;
			padding: 11px 12px;
			border-radius: 12px;
			border: 1px solid rgba(255,255,255,0.12);
			background: var(--panel-soft);
			color: var(--text);
		}
		textarea { min-height: 110px; resize: vertical; }
		button {
			border: 0; border-radius: 999px; padding: 11px 16px; cursor: pointer;
			background: linear-gradient(135deg, var(--accent), var(--accent-strong));
			color: #081019; font-weight: 700;
		}
		button.secondary { background: rgba(255,255,255,0.08); color: var(--text); }
		.toolbar, .badge-row { display: flex; flex-wrap: wrap; gap: 10px; }
		.list, .scroll-pane { display: grid; gap: 10px; }
		.scroll-pane { max-height: 340px; overflow-y: auto; padding-right: 4px; }
		.item, .empty {
			padding: 14px; border-radius: 14px; border: 1px solid var(--border);
			background: rgba(255,255,255,0.03);
		}
		.empty { border-style: dashed; text-align: center; color: var(--muted); }
		.badge {
			display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px;
			background: rgba(116,209,255,0.14); color: var(--accent); font-size: 12px; font-weight: 700;
			text-transform: uppercase;
		}
		.badge.warning { background: rgba(255,213,128,0.16); color: var(--warning); }
		.success { color: var(--success); }
		.message.user { background: rgba(116, 209, 255, 0.12); }
		.message.assistant { background: rgba(143, 237, 186, 0.08); }
		.check-grid { display: grid; gap: 8px; }
		.check-item { display: flex; gap: 10px; align-items: start; padding: 10px; border-radius: 12px; background: rgba(255,255,255,0.03); }
		.check-item input { width: auto; margin-top: 4px; }
		.rule { padding: 12px; border-radius: 12px; background: rgba(255,255,255,0.04); }
		.stage-card, .agent-card, .task-row { display: grid; gap: 10px; }
		.stage-header, .agent-header { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
		.task-row { grid-template-columns: 1fr auto; align-items: center; }
		.task-row form { display: flex; gap: 8px; align-items: center; }
	</style>
</head>
<body>
	<main>
		<section class="hero">
			<h1>Build your coding partner team</h1>
			<p>Secure the keys, define skills, attach them to agents, then run live provider-backed chat and handoff execution.</p>
			<div class="rule">
				<strong>Execution flow</strong>
				<div class="helper">Planner builds the backlog and to-do flow first, architect refines the technical design, then developer, reviewer, and debugger work like an agile delivery team before final sign-off.</div>
			</div>
		</section>

		<section class="grid">
			<div class="card">
				<h2>Provider Settings</h2>
				<div class="list">
					${renderKeyStatus('GPT / OpenAI', apiKeyStatus.copilot)}
					${renderKeyStatus('Claude / Anthropic', apiKeyStatus.claude)}
					${renderKeyStatus('Gemini', apiKeyStatus.gemini)}
				</div>
				<form id="keys-form">
					<label>GPT / OpenAI key<input type="password" id="copilotKey" placeholder="Saved securely in VS Code secret storage"></label>
					<label>Gemini API key<input type="password" id="geminiKey" placeholder="Saved securely in VS Code secret storage"></label>
					<label>Claude Anthropic key<input type="password" id="claudeKey" placeholder="Saved securely in VS Code secret storage"></label>
					<button type="submit">Save Provider Keys</button>
				</form>
			</div>

			<div class="card">
				<h2>Skills</h2>
				<form id="skill-form">
					<label>Skill name<input type="text" id="skillName" required></label>
					<label>Category<select id="skillCategory">${renderSkillCategoryOptions()}</select></label>
					<label>Description<input type="text" id="skillDescription" required></label>
					<label>Instructions<textarea id="skillInstructions" required></textarea></label>
					<div class="toolbar">
						<button type="submit">Create Skill</button>
						<button type="button" class="secondary" id="seed-skills">Add Recommended Skills</button>
					</div>
				</form>
				<div class="scroll-pane">
					${skills.length === 0 ? '<div class="empty">No skills created yet.</div>' : `
						<div class="list">
							${skills.map((skill) => `<div class="item"><strong>${escapeHtml(skill.name)}</strong><div class="badge-row"><span class="badge">${SKILL_CATEGORY_LABELS[skill.category]}</span></div><div>${escapeHtml(skill.description)}</div><div class="helper">${escapeHtml(skill.instructions)}</div></div>`).join('')}
						</div>
					`}
				</div>
			</div>
		</section>

		<section class="grid">
			<div class="card">
				<h2>Create Sub-Agent</h2>
				<form id="agent-form">
					<label>Coding partner<select id="provider"><option value="claude">Claude</option><option value="copilot">GPT / OpenAI</option><option value="gemini">Gemini</option></select></label>
					<label>Agent name<input type="text" id="agentName" required></label>
					<label>Agent function<textarea id="agentRole" required></textarea></label>
					<label>Attach skills
						<div class="check-grid">
							${skills.length === 0 ? '<div class="empty">Create skills first.</div>' : skills.map((skill) => renderSkillCheckbox(skill, 'agent-skill')).join('')}
						</div>
					</label>
					<button type="submit">Create Sub-Agent</button>
				</form>
			</div>

			<div class="card">
				<h2>Saved Sub-Agents</h2>
				${agents.length === 0 ? '<div class="empty">No sub-agents created yet.</div>' : `
					<div class="list">
						${agents.map((agent) => `
							<div class="item agent-card">
								<div class="agent-header">
									<div><strong>${escapeHtml(agent.name)}</strong><div class="agent-meta">${PROVIDER_LABELS[agent.provider]}</div></div>
									<span class="badge">${PROVIDER_LABELS[agent.provider]}</span>
								</div>
								<div>${escapeHtml(agent.role)}</div>
								<div class="badge-row">${this.getSkillNames(agent.skillIds, skills).map((name) => `<span class="badge">${escapeHtml(name)}</span>`).join('') || '<span class="helper">No skills attached</span>'}</div>
								<button class="secondary delete-agent" data-agent-id="${agent.id}" type="button">Delete</button>
							</div>
						`).join('')}
					</div>
				`}
			</div>
		</section>

		<section class="card">
			<h2>Active Agent Workspace</h2>
			${agents.length === 0 ? '<div class="empty">Create a sub-agent first.</div>' : `
				<div class="toolbar">
					<label style="flex:1 1 260px;">Active sub-agent
						<select id="activeAgent">${agents.map((agent) => `<option value="${agent.id}" ${agent.id === selectedAgentId ? 'selected' : ''}>${escapeHtml(agent.name)} • ${PROVIDER_LABELS[agent.provider]}</option>`).join('')}</select>
					</label>
				</div>
				<div class="two-column">
					<div>
						<h3>Chat</h3>
						<div class="scroll-pane">
							${chatMessages.length === 0 ? '<div class="empty">No chat messages yet.</div>' : `<div class="list">${chatMessages.map((message) => `<div class="item message ${message.author}"><strong>${message.author === 'user' ? 'You' : message.author === 'assistant' ? escapeHtml(selectedAgent?.name ?? 'Assistant') : 'System'}</strong><div>${escapeHtml(message.text)}</div><div class="agent-meta">${new Date(message.createdAt).toLocaleString()}</div></div>`).join('')}</div>`}
						</div>
						<form id="chat-form">
							<label>Message<textarea id="chatMessage" required></textarea></label>
							<button type="submit">Send To LLM</button>
						</form>
					</div>
					<div>
						<h3>Tasks</h3>
						<div class="scroll-pane">
							${tasks.length === 0 ? '<div class="empty">No tasks yet.</div>' : `<div class="list">${tasks.map((task) => `<div class="item task-row"><div><strong>${escapeHtml(task.title)}</strong><div class="agent-meta">Updated ${new Date(task.updatedAt).toLocaleString()}</div></div><form class="task-status-form" data-task-id="${task.id}"><select name="status"><option value="todo" ${task.status === 'todo' ? 'selected' : ''}>To do</option><option value="inProgress" ${task.status === 'inProgress' ? 'selected' : ''}>In progress</option><option value="done" ${task.status === 'done' ? 'selected' : ''}>Done</option></select><button type="submit" class="secondary">Update</button></form></div>`).join('')}</div>`}
						</div>
						<form id="task-form">
							<label>Add task<input type="text" id="taskTitle" required></label>
							<button type="submit">Create Task</button>
						</form>
					</div>
				</div>
				<div class="card" style="margin-top:20px;">
					<h3>Attached Skills</h3>
					<form id="agent-skills-form">
						<div class="check-grid">
							${skills.length === 0 ? '<div class="empty">No skills available yet.</div>' : skills.map((skill) => renderSkillCheckbox(skill, 'workspace-skill', selectedAgent?.skillIds.includes(skill.id) ?? false)).join('')}
						</div>
						<button type="submit">Update Agent Skills</button>
					</form>
				</div>
			`}
		</section>

		<section class="card">
			<h2>Closed-Loop Handoff</h2>
			<form id="handoff-form">
				<label>Problem statement<textarea id="problemStatement" required></textarea></label>
				<button type="submit">Run Live Handoff</button>
			</form>
			${!lastRun ? '<div class="empty" style="margin-top:16px;">No handoff has been run yet.</div>' : `
				<div class="rule" style="margin-top:16px;"><strong>Latest problem statement</strong><div>${escapeHtml(lastRun.problemStatement)}</div><div class="agent-meta">Generated ${new Date(lastRun.createdAt).toLocaleString()}</div></div>
				<div class="list" style="margin-top:16px;">
					${lastRun.stages.map((stage) => `
						<div class="item stage-card">
							<div class="stage-header">
								<div><strong>${escapeHtml(stage.label)}</strong><div class="agent-meta">${escapeHtml(stage.ownerName)}</div></div>
								<span class="badge ${stage.status === 'needs-agent' || stage.status === 'failed' ? 'warning' : ''}">${escapeHtml(stage.status)}</span>
							</div>
							<div class="badge-row"><span class="badge">${SKILL_CATEGORY_LABELS[stage.category]}</span></div>
							<div>${escapeHtml(stage.instructions)}</div>
							${stage.output ? `<div class="rule"><strong>Output</strong><div>${escapeHtml(stage.output)}</div></div>` : ''}
						</div>
					`).join('')}
				</div>
			`}
		</section>
	</main>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const activeAgentSelect = document.getElementById('activeAgent');

		document.getElementById('keys-form')?.addEventListener('submit', (event) => {
			event.preventDefault();
			vscode.postMessage({ type: 'saveApiKeys', payload: { copilot: document.getElementById('copilotKey').value.trim(), gemini: document.getElementById('geminiKey').value.trim(), claude: document.getElementById('claudeKey').value.trim() } });
		});
		document.getElementById('skill-form')?.addEventListener('submit', (event) => {
			event.preventDefault();
			vscode.postMessage({ type: 'createSkill', payload: { name: document.getElementById('skillName').value.trim(), category: document.getElementById('skillCategory').value, description: document.getElementById('skillDescription').value.trim(), instructions: document.getElementById('skillInstructions').value.trim() } });
		});
		document.getElementById('seed-skills')?.addEventListener('click', () => vscode.postMessage({ type: 'seedDefaultSkills' }));
		document.getElementById('agent-form')?.addEventListener('submit', (event) => {
			event.preventDefault();
			vscode.postMessage({ type: 'createAgent', payload: { provider: document.getElementById('provider').value, name: document.getElementById('agentName').value.trim(), role: document.getElementById('agentRole').value.trim(), skillIds: getCheckedValues('agent-skill') } });
		});
		activeAgentSelect?.addEventListener('change', () => vscode.postMessage({ type: 'setActiveAgent', payload: { agentId: activeAgentSelect.value } }));
		document.getElementById('chat-form')?.addEventListener('submit', (event) => {
			event.preventDefault();
			if (!activeAgentSelect) { return; }
			vscode.postMessage({ type: 'sendChatMessage', payload: { agentId: activeAgentSelect.value, text: document.getElementById('chatMessage').value.trim() } });
		});
		document.getElementById('task-form')?.addEventListener('submit', (event) => {
			event.preventDefault();
			if (!activeAgentSelect) { return; }
			vscode.postMessage({ type: 'createTask', payload: { agentId: activeAgentSelect.value, title: document.getElementById('taskTitle').value.trim() } });
		});
		document.getElementById('agent-skills-form')?.addEventListener('submit', (event) => {
			event.preventDefault();
			if (!activeAgentSelect) { return; }
			vscode.postMessage({ type: 'updateAgentSkills', payload: { agentId: activeAgentSelect.value, skillIds: getCheckedValues('workspace-skill') } });
		});
		document.getElementById('handoff-form')?.addEventListener('submit', (event) => {
			event.preventDefault();
			vscode.postMessage({ type: 'runHandoff', payload: { problemStatement: document.getElementById('problemStatement').value.trim() } });
		});
		document.querySelectorAll('.task-status-form').forEach((form) => {
			form.addEventListener('submit', (event) => {
				event.preventDefault();
				if (!activeAgentSelect) { return; }
				const select = form.querySelector('select[name="status"]');
				vscode.postMessage({ type: 'updateTaskStatus', payload: { agentId: activeAgentSelect.value, taskId: form.dataset.taskId, status: select ? select.value : '' } });
			});
		});
		document.querySelectorAll('.delete-agent').forEach((button) => {
			button.addEventListener('click', () => vscode.postMessage({ type: 'deleteAgent', payload: { id: button.dataset.agentId } }));
		});
		function getCheckedValues(groupName) {
			return Array.from(document.querySelectorAll('input[data-group="' + groupName + '"]:checked')).map((input) => input.value);
		}
	</script>
</body>
</html>`;
	}

	private async saveApiKeys(payload: Partial<Record<ProviderId, string>>) {
		const updates = Object.entries(payload)
			.filter((entry): entry is [ProviderId, string] => isProviderId(entry[0]) && typeof entry[1] === 'string')
			.filter(([, value]) => value.length > 0);
		if (updates.length === 0) {
			void vscode.window.showWarningMessage('Enter at least one API key to save.');
			return;
		}
		await Promise.all(updates.map(([provider, value]) => this.context.secrets.store(SECRET_KEYS[provider], value)));
		void vscode.window.showInformationMessage('Provider keys saved securely.');
		await this.refresh();
	}

	private async createSkill(payload: { name?: string; category?: string; description?: string; instructions?: string }) {
		const category = isSkillCategory(payload.category) ? payload.category : 'custom';
		const name = withDefaultText(payload.name, getDefaultSkillName(category));
		const description = withDefaultText(payload.description, getDefaultSkillDescription(category));
		const instructions = withDefaultText(payload.instructions, getDefaultSkillInstructions(category));
		const nextSkills = [{ id: `skill-${Date.now()}`, name, category, description, instructions, createdAt: new Date().toISOString() }, ...this.getSkills()];
		await this.context.globalState.update(SKILLS_STATE_KEY, nextSkills);
		await this.refresh();
	}

	private async seedDefaultSkills() {
		const existingCategories = new Set(this.getSkills().map((skill) => skill.category));
		const missingSkills = getRecommendedSkills().filter((skill) => !existingCategories.has(skill.category));
		if (missingSkills.length === 0) {
			void vscode.window.showInformationMessage('Recommended skills are already available.');
			return;
		}
		const now = Date.now();
		const seeded = missingSkills.map((skill, index) => ({ ...skill, id: `skill-seed-${now + index}`, createdAt: new Date(now + index).toISOString() }));
		await this.context.globalState.update(SKILLS_STATE_KEY, [...seeded, ...this.getSkills()]);
		await this.refresh();
	}

	private async createAgent(payload: { provider?: string; name?: string; role?: string; skillIds?: string[] }) {
		if (!isProviderId(payload.provider)) {
			void vscode.window.showErrorMessage('Choose a valid coding partner.');
			return;
		}
		const providerKey = await this.context.secrets.get(SECRET_KEYS[payload.provider]);
		if (!providerKey) {
			void vscode.window.showErrorMessage(`Save the ${PROVIDER_LABELS[payload.provider]} API key first.`);
			return;
		}
		const name = payload.name?.trim() ?? '';
		const role = payload.role?.trim() ?? '';
		if (!name || !role) {
			void vscode.window.showErrorMessage('Sub-agent name and function are required.');
			return;
		}
		const nextAgents = [{
			id: `${payload.provider}-${Date.now()}`,
			provider: payload.provider,
			name,
			role,
			skillIds: this.normalizeSkillIds(payload.skillIds),
			createdAt: new Date().toISOString(),
		}, ...this.getAgents()];
		await this.context.globalState.update(AGENTS_STATE_KEY, nextAgents);
		if (!this.context.workspaceState.get<string>(ACTIVE_AGENT_STATE_KEY, '')) {
			await this.context.workspaceState.update(ACTIVE_AGENT_STATE_KEY, nextAgents[0].id);
		}
		await this.refresh();
	}

	private async updateAgentSkills(payload: { agentId?: string; skillIds?: string[] }) {
		const agentId = payload.agentId?.trim() ?? '';
		if (!agentId) {
			return;
		}
		const nextAgents = this.getAgents().map((agent) => agent.id === agentId ? { ...agent, skillIds: this.normalizeSkillIds(payload.skillIds) } : agent);
		await this.context.globalState.update(AGENTS_STATE_KEY, nextAgents);
		await this.refresh();
	}

	private async deleteAgent(id: string | undefined) {
		if (!id) {
			return;
		}
		const nextAgents = this.getAgents().filter((agent) => agent.id !== id);
		await this.context.globalState.update(AGENTS_STATE_KEY, nextAgents);
		await this.context.globalState.update(CHAT_STATE_KEY, this.getChatMessages().filter((message) => message.agentId !== id));
		await this.context.globalState.update(TASKS_STATE_KEY, this.getTasks().filter((task) => task.agentId !== id));
		const currentActiveAgentId = this.context.workspaceState.get<string>(ACTIVE_AGENT_STATE_KEY, '');
		if (currentActiveAgentId === id) {
			await this.context.workspaceState.update(ACTIVE_AGENT_STATE_KEY, nextAgents[0]?.id ?? '');
		}
		await this.refresh();
	}

	private async sendChatMessage(payload: { agentId?: string; text?: string }) {
		const agentId = payload.agentId?.trim() ?? '';
		const text = payload.text?.trim() ?? '';
		const agent = this.getAgents().find((item) => item.id === agentId);
		if (!agent || !text) {
			void vscode.window.showErrorMessage('Choose a valid sub-agent and enter a message.');
			return;
		}

		const now = new Date().toISOString();
		const history = [...this.getChatMessages(), { id: `user-${Date.now()}`, agentId, author: 'user' as const, text, createdAt: now }];
		await this.context.globalState.update(CHAT_STATE_KEY, history);
		await this.refresh();

		try {
			const skills = this.getSkillsForAgent(agent);
			const result = await this.runtime.executeAgentChat({ agent, skills, userMessage: text });
			await this.context.globalState.update(CHAT_STATE_KEY, [...this.getChatMessages(), {
				id: `assistant-${Date.now()}`,
				agentId,
				author: 'assistant',
				text: result.text,
				createdAt: new Date().toISOString(),
			}]);
			if (result.appliedFiles.length > 0) {
				await this.context.globalState.update(TASKS_STATE_KEY, [...this.getTasks(), {
					id: `task-auto-${Date.now()}`,
					agentId,
					title: `Applied changes: ${result.appliedFiles.join(', ')}`,
					status: 'done',
					updatedAt: new Date().toISOString(),
				}]);
			}
		} catch (error) {
			await this.context.globalState.update(CHAT_STATE_KEY, [...this.getChatMessages(), {
				id: `system-${Date.now()}`,
				agentId,
				author: 'system',
				text: error instanceof Error ? error.message : 'Agent execution failed.',
				createdAt: new Date().toISOString(),
			}]);
		}

		await this.refresh();
	}

	private async createTask(payload: { agentId?: string; title?: string }) {
		const agentId = payload.agentId?.trim() ?? '';
		const title = payload.title?.trim() ?? '';
		if (!this.getAgents().some((agent) => agent.id === agentId) || !title) {
			void vscode.window.showErrorMessage('Choose a valid sub-agent and enter a task title.');
			return;
		}
		await this.context.globalState.update(TASKS_STATE_KEY, [{
			id: `task-${Date.now()}`,
			agentId,
			title,
			status: 'todo',
			updatedAt: new Date().toISOString(),
		}, ...this.getTasks()]);
		await this.refresh();
	}

	private async updateTaskStatus(payload: { agentId?: string; taskId?: string; status?: string }) {
		if (!isTaskStatus(payload.status)) {
			return;
		}
		const nextTasks = this.getTasks().map((task) => task.id === payload.taskId && task.agentId === payload.agentId ? { ...task, status: payload.status, updatedAt: new Date().toISOString() } : task);
		await this.context.globalState.update(TASKS_STATE_KEY, nextTasks);
		await this.refresh();
	}

	private async setActiveAgent(agentId: string | undefined) {
		const normalizedAgentId = agentId?.trim() ?? '';
		if (!this.getAgents().some((agent) => agent.id === normalizedAgentId)) {
			return;
		}
		await this.context.workspaceState.update(ACTIVE_AGENT_STATE_KEY, normalizedAgentId);
		await this.refresh();
	}

	private async runHandoff(payload: { problemStatement?: string }) {
		const problemStatement = payload.problemStatement?.trim() ?? '';
		if (!problemStatement) {
			void vscode.window.showErrorMessage('Enter a problem statement first.');
			return;
		}

		const agents = this.getAgents();
		const skills = this.getSkills();
		if (agents.length === 0) {
			void vscode.window.showErrorMessage('Create sub-agents before running the handoff.');
			return;
		}

		const stageDefinitions: Array<{ category: SkillCategory; label: string; instructions: string }> = [
			{
				category: 'planner',
				label: 'Backlog planning',
				instructions: 'Turn the problem statement into an agile backlog: define goals, user-facing outcomes, ordered to-do items, and delivery milestones.',
			},
			{
				category: 'architect',
				label: 'Technical design refinement',
				instructions: 'Review the backlog and turn it into implementation architecture, boundaries, interfaces, and technical constraints for the sprint.',
			},
			{
				category: 'developer',
				label: 'Sprint implementation',
				instructions: 'Implement the current sprint tasks from the backlog. Include an orchestrator change-set block if files should change.',
			},
			{
				category: 'reviewer',
				label: 'Code review',
				instructions: 'Review the implementation like a real delivery team: correctness, regressions, missing tests, edge cases, and maintainability.',
			},
			{
				category: 'debugger',
				label: 'Bug fixing and stabilization',
				instructions: 'Fix issues raised in review or failures discovered during stabilization. Focus on root cause and reliability.',
			},
			{
				category: 'developer',
				label: 'Rework and completion',
				instructions: 'Apply follow-up implementation changes after debugging and complete any backlog items still open for the sprint.',
			},
			{
				category: 'reviewer',
				label: 'Acceptance review',
				instructions: 'Validate the updated implementation against the backlog and confirm it is ready to close the sprint work.',
			},
			{
				category: 'architect',
				label: 'Final technical sign-off',
				instructions: 'Confirm the delivered implementation still matches the intended architecture and technical direction.',
			},
		];

		const stages = stageDefinitions.map((definition, index) => {
			const owner = findBestAgentForCategory(definition.category, agents, skills, SKILL_CATEGORY_LABELS);
			return {
				id: `stage-${Date.now()}-${index}`,
				label: definition.label,
				category: definition.category,
				ownerAgentId: owner?.id ?? '',
				ownerName: owner ? `${owner.name} (${PROVIDER_LABELS[owner.provider]})` : `No ${SKILL_CATEGORY_LABELS[definition.category]} agent configured`,
				status: owner ? 'running' : 'needs-agent',
				instructions: definition.instructions,
			} satisfies WorkflowStage;
		});

		const run: HandoffRun = {
			id: `handoff-${Date.now()}`,
			problemStatement,
			createdAt: new Date().toISOString(),
			stages,
		};
		await this.context.globalState.update(HANDOFF_RUN_STATE_KEY, run);
		await this.refresh();

		let previousOutput = '';
		const completedStages: WorkflowStage[] = [];
		for (const stage of stages) {
			if (!stage.ownerAgentId) {
				completedStages.push(stage);
				continue;
			}

			const agent = agents.find((item) => item.id === stage.ownerAgentId);
			if (!agent) {
				completedStages.push({ ...stage, status: 'failed', output: 'Assigned agent was not found.' });
				continue;
			}

			try {
				const result = await this.runtime.executeStage({
					agent,
					skills: this.getSkillsForAgent(agent),
					stage,
					problemStatement,
					previousOutput,
				});

				const output = result.text;
				previousOutput = output;
				completedStages.push({ ...stage, status: 'completed', output });

				await this.context.globalState.update(CHAT_STATE_KEY, [...this.getChatMessages(), {
					id: `handoff-${Date.now()}-${stage.id}`,
					agentId: agent.id,
					author: 'assistant',
					text: `${stage.label}\n\n${output}`,
					createdAt: new Date().toISOString(),
				}]);

				await this.context.globalState.update(TASKS_STATE_KEY, [...this.getTasks(), {
					id: `handoff-task-${Date.now()}-${stage.id}`,
					agentId: agent.id,
					title: `${stage.label}: ${problemStatement}`,
					status: 'done',
					updatedAt: new Date().toISOString(),
				}]);
			} catch (error) {
				completedStages.push({
					...stage,
					status: 'failed',
					output: error instanceof Error ? error.message : 'Stage execution failed.',
				});
			}

			await this.context.globalState.update(HANDOFF_RUN_STATE_KEY, {
				...run,
				stages: [...completedStages, ...stages.slice(completedStages.length)],
			});
			await this.refresh();
		}

		await this.context.globalState.update(HANDOFF_RUN_STATE_KEY, { ...run, stages: completedStages });
		await this.refresh();
	}

	private async getApiKeyStatus(): Promise<Record<ProviderId, boolean>> {
		const [copilot, claude, gemini] = await Promise.all([
			this.context.secrets.get(SECRET_KEYS.copilot),
			this.context.secrets.get(SECRET_KEYS.claude),
			this.context.secrets.get(SECRET_KEYS.gemini),
		]);
		return { copilot: Boolean(copilot), claude: Boolean(claude), gemini: Boolean(gemini) };
	}

	private getAgents(): AgentDefinition[] {
		const stored = this.context.globalState.get<AgentDefinition[]>(AGENTS_STATE_KEY, []);
		return stored.filter(isAgentDefinition).map((agent) => ({ ...agent, skillIds: Array.isArray(agent.skillIds) ? agent.skillIds : [] }));
	}

	private getSkills(): SkillDefinition[] {
		return this.context.globalState
			.get<SkillDefinition[]>(SKILLS_STATE_KEY, [])
			.map(normalizeSkillDefinition)
			.filter(isSkillDefinition);
	}

	private getSkillsForAgent(agent: AgentDefinition): SkillDefinition[] {
		const skillIds = new Set(agent.skillIds);
		return this.getSkills().filter((skill) => skillIds.has(skill.id));
	}

	private getChatMessages(): ChatMessage[] {
		return this.context.globalState.get<ChatMessage[]>(CHAT_STATE_KEY, []).filter(isChatMessage);
	}

	private getMessagesForAgent(agentId: string): ChatMessage[] {
		return this.getChatMessages().filter((message) => message.agentId === agentId).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	}

	private getTasks(): AgentTask[] {
		return this.context.globalState.get<AgentTask[]>(TASKS_STATE_KEY, []).filter(isAgentTask);
	}

	private getTasksForAgent(agentId: string): AgentTask[] {
		return this.getTasks().filter((task) => task.agentId === agentId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}

	private getLastHandoffRun(): HandoffRun | undefined {
		const run = this.context.globalState.get<HandoffRun | undefined>(HANDOFF_RUN_STATE_KEY);
		return isHandoffRun(run) ? run : undefined;
	}

	private getSelectedAgentId(agents: AgentDefinition[]): string {
		if (agents.length === 0) {
			return '';
		}
		const storedAgentId = this.context.workspaceState.get<string>(ACTIVE_AGENT_STATE_KEY, '');
		return agents.some((agent) => agent.id === storedAgentId) ? storedAgentId : agents[0].id;
	}

	private normalizeSkillIds(skillIds: string[] | undefined): string[] {
		const validSkillIds = new Set(this.getSkills().map((skill) => skill.id));
		return Array.from(new Set((skillIds ?? []).filter((id) => validSkillIds.has(id))));
	}

	private getSkillNames(skillIds: string[], skills: SkillDefinition[]): string[] {
		const byId = new Map(skills.map((skill) => [skill.id, skill.name]));
		return skillIds.map((id) => byId.get(id)).filter((name): name is string => Boolean(name));
	}
}

function renderKeyStatus(label: string, isSaved: boolean): string {
	return `<div class="item"><strong>${label}</strong><div class="status ${isSaved ? 'success' : ''}">${isSaved ? 'API key saved' : 'No API key saved yet'}</div></div>`;
}

function renderSkillCategoryOptions(): string {
	return (Object.entries(SKILL_CATEGORY_LABELS) as Array<[SkillCategory, string]>).map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
}

function renderSkillCheckbox(skill: SkillDefinition, groupName: string, checked = false): string {
	return `<label class="check-item"><input type="checkbox" data-group="${groupName}" value="${skill.id}" ${checked ? 'checked' : ''}><span><strong>${escapeHtml(skill.name)}</strong><div class="helper">${SKILL_CATEGORY_LABELS[skill.category]} • ${escapeHtml(skill.description)}</div></span></label>`;
}

function getRecommendedSkills(): Array<Omit<SkillDefinition, 'id' | 'createdAt'>> {
	return [
		{ name: 'System Architect', category: 'architect', description: 'Defines boundaries, interfaces, and technical direction.', instructions: 'Understand the problem, propose the architecture, identify risks early, and perform the final alignment check before delivery.' },
		{ name: 'Execution Planner', category: 'planner', description: 'Breaks work into milestones and ordered tasks.', instructions: 'Translate goals into implementation steps, define dependencies, and make handoffs explicit.' },
		{ name: 'Feature Developer', category: 'developer', description: 'Implements the planned code changes.', instructions: 'Turn tasks into code and include an orchestrator change-set block when files should change.' },
		{ name: 'Code Reviewer', category: 'reviewer', description: 'Checks correctness, quality, and regressions.', instructions: 'Review behavior, edge cases, test coverage, and maintainability. Return precise findings before approval.' },
		{ name: 'Debugger', category: 'debugger', description: 'Investigates failures and stabilizes the result.', instructions: 'Reproduce bugs, isolate root causes, fix broken flows, and confirm stability before the next review pass.' },
	];
}

function normalizeSkillDefinition(skill: SkillDefinition | Partial<SkillDefinition> | unknown): SkillDefinition {
	const candidate = (skill && typeof skill === 'object' ? skill : {}) as Partial<SkillDefinition>;
	const category = isSkillCategory(candidate.category) ? candidate.category : 'custom';

	return {
		id: typeof candidate.id === 'string' && candidate.id.trim().length > 0 ? candidate.id : `skill-recovered-${Date.now()}`,
		name: withDefaultText(candidate.name, getDefaultSkillName(category)),
		category,
		description: withDefaultText(candidate.description, getDefaultSkillDescription(category)),
		instructions: withDefaultText(candidate.instructions, getDefaultSkillInstructions(category)),
		createdAt: typeof candidate.createdAt === 'string' && candidate.createdAt.trim().length > 0 ? candidate.createdAt : new Date().toISOString(),
	};
}

function withDefaultText(value: string | undefined, fallback: string): string {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function getDefaultSkillName(category: SkillCategory): string {
	switch (category) {
		case 'architect':
			return 'System Architect';
		case 'planner':
			return 'Execution Planner';
		case 'developer':
			return 'Feature Developer';
		case 'reviewer':
			return 'Code Reviewer';
		case 'debugger':
			return 'Debugger';
		case 'custom':
			return 'Custom Skill';
	}
}

function getDefaultSkillDescription(category: SkillCategory): string {
	switch (category) {
		case 'architect':
			return 'Defines boundaries, interfaces, and technical direction.';
		case 'planner':
			return 'Breaks work into clear backlog items, milestones, and sprint tasks.';
		case 'developer':
			return 'Implements planned code changes and completes delivery tasks.';
		case 'reviewer':
			return 'Reviews correctness, quality, regressions, and test coverage.';
		case 'debugger':
			return 'Stabilizes the implementation by fixing failures and root causes.';
		case 'custom':
			return 'Reusable custom instructions for a sub-agent.';
	}
}

function getDefaultSkillInstructions(category: SkillCategory): string {
	switch (category) {
		case 'architect':
			return 'Define the system structure, technical boundaries, interfaces, and final architecture sign-off criteria.';
		case 'planner':
			return 'Translate the problem into an ordered to-do list, milestones, and an agile execution plan for the team.';
		case 'developer':
			return 'Implement assigned backlog items, describe code changes clearly, and provide an orchestrator change-set when files should change.';
		case 'reviewer':
			return 'Review implementation quality, correctness, missing tests, regressions, and readiness for acceptance.';
		case 'debugger':
			return 'Investigate issues, isolate root causes, apply reliable fixes, and stabilize the result for re-review.';
		case 'custom':
			return 'Use this skill as reusable guidance for the agent during planning, implementation, or review.';
	}
}

function isProviderId(value: string | undefined): value is ProviderId {
	return value === 'copilot' || value === 'claude' || value === 'gemini';
}

function isSkillCategory(value: string | undefined): value is SkillCategory {
	return value === 'architect' || value === 'planner' || value === 'developer' || value === 'reviewer' || value === 'debugger' || value === 'custom';
}

function isTaskStatus(value: string | undefined): value is TaskStatus {
	return value === 'todo' || value === 'inProgress' || value === 'done';
}

function isAgentDefinition(value: AgentDefinition | unknown): value is AgentDefinition {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const candidate = value as Partial<AgentDefinition>;
	return typeof candidate.id === 'string' && isProviderId(candidate.provider) && typeof candidate.name === 'string' && typeof candidate.role === 'string' && typeof candidate.createdAt === 'string';
}

function isSkillDefinition(value: SkillDefinition | unknown): value is SkillDefinition {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const candidate = value as Partial<SkillDefinition>;
	return typeof candidate.id === 'string' && typeof candidate.name === 'string' && isSkillCategory(candidate.category) && typeof candidate.description === 'string' && typeof candidate.instructions === 'string' && typeof candidate.createdAt === 'string';
}

function isChatMessage(value: ChatMessage | unknown): value is ChatMessage {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const candidate = value as Partial<ChatMessage>;
	return typeof candidate.id === 'string' && typeof candidate.agentId === 'string' && (candidate.author === 'user' || candidate.author === 'system' || candidate.author === 'assistant') && typeof candidate.text === 'string' && typeof candidate.createdAt === 'string';
}

function isAgentTask(value: AgentTask | unknown): value is AgentTask {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const candidate = value as Partial<AgentTask>;
	return typeof candidate.id === 'string' && typeof candidate.agentId === 'string' && typeof candidate.title === 'string' && isTaskStatus(candidate.status) && typeof candidate.updatedAt === 'string';
}

function isWorkflowStage(value: WorkflowStage | unknown): value is WorkflowStage {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const candidate = value as Partial<WorkflowStage>;
	return typeof candidate.id === 'string' && typeof candidate.label === 'string' && isSkillCategory(candidate.category) && typeof candidate.ownerAgentId === 'string' && typeof candidate.ownerName === 'string' && typeof candidate.status === 'string' && typeof candidate.instructions === 'string';
}

function isHandoffRun(value: HandoffRun | undefined): value is HandoffRun {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const candidate = value as Partial<HandoffRun>;
	return typeof candidate.id === 'string' && typeof candidate.problemStatement === 'string' && typeof candidate.createdAt === 'string' && Array.isArray(candidate.stages) && candidate.stages.every(isWorkflowStage);
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getNonce() {
	const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let index = 0; index < 32; index += 1) {
		result += charset.charAt(Math.floor(Math.random() * charset.length));
	}
	return result;
}
