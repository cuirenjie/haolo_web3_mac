// Compatibility entry point: catalogue and history now use the original canvas.
import {fileURLToPath} from 'node:url';
process.env.HAOLO_CHART_FIXTURES ||= fileURLToPath(new URL('../output/index-charts-20261019/fixtures-production.json', import.meta.url));
await import('./index-charts-visual-qa.mjs');
