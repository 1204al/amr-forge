import { mkdirSync, writeFileSync } from 'node:fs';
import { benchmark, csv } from './model.ts';

const results = benchmark();
mkdirSync('benchmarks/results', { recursive: true });
writeFileSync('benchmarks/results/local.json', JSON.stringify({ source: 'local', scenario: 'warehouse-under-pressure', results }, null, 2) + '\n');
writeFileSync('benchmarks/results/local.csv', csv(results));
console.table(results);
