import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

import type { ActionLog, AgentConfig } from './types';
import { ActionTracker } from './action-tracker';

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


}