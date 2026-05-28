export type Actiontyp = 
    'file_create' 
    | 'file_delete' 
    | 'file_modify' 
    | 'file_read' 
    | 'execute_command' 
    | 'folder_create'
    | 'code_analysis'
    'tool_execute';


export type ActionStatus = 'pending' | 'executed' | 'approved' | 'rejected';
    
export interface ActionLog {
    id: string;
    timestamp: Date;
    type: Actiontyp;
    path: string;
    details: {
        before?: string;
        after?: string;
        toolName?: string;
        toolResult?: string;
        error?: string;
        command?: string;
    };
    status: ActionStatus;
    userApproved?: boolean;
}
    
export interface AgentConfig {
    codebasePath: string;
    maxFileSizeToRead: number; // in bytes
    excludePatterns: string[]; // glob patterns to exclude from analysis
    tools: {
        allowShellExecution: boolean;
        allowFileModification: boolean;
        allowFileCreation: boolean;
        allowFolderCreation: boolean;
    };
}


export const defaultAgentConfig = (): AgentConfig => ({
    codebasePath: process.cwd(),
    maxFileSizeToRead: 5 * 1024 * 1024, // 5 MB
    excludePatterns: ['node_modules/**', '.git/**', 'dist/**', 'build/**', 'out/**', '.next/**', '*.log', '.env*'],
    tools: {
        allowShellExecution: true,
        allowFileModification: true,
        allowFileCreation: true,
        allowFolderCreation: true
    }
});

export function isMutationType(t: Actiontyp): boolean {
    return ['file_create', 'file_delete', 'file_modify', 'folder_create', 'tool_execute'].includes(t);
}
