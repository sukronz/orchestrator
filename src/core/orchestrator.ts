import { AgentDefinition, SkillCategory, SkillDefinition, StageExecutionResult, WorkflowStage } from './types';
import { ProviderRegistry } from '../providers';
import { WorkspaceExecutor, extractExecutionEnvelope } from '../runtime/workspaceExecutor';

export class OrchestratorRuntime {
	constructor(
		private readonly providers: ProviderRegistry,
		private readonly workspaceExecutor: WorkspaceExecutor
	) {}

	public async executeAgentChat(args: {
		agent: AgentDefinition;
		skills: SkillDefinition[];
		userMessage: string;
	}): Promise<StageExecutionResult> {
		const result = await this.providers.generate({
			agent: args.agent,
			skills: args.skills,
			taskPrompt: args.userMessage,
		});

		return this.applyIfPresent(result.text);
	}

	public async executeStage(args: {
		agent: AgentDefinition;
		skills: SkillDefinition[];
		stage: WorkflowStage;
		problemStatement: string;
		previousOutput?: string;
	}): Promise<StageExecutionResult> {
		const result = await this.providers.generate({
			agent: args.agent,
			skills: args.skills,
			taskPrompt: buildStagePrompt(args.stage.category, args.problemStatement, args.stage.instructions),
			previousOutput: args.previousOutput,
		});

		return this.applyIfPresent(result.text);
	}

	private async applyIfPresent(text: string): Promise<StageExecutionResult> {
		const { envelope, cleanText } = extractExecutionEnvelope(text);
		if (!envelope) {
			return {
				text: cleanText,
				appliedFiles: [],
				validationResults: [],
			};
		}

		const workspaceResult = await this.workspaceExecutor.applyChangeSet(envelope);
		const outputParts = [cleanText];
		if (workspaceResult.appliedFiles.length > 0) {
			outputParts.push(`Applied files: ${workspaceResult.appliedFiles.join(', ')}`);
		}
		if (workspaceResult.validationResults.length > 0) {
			outputParts.push(`Validation: ${workspaceResult.validationResults.join(' | ')}`);
		}

		return {
			text: outputParts.filter(Boolean).join('\n\n'),
			appliedFiles: workspaceResult.appliedFiles,
			validationResults: workspaceResult.validationResults,
		};
	}
}

export function findBestAgentForCategory(
	category: SkillCategory,
	agents: AgentDefinition[],
	skills: SkillDefinition[],
	labels: Record<SkillCategory, string>
): AgentDefinition | undefined {
	const skillIdsForCategory = new Set(skills.filter((skill) => skill.category === category).map((skill) => skill.id));
	const skillMatch = agents.find((agent) => agent.skillIds.some((skillId) => skillIdsForCategory.has(skillId)));
	if (skillMatch) {
		return skillMatch;
	}

	const keyword = labels[category].toLowerCase();
	return agents.find((agent) => {
		const haystack = `${agent.name} ${agent.role}`.toLowerCase();
		return haystack.includes(keyword) || (category === 'architect' && haystack.includes('architecture'));
	});
}

function buildStagePrompt(category: SkillCategory, problemStatement: string, instructions: string): string {
	return [
		`Problem statement:\n${problemStatement}`,
		`Stage category: ${category}`,
		`Stage instructions:\n${instructions}`,
		'Respond with the concrete output for your stage. If code should change, include the orchestrator change-set block.',
	].join('\n\n');
}
