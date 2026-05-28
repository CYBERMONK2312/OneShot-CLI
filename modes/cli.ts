import chalk from "chalk";
import { select, isCancel } from "@clack/prompts";
import figlet from "figlet";

export async function runCliMode() {
    console.log(chalk.blue("Welcome to CLI mode!"));
    while (true) {
        const mode = await select({
            message: "Select CLI delivery:",
            options: [
                { value: "agent", label: "AGENT MODE" },
                { value: "plan", label: "PLAN MODE" },
                { value: "ask", label: "ASK MODE" },
                { value: "back", label: "<- BACK" },
            ]
        });


        if (isCancel(mode)|| mode === "back") {
            console.log(chalk.yellow("\n Returning to mode selection..."));
            return;
        }

        if (mode === "agent") {
            console.log(chalk.green("You selected AGENT MODE!"));
        }
        if (mode === "plan") {
            console.log(chalk.green("You selected PLAN MODE!"));
        }
        if (mode === "ask") {
            console.log(chalk.green("You selected ASK MODE!"));
        }

        if (mode !== "agent" && mode !== "plan" && mode !== "ask") {
            console.log(chalk.yellow("\nCLI mode is under development. Please check back later!"));
        }
    }
}