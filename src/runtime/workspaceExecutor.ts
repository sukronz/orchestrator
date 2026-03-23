import * as path from 'path';
import * as vscode from 'vscode';
import { ExecutionEnvelope } from '../core/types';

export class WorkspaceExecutor {
	public async applyChangeSet(envelope: ExecutionEnvelope): Promise<{
		appliedFiles: string[];
		validationResults: string[];
	}> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			return {
				appliedFiles: [],
				validationResults: ['No workspace folder is open. Skipped file application.'],
			};
		}

		const edit = new vscode.WorkspaceEdit();
		const appliedFiles: string[] = [];

		for (const file of envelope.fileChanges) {
			const filePath = sanitizeWorkspacePath(workspaceFolder.uri.fsPath, file.path);
			if (!filePath) {
				continue;
			}

			const uri = vscode.Uri.file(filePath);
			try {
				await vscode.workspace.fs.stat(uri);
				const fullRange = await this.getFullRange(uri);
				edit.replace(uri, fullRange, file.content);
			} catch {
				edit.createFile(uri, { ignoreIfExists: true });
				edit.insert(uri, new vscode.Position(0, 0), file.content);
			}

			appliedFiles.push(path.relative(workspaceFolder.uri.fsPath, filePath));
		}

		if (appliedFiles.length > 0) {
			await vscode.workspace.applyEdit(edit);
			await vscode.workspace.saveAll();
		}

		const validationResults = envelope.commands
			.map((command) => validateCommand(command))
			.filter((result): result is string => Boolean(result));

		return {
			appliedFiles,
			validationResults,
		};
	}

	private async getFullRange(uri: vscode.Uri): Promise<vscode.Range> {
		const document = await vscode.workspace.openTextDocument(uri);
		const lastLine = Math.max(document.lineCount - 1, 0);
		const lastCharacter = document.lineAt(lastLine).text.length;
		return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lastLine, lastCharacter));
	}
}

export function extractExecutionEnvelope(text: string): { envelope?: ExecutionEnvelope; cleanText: string } {
	const match = text.match(/<orchestrator-change-set>([\s\S]*?)<\/orchestrator-change-set>/);
	if (!match) {
		return { cleanText: text };
	}

	try {
		const parsed = JSON.parse(match[1]) as Partial<ExecutionEnvelope>;
		const envelope: ExecutionEnvelope = {
			summary: typeof parsed.summary === 'string' ? parsed.summary : '',
			fileChanges: Array.isArray(parsed.fileChanges)
				? parsed.fileChanges.filter(isFileChange)
				: [],
			commands: Array.isArray(parsed.commands)
				? parsed.commands.filter((command): command is string => typeof command === 'string')
				: [],
		};

		return {
			envelope,
			cleanText: text.replace(match[0], '').trim(),
		};
	} catch {
		return {
			cleanText: text,
		};
	}
}

function isFileChange(value: unknown): value is { path: string; content: string } {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return typeof candidate.path === 'string' && typeof candidate.content === 'string';
}

function sanitizeWorkspacePath(workspaceRoot: string, relativePath: string): string | undefined {
	const normalizedPath = path.resolve(workspaceRoot, relativePath);
	if (!normalizedPath.startsWith(workspaceRoot)) {
		return undefined;
	}
	return normalizedPath;
}

function validateCommand(command: string): string | undefined {
	const allowedCommands = new Set(['npm run lint', 'npm run compile', 'npm test']);
	if (allowedCommands.has(command.trim())) {
		return `Validation command queued but not auto-run yet: ${command}`;
	}
	return `Skipped unsafe command: ${command}`;
}
