#!/usr/bin/env bun

import { Command } from "commander";
import { runWakeup } from "./tui/wakeup";

const program = new Command();

program
  .name("oneshot")
  .description("A CLI tool for ONESHOT")
  .version("1.0.0");
  
program
  .command("wakeup")
  .description("OneShot Wakeup Command")
  .action(async () => {
    console.log("Wakeup command executed!");
    await runWakeup();
  });

await program.parseAsync(process.argv);
