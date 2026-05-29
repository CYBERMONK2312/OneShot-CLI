import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

import type { ActionLog, AgentConfig } from './types';
import { ActionTracker } from './action-tracker';
import { REPLServer } from 'node:repl';

const TEXT_EXT = new Set(['.txt', '.md', '.js', '.ts', '.json', '.html', '.css', '.jsx', '.tsx', '.cjs', '.yml', '.yaml', '.toml', '.mdx', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h  ', '.cs', '.php', '.rb', '.swift', '.kt', '.kts']);


function isProbablyTextFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return TEXT_EXT.has(ext) || ext === ''; 
}
export class ToolExecutor {

    private overlay = new Map<string, string>();
    private deleted = new Set<string>();
    private readonly norm = (p: string) =>
        path.posix.normalize(p.split(path.sep).join('/')).replace(/^\.\//, '').replace(/^\/?/, '/'); // ensure leading slash

    constructor(private readonly tracker: ActionTracker, private readonly config: AgentConfig) { }


    private resolveSafe(rel: string) {
        const abs = path.resolve(this.config.codebasePath, rel);
        const root = path.resolve(this.config.codebasePath);
        const relCheck = path.relative(root, abs);
        if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
            throw new Error(`Path ${rel} resolves outside of codebase`);
        }
        return abs;
    }

    private excluded(rel: string): boolean {
        const norm = this.norm(rel);
        const segments = norm.split('/').slice(1); // remove leading slash
        const base = segments[segments.length - 1] ?? '';
        for (const pattern of this.config.excludePatterns) {
            if (pattern === '*.log' && base.endsWith('.log')) return true;
            if (pattern === '.env*' && base.startsWith('.env')) return true;
            if (pattern.includes('.*')) continue; // unsupported pattern
            if (segments.includes(pattern) || norm === pattern || norm.startsWith(`${pattern}/`)) return true;
        }
        return false;
    }

    private assertNotExcluded(rel: string, operation: string): void {
        if (this.excluded(rel)) {
            throw new Error(`Operation ${operation} on ${rel} is not allowed due to exclude patterns`);
        }
    }

    getEffectiveText(rel: string): string | undefined {
        const key = this.norm(rel);
        if (this.deleted.has(key)) return undefined;
        if (this.overlay.has(key)) return this.overlay.get(key);
        const abs = this.resolveSafe(rel);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return undefined;
        if (fs.statSync(abs).isDirectory()) {
            throw new Error(`Path ${rel} is a directory`);
        }
        return fs.readFileSync(abs, 'utf-8');
    }

    readFile(rel: string): string {
        this.assertNotExcluded(rel, 'read_file');
        const abs = this.resolveSafe(rel);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
            throw new Error(`File ${rel} does not exist`);
        }
        const st = fs.statSync(abs);
        if (st.size > this.config.maxFileSizeToRead) {
            throw new Error(`File ${rel} is too large to read (size: ${st.size} bytes)`);
        }
        const text = fs.readFileSync(abs, 'utf-8');
        this.tracker.log({
            type: 'code_analysis',
            path: this.norm(rel),
            details: { after: text, toolName: 'readFile', toolResult: `Read file of size ${st.size} bytes` },
            status: 'executed'
        });
        return text;
    }

    createFile(rel: string, content: string): string {
        if (!this.config.tools.allowFileCreation) {
            throw new Error(`File creation is not allowed by config`);
        }
        this.assertNotExcluded(rel, 'create_file');
        const key = this.norm(rel);
        const abs = this.resolveSafe(rel);
        if (fs.existsSync(abs) && !this.deleted.has(key)) {
            throw new Error(`File ${rel} already exists`);
        }
        this.deleted.delete(key);
        this.overlay.set(key, content);
        this.tracker.log({
            type: 'file_create',
            path: key,
            details: { after: content },
            status: 'pending'
        });
        return `Staged new file ${rel}`;
    }

    modifyFile(rel: string, content: string): string {
        if (!this.config.tools.allowFileModification) {
            throw new Error(`File modification is not allowed by config`);
        }
        this.assertNotExcluded(rel, 'modify_file');
        const before = this.getEffectiveText(rel);
        if (before === undefined) {
            throw new Error(`File ${rel} does not exist for modification`);
        }
        const key = this.norm(rel);
        this.overlay.set(key, content);
        this.tracker.log({
            type: 'file_modify',
            path: key,
            details: { before, after: content },
            status: 'pending'
        });
        return `Staged modification to file ${rel}`;
    }

    deleteFile(rel: string): string {
        if (!this.config.tools.allowFileModification) {
            throw new Error(`File deletion is not allowed by config`);
        }
        this.assertNotExcluded(rel, 'delete_file');
        const before = this.getEffectiveText(rel);
        if (before === undefined) {
            throw new Error(`File ${rel} does not exist for deletion`);
        }
        const key = this.norm(rel);
        this.overlay.delete(key);
        this.deleted.add(key);
        this.tracker.log({
            type: 'file_delete',
            path: key,
            details: { before },
            status: 'pending'
        });
        return `Staged deletion of file ${rel}`;
    }

    createFolder(rel: string): string {
        if (!this.config.tools.allowFolderCreation) {
            throw new Error(`Folder creation is not allowed by config`);
        }
        this.assertNotExcluded(rel, 'folder_create');
        const key = this.norm(rel);
        const abs = this.resolveSafe(rel);
        if (fs.existsSync(abs) && !this.deleted.has(key)) {
            throw new Error(`Folder ${rel} already exists`);
        }
        // this.deleted.delete(key);  // we don't need to track deleted folders since we don't track their content in the overlay
        // this.overlay.set(key, ''); // content is irrelevant for folders
        this.tracker.log({
            type: 'folder_create',
            path: key,
            details: { after: key, toolName: 'createFolder' }, //create folder tool doesn't need content, but we can log the path as "after" state for clarity
            status: 'pending'
        });
        return `Staged new folder ${rel}`;
    }

    listFiles(rel: string, recursive: boolean): string{
        this.assertNotExcluded(rel, 'list_files');
        const abs = this.resolveSafe(rel);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
            throw new Error(`Directory ${rel} does not exist`);
        }

        const lines: string[] = [];
        const walk = (currentRel: string, prefix: string) => {
            const entries = fs.readdirSync(this.resolveSafe(currentRel), { withFileTypes: true });
            for (const entry of entries) {
                const entryRel = path.posix.join(currentRel, entry.name);
                const relPath = path.posix.relative(this.config.codebasePath, entryRel); // convert to relative path from codebase root
                if (this.excluded(relPath)) continue;
                if (entry.isDirectory()) {
                    lines.push(`${prefix}${entry.name}/`);
                    if (recursive) walk(entryRel, `${prefix}${entry.name}/`);
                }
                else if (entry.isFile()) {
                    lines.push(`${prefix}${entry.name}`);
                }
            }
        };

        if (fs.statSync(abs).isDirectory()) {
            walk(abs, '');
        } else lines.push(path.relative(this.config.codebasePath, abs));
        

        const out = lines.sort().join('\n');
        this.tracker.log({
            type: 'code_analysis',
            path: this.norm(rel),
            details: { after: out, toolName: 'list_files', toolResult: `Listed ${lines.length} entries` },//toolResult can include number of entries listed for better insight
            status: 'executed'
        });
        return out || 'No files found';
    }

    searchFiles(rootRel: string, globPattern: string, contentQuery?: string): string {
        this.assertNotExcluded(rootRel, 'search_files');
        const rootAbs = this.resolveSafe(rootRel);
        if (!fs.existsSync(rootAbs) || !fs.statSync(rootAbs).isDirectory()) {
            throw new Error(`Directory ${rootRel} does not exist`);
        }

        const results: string[] = [];
        const regexFromGlob = (pattern: string): RegExp => {
            const escaped = pattern.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&')
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.')
                .replace(/\*/g, '[^/\\\\]*')
            return new RegExp(`^${escaped}$`, "i");
        };

        const nameRe = regexFromGlob(globPattern.replace(/\\/g, '/')); // ensure glob pattern uses forward slashes
        const walk = (currentRel: string) => {
            for (const entry of fs.readdirSync(this.resolveSafe(currentRel), { withFileTypes: true })) {
                const entryRel = path.join(currentRel, entry.name);
                const relPath = path.relative(this.config.codebasePath, entryRel).split(path.sep).join("/"); // convert to relative path from codebase root
                if (this.excluded(relPath)) continue;
                if (entry.isDirectory()) {
                    walk(entryRel);
                } else if (nameRe.test(relPath) || nameRe.test(entry.name)) {
                    if (contentQuery) {
                        if (!isProbablyTextFile(entry.name)) {
                            continue;
                        }
                        const text = fs.readFileSync(this.resolveSafe(entryRel), 'utf-8');
                        if (!text.includes(contentQuery)) {
                            continue;
                        }
                    } else {
                        results.push(relPath);
                    }
                }
            }
        }

        if (fs.statSync(rootAbs).isDirectory()) walk(rootAbs);
        else {
            const relPath = path.relative(this.config.codebasePath, rootAbs).split(path.sep).join("/"); // convert to relative path from codebase root
        }
        results.push(path.relative(this.config.codebasePath, rootAbs).split(path.sep).join("/"));

        const out = [...new Set(results.sort())].join('\n'); // deduplicate and sort results
        this.tracker.log({
            type: 'code_analysis',
            path: this.norm(rootRel),
            details: { after: out || "(No files found)", toolName: 'search_files', toolResult: `Found ${results.length} matching files` }, //toolResult can include number of matches for better insight
            status: 'executed'
        });
        return out || 'No matching files found';

    }    

    analyzeCodebase(rootRel: string): string {
        const rootAbs = this.resolveSafe(rootRel);
        if (!fs.existsSync(rootAbs) || !fs.statSync(rootAbs).isDirectory()) {
            throw new Error(`Directory ${rootRel} does not exist`);
        }

        let fileCount = 0;
        let dirCount = 0;

        const walk = (currentRel: string) => {
            for (const entry of fs.readdirSync(this.resolveSafe(currentRel), { withFileTypes: true })) {
                const entryRel = path.join(currentRel, entry.name);
                const relPath = path.relative(this.config.codebasePath, entryRel).split(path.sep).join("/"); // convert to relative path from codebase root
                if (this.excluded(relPath)) continue;
                if (entry.isDirectory()) {
                    dirCount++;
                    walk(entryRel);
                } else {
                    fileCount++;
                }
            }
        };

        if (fs.statSync(rootAbs).isDirectory()) walk(rootAbs);
        else fileCount = 1;

        const summary = `Codebase analysis for ${rootRel}:\n- Total files: ${fileCount}\n- Total directories: ${dirCount}`;
        this.tracker.log({
            type: 'code_analysis',
            path: this.norm(rootRel),
            details: { after: summary, toolName: 'analyze_codebase', toolResult: `Analyzed codebase with ${fileCount} files and ${dirCount} directories` }, //toolResult can include counts for better insight
            status: 'executed'
        });
        return summary;
    } 

    queueShell(command: string): string {
        if (!this.config.tools.allowShellExecution) {
            throw new Error(`Shell command execution is not allowed by config`);
        }
        this.tracker.log({
            type: 'tool_execute', 
            path: 'shell',
            details: { command , toolName: 'execute_shell', toolResult: `Queued shell command` },
            status: 'pending'
        });
        return `Queued shell command: ${command}`;
    }

    skillRoots(): string[] {
        const extra = process.env.SKILLS_DIRS?.split(/[;]/).map(d => d.trim()).filter(Boolean) ?? [];
        return [
            ...extra,
            path.join(homedir(), '.cursor/skills-cursor'),
            path.join(homedir(), '.claude/skills'),
        ];
    }

    listSkills(): string {
        const lines: string[] = [];
        for (const root of this.skillRoots()) {
            if (!fs.existsSync(root)) continue;
            const walk = (dir: string) => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        walk(fullPath);
                    }
                    else if (entry.name === 'SKILL.md') lines.push(fullPath);
                }
                
            };
            walk(root);
        }
    

        const out = lines.sort().join('\n');
        this.tracker.log({
            type: 'code_analysis',
            path: 'skills',
            details: { after: out || '(none)', toolName: 'list_skills' },
            status: 'executed',
        });
        return out || '(none)';
    }

    readSkill(skillPath: string): string {
        const abs = path.isAbsolute(skillPath) ? path.normalize(skillPath) : path.normalize(path.resolve(this.config.codebasePath, skillPath));
        const allowed = this.skillRoots().some(root => {
            const r = path.resolve(root);
            return abs === r || abs.startsWith(r + path.sep);
        });
        if (!allowed) {
            throw new Error(`Access to skill at ${skillPath} is not allowed`);
        }
        const text = fs.readFileSync(abs, 'utf-8');
        this.tracker.log({
            type: 'code_analysis',
            path: abs,
            details: { after: text, toolName: 'read_skill', toolResult: `Read skill file of size ${text.length} bytes` },
            status: 'executed'
        });
        return text;
    }

    applyApprovedFromTracker(): { errors: string[] } {
        const errors: string[] = [];
        const all = [...this.tracker.getActions()].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()); // ensure actions are applied in the order they were logged
        
        for (const action of all.filter(a => a.type === 'folder_create' && a.status === 'approved')) {
            try {
                fs.mkdirSync(this.resolveSafe(action.path), { recursive: true });
            } catch (e) {
                errors.push(`Failed to create folder ${action.path}: ${(e as Error).message}`);
            }
        }

        const fileOps = all.filter(a => ['file_create', 'file_modify', 'file_delete'].includes(a.type) && a.status === 'approved')
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()); // ensure file operations are applied in the order they were logged

        const lastByPath = new Map<string, ActionLog>();
        for (const action of fileOps) lastByPath.set(this.norm(action.path), action);

        for (const [pathKey, action] of lastByPath) {
            try {
                if (action.type === 'file_delete') fs.rmSync(this.resolveSafe(pathKey), { force: true });
                else {
                    const target = this.resolveSafe(pathKey);
                    fs.mkdirSync(path.dirname(target), { recursive: true });
                    fs.writeFileSync(target, action.details.after ?? '', 'utf-8');
                }
            } catch (e) {
                errors.push(`Failed to apply ${action.type} on ${action.path}: ${(e as Error).message}`);
            }
        }
        for (const action of all.filter(a => a.type === 'tool_execute' && a.status === 'approved')) {
            const cmd = action.details.command;
            if (!cmd) {
                errors.push(`No command specified for tool execution action ${action.id}`);
                continue;
            }

            const result = spawnSync(cmd, { shell: true, cwd: this.config.codebasePath, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 });
            if (result.error) {
                errors.push(`Failed to execute command "${cmd}": ${result.error.message}`);
            } else if (result.status !== 0) {
                errors.push(`Command "${cmd}" exited with code ${result.status}: ${result.stderr}`);
            }
        }
        return { errors };  
    }

}