import { isCancel, text } from '@clack/prompts';
import chalk from 'chalk';
import { defaultAgentConfig } from './types';
import { ActionTracker } from './action-tracker';

export async function runAgentMode() {
    console.log(chalk.blue.bold("\n🤖AGENT MODE!\n"));

    const goal = await text({   
        message: "What is your goal for the agent?",
        placeholder: "concrete task for this codebase...",
    });

    if (isCancel(goal) || !goal.trim()) {
        console.log(chalk.yellow("\n Returning to mode selection..."));
        return;
    }

    const config = defaultAgentConfig();
    const tracker = new ActionTracker();
    const executor = new ToolExecutor(tracker, config);
}