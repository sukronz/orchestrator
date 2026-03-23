export type ProviderId = 'copilot' | 'claude' | 'gemini';
export type SkillCategory = 'architect' | 'planner' | 'developer' | 'reviewer' | 'debugger' | 'custom';
export type TaskStatus = 'todo' | 'inProgress' | 'done';
export type WorkflowStatus = 'ready' | 'needs-agent' | 'running' | 'completed' | 'failed';

export type AgentDefinition = {
	id: string;
	provider: ProviderId;
	name: string;
	role: string;
	skillIds: string[];
	createdAt: string;
};

export type SkillDefinition = {
	id: string;
	name: string;
	category: SkillCategory;
	description: string;
	instructions: string;
	createdAt: string;
};

export type ChatMessage = {
	id: string;
	agentId: string;
	author: 'user' | 'system' | 'assistant';
	text: string;
	createdAt: string;
};

export type AgentTask = {
	id: string;
	agentId: string;
	title: string;
	status: TaskStatus;
	updatedAt: string;
};

export type WorkflowStage = {
	id: string;
	label: string;
	category: SkillCategory;
	ownerAgentId: string;
	ownerName: string;
	status: WorkflowStatus;
	instructions: string;
	output?: string;
};

export type HandoffRun = {
	id: string;
	problemStatement: string;
	createdAt: string;
	stages: WorkflowStage[];
};

export type ModelResult = {
	text: string;
	raw?: unknown;
};

export type ChatExecutionInput = {
	agent: AgentDefinition;
	skills: SkillDefinition[];
	userMessage: string;
};

export type FileChange = {
	path: string;
	content: string;
};

export type ExecutionEnvelope = {
	summary: string;
	fileChanges: FileChange[];
	commands: string[];
};

export type StageExecutionResult = {
	text: string;
	appliedFiles: string[];
	validationResults: string[];
};
