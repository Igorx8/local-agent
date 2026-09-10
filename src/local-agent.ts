#!/usr/bin/env node

const first = process.argv[2];
if (!first || first.startsWith("-")) process.argv.splice(2, 0, "shell");
await import("./cli.js");
