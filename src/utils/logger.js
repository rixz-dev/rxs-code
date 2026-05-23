import chalk from "chalk";

export const log = {
  info: (...msg) => console.log(chalk.blue("ℹ"), ...msg),
  success: (...msg) => console.log(chalk.green("✔"), ...msg),
  warn: (...msg) => console.log(chalk.yellow("⚠"), ...msg),
  error: (...msg) => console.log(chalk.red("✖"), ...msg),
  system: (...msg) => console.log(chalk.magenta("[RXS]"), ...msg),
  user: (msg) => process.stdout.write(chalk.cyan("\nYou: ") + msg),
  assistant: (msg) => {
    process.stdout.write(chalk.green("\nRXS: "));
    process.stdout.write(chalk.white(msg));
    process.stdout.write("\n");
  },
  dim: (...msg) => console.log(chalk.dim(...msg)),
};
