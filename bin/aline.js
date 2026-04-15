#!/usr/bin/env node

const { createProgram } = require('../src/cli/commands');

async function main() {
  const program = createProgram();
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
