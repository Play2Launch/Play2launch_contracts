import { readFile, writeFile } from 'node:fs/promises';

const artifact = JSON.parse(await readFile(new URL('../out/PhoodIDO.sol/PhoodIDO.json', import.meta.url), 'utf8'));
const destination = new URL('../../PlayToLaunch_admin/src/idoAbi.json', import.meta.url);
await writeFile(destination, `${JSON.stringify(artifact.abi, null, 2)}\n`);
console.log('Admin IDO ABI updated.');
