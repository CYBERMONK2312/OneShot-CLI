import { select, isCancel } from "@clack/prompts";
import chalk from "chalk";
import figlet from "figlet";
import fontData from "figlet/fonts/1Row";
import { runCliMode } from "../modes/cli";

const BANNEE_FONT = "ANSI Shadow";
const SHADOW = chalk.hex("#ff35ee");
const FACE = chalk.hex("#4eebc7").bold;

function printBannerWithShadow(ascii: string) {
    const bannerLines = ascii.replace(/\s+$/, '').split("\n");
    const maxLength = Math.max(...bannerLines.map(line => line.length), 0);   
    const rowWidth = maxLength + 2; 

    for(const line of bannerLines) {
        console.log(SHADOW((" " + line).padEnd(rowWidth)));
    }
        
    process.stdout.write(`\x1b[${bannerLines.length}A`); // Move cursor up to the start of the banner
    for(const line of bannerLines) {
        console.log(FACE(line.padEnd(rowWidth)));
    }

    console.log("\n".repeat(bannerLines.length)); 
}

export async function runWakeup() {
    let ascii: string;
    try { ascii = figlet.textSync("OneShot-CLI", { font: BANNEE_FONT }); }
    catch (error) { ascii = "OneShot-CLI"; }

    printBannerWithShadow(ascii);

    const mode = await select({
        message: "Select a mode:",
        options: [
            { value: "cli", label: "CLI" },
            { value: "telegram", label: "TELEGRAM" },
            { value: "exit", label: "EXIT" }
        ]
    });

    if (isCancel(mode || mode === "exit")) {
        console.log(chalk.red("\n Goodbye!"));
        return;
    }

    if(mode === "cli") {
        console.log(chalk.green("You selected CLI mode!"));
        await runCliMode();
    } else if(mode === "telegram") {
        console.log(chalk.green("You selected TELEGRAM mode!"));
    } 
}