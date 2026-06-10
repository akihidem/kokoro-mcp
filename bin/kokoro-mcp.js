#!/usr/bin/env node
import { main } from '../src/cli.js';

try {
  const code = await main(process.argv.slice(2));
  if (typeof code === 'number') process.exit(code);
} catch (e) {
  console.error(`エラー: ${e.message}`);
  process.exit(1);
}
