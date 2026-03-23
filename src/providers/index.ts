import * as vscode from 'vscode';
import { AgentDefinition, ModelResult, ProviderId, SkillDefinition } from '../core/types';

const SECRET_KEYS: Record<ProviderId, string> = {
	copilot: 'orchestrator.copilotApiKey',
	claude: 'orchestrator.claudeApiKey',
	gemini: 'orchestrator.geminiApiKey',
};

const MODEL_BY_PROVIDER: Record<ProviderId, string> = {
	copilot: 'gpt-4.1',
	claude: 'claude-3-7-sonnet-latest',
	gemini: 'gemini-2.5-pro',
};

export class ProviderRegistry {
	constructor(private readonly context: vscode.ExtensionContext) {}

	public async generate(args: {
		agent: AgentDefinition;
		skills: SkillDefinition[];
		taskPrompt: string;
		previousOutput?: string;
	}): Promise<ModelResult> {
		switch (args.agent.provider) {
			case 'copilot':
				return this.callOpenAI(args.agent, args.skills, args.taskPrompt, args.previousOutput);
			case 'claude':
				return this.callAnthropic(args.agent, args.skills, args.taskPrompt, args.previousOutput);
			case 'gemini':
				return this.callGemini(args.agent, args.skills, args.taskPrompt, args.previousOutput);
		}
	}

	private async callOpenAI(
		agent: AgentDefinition,
		skills: SkillDefinition[],
		taskPrompt: string,
		previousOutput?: string
	): Promise<ModelResult> {
		const apiKey = await this.requireSecret('copilot');
		const response = await fetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: MODEL_BY_PROVIDER.copilot,
				input: [
					{
						role: 'system',
						content: [{ type: 'input_text', text: buildSystemPrompt(agent, skills) }],
					},
					{
						role: 'user',
						content: [{ type: 'input_text', text: buildUserPrompt(taskPrompt, previousOutput) }],
					},
				],
			}),
		});

		const raw: Record<string, unknown> = await response.json() as Record<string, unknown>;
		if (!response.ok) {
			throw new Error(`OpenAI call failed: ${extractErrorMessage(raw)}`);
		}

		return {
			text: typeof raw.output_text === 'string' ? raw.output_text : JSON.stringify(raw),
			raw,
		};
	}

	private async callAnthropic(
		agent: AgentDefinition,
		skills: SkillDefinition[],
		taskPrompt: string,
		previousOutput?: string
	): Promise<ModelResult> {
		const apiKey = await this.requireSecret('claude');
		const response = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
			},
			body: JSON.stringify({
				model: MODEL_BY_PROVIDER.claude,
				max_tokens: 4000,
				system: buildSystemPrompt(agent, skills),
				messages: [
					{
						role: 'user',
						content: buildUserPrompt(taskPrompt, previousOutput),
					},
				],
			}),
		});

		const raw: Record<string, unknown> = await response.json() as Record<string, unknown>;
		if (!response.ok) {
			throw new Error(`Anthropic call failed: ${extractErrorMessage(raw)}`);
		}

		const content = raw.content;
		const text = Array.isArray(content)
			? content
				.filter((item: { type?: string }) => item.type === 'text')
				.map((item: { text?: string }) => item.text ?? '')
				.join('\n')
			: JSON.stringify(raw);

		return { text, raw };
	}

	private async callGemini(
		agent: AgentDefinition,
		skills: SkillDefinition[],
		taskPrompt: string,
		previousOutput?: string
	): Promise<ModelResult> {
		const apiKey = await this.requireSecret('gemini');
		const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_BY_PROVIDER.gemini}:generateContent?key=${encodeURIComponent(apiKey)}`;
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				systemInstruction: {
					parts: [{ text: buildSystemPrompt(agent, skills) }],
				},
				contents: [
					{
						role: 'user',
						parts: [{ text: buildUserPrompt(taskPrompt, previousOutput) }],
					},
				],
			}),
		});

		const raw: Record<string, unknown> = await response.json() as Record<string, unknown>;
		if (!response.ok) {
			throw new Error(`Gemini call failed: ${extractErrorMessage(raw)}`);
		}

		const candidates = raw.candidates;
		const text = Array.isArray(candidates)
			? candidates
				.flatMap((candidate: { content?: { parts?: Array<{ text?: string }> } }) => candidate.content?.parts ?? [])
				.map((part: { text?: string }) => part.text ?? '')
				.join('\n')
			: JSON.stringify(raw);

		return { text, raw };
	}

	private async requireSecret(provider: ProviderId): Promise<string> {
		const value = await this.context.secrets.get(SECRET_KEYS[provider]);
		if (!value) {
			throw new Error(`Missing API key for ${provider}. Save it in the extension settings first.`);
		}
		return value;
	}
}

function buildSystemPrompt(agent: AgentDefinition, skills: SkillDefinition[]): string {
	const skillText = skills.length === 0
		? 'No explicit skills attached.'
		: skills.map((skill) => `- ${skill.name} (${skill.category}): ${skill.instructions}`).join('\n');

	return [
		`You are ${agent.name}.`,
		`Role: ${agent.role}`,
		'Work as a focused software sub-agent.',
		'If you are proposing code changes, include a machine-readable change set in this exact format:',
		'<orchestrator-change-set>{"summary":"short summary","fileChanges":[{"path":"relative/path","content":"full file content"}],"commands":["npm run lint"]}</orchestrator-change-set>',
		'Only include the change-set block if you intend the extension to apply files or run validations.',
		'Skills:',
		skillText,
	].join('\n');
}

function buildUserPrompt(taskPrompt: string, previousOutput?: string): string {
	return [
		`Task:\n${taskPrompt}`,
		previousOutput ? `Previous stage output:\n${previousOutput}` : undefined,
		'Be concise but complete. If you propose code changes, provide the required <orchestrator-change-set> block.',
	]
		.filter((value): value is string => Boolean(value))
		.join('\n\n');
}

function extractErrorMessage(raw: unknown): string {
	if (!raw || typeof raw !== 'object') {
		return 'Unknown provider error';
	}

	const candidate = raw as Record<string, unknown>;
	if (typeof candidate.error === 'string') {
		return candidate.error;
	}
	if (candidate.error && typeof candidate.error === 'object') {
		const errorObject = candidate.error as Record<string, unknown>;
		if (typeof errorObject.message === 'string') {
			return errorObject.message;
		}
	}
	if (typeof candidate.message === 'string') {
		return candidate.message;
	}

	return 'Unknown provider error';
}
