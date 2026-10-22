import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../test/',import.meta.url));
// Support commands require an explicit backend fixture or baseline. Only test
// suites belong in discovery; never execute every helper as a standalone test.
const tests=fs.readdirSync(root,{recursive:true}).filter(name=>/\.test\.[cm]?[jt]s$/.test(name)).sort().map(name=>path.join(root,name));
if(!tests.length)throw new Error('No test suites found');
const result=spawnSync(process.execPath,['--experimental-transform-types','--test',...process.argv.slice(2),...tests],{stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
