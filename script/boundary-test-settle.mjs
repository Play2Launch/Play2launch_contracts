import {configureTestVesting} from './vesting-config.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,Wallet,Contract} from 'ethers';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),file=new URL('testnet-runs/boundary-flow-20261019.json',root);
const r=JSON.parse(await readFile(file,'utf8'));
const rpc=new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com',undefined,{cacheTimeout:-1});
try{
assert.equal((await rpc.getNetwork()).chainId,46630n);
const keys=JSON.parse(await readFile(new URL('.secrets/wallets.json',root),'utf8'));
const admin=new Wallet(keys.wallets.admin.privateKey,rpc);
const abi=JSON.parse(await readFile(new URL('out/PhoodIDO.sol/PhoodIDO.json',root),'utf8')).abi;
const c=new Contract(r.contract,abi,admin);
assert.equal(await c.campaignId(),r.campaignHash);
const save=()=>writeFile(file,JSON.stringify(r,null,2));
async function step(name,fn){let s=r.steps[name];if(!s){const tx=await fn();s=r.steps[name]={hash:tx.hash};await save();}const receipt=await rpc.waitForTransaction(s.hash,2,120000);assert.equal(receipt.status,1);s.block=receipt.blockNumber;await save();console.log(name,s.hash);}
if(process.argv[2]==='prepare'){
const now=(await rpc.getBlock('latest')).timestamp;
await step('boundary-end',()=>c.setSaleEnd(now+60));
await step('boundary-vesting',()=>configureTestVesting(c,[now+3600,0,600,60,1000]));
r.saleEnd=Number((await c.sale()).end);await save();console.log('saleEnd',new Date(r.saleEnd*1000).toISOString());
}else if(process.argv[2]==='settle'){
const gmail='0xCca07db328ff1580Ba0D331FF56f9D5bE430e5DC',live='0xB8DeD53EA8F17e5CEE1ED40323EF8C569f9C1Fd4';
assert.equal(await c.participantCount(),2n);assert.equal((await c.accounts(gmail)).paidCents,10001n);assert.equal((await c.accounts(live)).paidCents,100000n);
assert.ok((await rpc.getBlock('latest')).timestamp>=Number((await c.sale()).end));
// Scores recorded from each account's freshly completed server-verified game.
await step('boundary-rebates',()=>c.registerRebates([gmail,live],[4375,1500]));
await step('boundary-lock',()=>c.lockRebates());
await step('boundary-success',()=>c.finalizeSuccess());
assert.equal((await c.accounts(gmail)).rebateCents,2000n);assert.equal((await c.accounts(live)).rebateCents,1500n);
console.log('Successful; rebate liabilities35 Mock USDT; tokens110001 PHOOD; all unclaimed');
}else throw Error('prepare or settle required');
}finally{rpc.destroy();}
