import type { ActionLog, ActionStatus } from './types';
import { isMutationType } from './types';

export class ActionTracker {
    private actions: ActionLog[] = [];

    log(
        entry: Omit<ActionLog, 'id' | 'timestamp'> & {
            id?: string;
            timestamp?: Date;
        },
    ): ActionLog {
        const newEntry: ActionLog = {
            id: entry.id ?? `action_${this.actions.length}`, // +1 to avoid id=0
            timestamp: entry.timestamp ?? new Date(),
            type: entry.type,
            path: entry.path,
            details: { ...entry.details },
            status: entry.status,
            userApproved: entry.userApproved,
        };
        this.actions.push(newEntry);
        return newEntry;
     }
    
    getActions(): readonly ActionLog[] {
        return this.actions;
    }

    getPendingMutations(): ActionLog[] {
        return this.actions.filter(a => a.status === 'pending' && isMutationType(a.type));
    }

    updateStatus(id: string, status: ActionStatus, userApproved?: boolean): void {
        const action = this.actions.find(a => a.id === id);
        if (!action) {
            console.warn(`Action with id ${id} not found.`);
            return;
        }
        if (action) {
            action.status = status;
        }
        action.status = status;
        if (userApproved !== undefined) {
            action.userApproved = userApproved;
        }
    }

}