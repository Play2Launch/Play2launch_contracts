import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const valid={chainId:4663,deploymentName:'dry-run-only',campaignHash:'0x'+'1'.repeat(64),token:'0x'+'2'.repeat(40),admin:'0x'+'3'.repeat(40),signer:'0x'+'4'.repeat(40),deployer:'0x'+'5'.repeat(40),keyFile:'.secrets/does-not-exist.json',maxFeeETH:'0.001'};
async function run(config){const dir=await mkdtemp(join(tmpdir(),'p2l-airdrop-check-'));try{const path=join(dir,'config.json');await writeFile(path,JSON.stringify(config));return spawnSync(process.execPath,['script/deploy-airdrop.mjs','--config='+path,'--dry-run'],{cwd:root,encoding:'utf8'});}finally{await rm(dir,{recursive:true,force:true})}}
test('dry run validates without a private key file and preserves configured owner',async()=>{const r=await run(valid);assert.equal(r.status,0,r.stderr);const out=JSON.parse(r.stdout);assert.equal(out.admin,valid.admin);assert.equal(out.signer,valid.signer);assert.equal(out.chainId,4663)});
test('rejects wrong chain, incomplete hashes, mismatched activity IDs and unsafe key paths',async()=>{for(const config of [{...valid,chainId:1},{...valid,campaignHash:'placeholder'},{...valid,campaignID:'wrong'},{...valid,keyFile:'../wallet.json'},{...valid,deploymentName:'../escape'},{...valid,maxFeeETH:'0'}]){assert.notEqual((await run(config)).status,0)}});
