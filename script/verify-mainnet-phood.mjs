import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {keccak256} from 'ethers';

const root=new URL('../',import.meta.url);
try {
  const flags=new Set(process.argv.slice(2));
  for(const flag of flags) assert(['--dry-run','--skip-is-verified-check'].includes(flag),`Unknown option: ${flag}`);
  const record=JSON.parse(await readFile(new URL('deployments/4663/phood/deployment.json',root),'utf8'));
  const artifact=JSON.parse(await readFile(new URL('deployments/4663/phood/artifact.json',root),'utf8'));
  assert.equal(record.chainId,4663);
  assert.equal(record.status,'deployed','Deploy and confirm PHOOD before verifying');
  // Refuse to publish changed sources as if they were the deployed build.
  for(const [path,source] of Object.entries(artifact.metadata.sources)) {
    assert.equal(keccak256(await readFile(new URL(path,root))),source.keccak256,`Source changed since deployment: ${path}`);
  }
  const args=['node_modules/@foundry-rs/forge/bin.mjs','verify-contract',record.contractAddress,'src/PHOOD.sol:PHOOD',
    '--chain','4663','--rpc-url','https://rpc.mainnet.chain.robinhood.com',
    '--compiler-version',record.compiler.version,'--num-of-optimizations',String(record.compilerSettings.optimizer.runs),
    '--evm-version',record.compilerSettings.evmVersion,
    '--verifier','blockscout','--verifier-url','https://robinhoodchain.blockscout.com/api/',
    '--constructor-args',record.constructorArguments,'--watch'];
  if(record.compilerSettings.viaIR) args.push('--via-ir');
  if(flags.has('--skip-is-verified-check')) args.push('--skip-is-verified-check');
  console.log(['node',...args].join(' '));
  if(!flags.has('--dry-run')) {
    const result=spawnSync(process.execPath,args,{cwd:fileURLToPath(root),stdio:'inherit'});
    if(result.error)throw result.error;
    process.exitCode=result.status??1;
    // Forge can exit successfully after an HTTP error. Do not mark the record verified
    // from the exit code alone; require an explicit explorer verification result.
  }
} catch(e) {console.error(e.message);process.exitCode=1;}
