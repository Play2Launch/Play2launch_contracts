import {configureTestVesting} from './vesting-config.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,Wallet,Contract,ContractFactory,parseEther,id} from 'ethers';
import assert from 'node:assert/strict';

// Dedicated Robinhood testnet fixtures; never reads production keys.
const root=new URL('../',import.meta.url);
const rpc=new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com',undefined,{cacheTimeout:-1});
assert.equal((await rpc.getNetwork()).chainId,46630n);
const secret=JSON.parse(await readFile(new URL('.secrets/wallets.json',root),'utf8'));
const admin=new Wallet(secret.wallets.admin.privateKey,rpc);
const signer=new Wallet(secret.wallets.signer.privateKey);
const artifact=JSON.parse(await readFile(new URL('out/PhoodIDO.sol/PhoodIDO.json',root),'utf8'));
const file=new URL('testnet-runs/boundary-flow-20261019.json',root);
let report;
try{report=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
report??={chainId:46630,slug:'marketcombo-boundary-test',campaignID:'cp2dxopvrshfcw',campaignHash:id('cp2dxopvrshfcw'),steps:{}};
const save=()=>writeFile(file,JSON.stringify(report,null,2)+'\n');
async function step(label,send){
 let r=report.steps[label];
 if(!r){const tx=await send();r=report.steps[label]={hash:tx.hash};await save();}
 const receipt=await rpc.waitForTransaction(r.hash,2,120000);assert.equal(receipt.status,1);
 Object.assign(r,{address:receipt.contractAddress,block:receipt.blockNumber});await save();console.log(label,r.hash);return r;
}
try{
 const usd='0xBb062B32B6A1eB7697e4165788e856c340dab7ea';
 const token='0x39A717B283A51b7b270f6cbFC4C75d84b64277D8';
 const deployed=await step('deploy',async()=>{
  const start=BigInt((await rpc.getBlock('latest')).timestamp)+60n;
  return (await new ContractFactory(artifact.abi,artifact.bytecode.object,admin).deploy(admin.address,signer.address,admin.address,usd,report.campaignHash,[start,1792742340n,10000n,200000n,parseEther('100'),parseEther('200000'),parseEther('1000000')])).deploymentTransaction();
 });
 report.contract=deployed.address;report.signer=signer.address;await save();
 const c=new Contract(report.contract,artifact.abi,admin);
 await step('bind-token',()=>c.bindToken(token));
 await step('vesting',()=>configureTestVesting(c,[1792745940n,0,600,60,1000]));
 await step('fund-token',()=>new Contract(token,['function transfer(address,uint256) returns(bool)'],admin).transfer(c.target,parseEther('200000')));
 assert.equal(await c.campaignId(),report.campaignHash);assert.equal(await c.signer(),signer.address);
 console.log(JSON.stringify({contract:report.contract,signer:report.signer,campaignHash:report.campaignHash,deploymentBlock:deployed.block}));
}finally{rpc.destroy();}

