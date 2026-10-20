import {configureTestVesting} from './vesting-config.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,Wallet,Contract} from 'ethers';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const file=new URL('testnet-runs/web-flow-20261019.json',root);
const report=JSON.parse(await readFile(file,'utf8'));
const rpc=new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com',undefined,{cacheTimeout:-1});
const save=()=>writeFile(file,JSON.stringify(report,null,2)+'\n');
try {
 assert.equal((await rpc.getNetwork()).chainId,46630n);
 const secret=JSON.parse(await readFile(new URL('.secrets/wallets.json',root),'utf8'));
 const admin=new Wallet(secret.wallets.admin.privateKey,rpc);
 const artifact=JSON.parse(await readFile(new URL('out/PhoodIDO.sol/PhoodIDO.json',root),'utf8'));
 const c=new Contract(report.contract,artifact.abi,admin);
 assert.equal(await c.campaignId(),report.campaignHash);
 assert.equal(await c.owner(),admin.address);
 async function step(label,send){
  let r=report.steps[label];
  if(!r){const tx=await send();r=report.steps[label]={hash:tx.hash};await save();}
  const receipt=await rpc.waitForTransaction(r.hash,2,120000);assert.equal(receipt.status,1);
  r.block=receipt.blockNumber;await save();console.log(label,r.hash);
 }
 if(process.argv[2]==='prepare'){
  const now=(await rpc.getBlock('latest')).timestamp;
  await step('web-test-end',()=>c.setSaleEnd(now+60));
  await step('web-test-vesting',()=>configureTestVesting(c,[now+900,0,120,30,1000]));
  console.log('saleEnd',String((await c.sale()).end));
 } else if(process.argv[2]==='settle') {
  assert.equal(await c.participantCount(),1n);
  const a=await c.accounts(admin.address);
  assert.equal(a.paidCents,10001n);
  // Score observed from the local test account's completed server-validated game.
  await step('web-test-rebate',()=>c.registerRebates([admin.address],[4250]));
  await step('web-test-lock',()=>c.lockRebates());
  await step('web-test-success',()=>c.finalizeSuccess());
  assert.equal((await c.accounts(admin.address)).rebateCents,2000n);
  console.log('phase',String(await c.phase()));
 } else if(process.argv[2]==='start-vesting') {
  assert.equal(await c.phase(),1n);
  const now=(await rpc.getBlock('latest')).timestamp;
  await step('web-test-short-vesting',()=>configureTestVesting(c,[now+60,0,120,30,1000]));
  console.log('vestingStart',String((await c.vesting()).start));
 } else if(process.argv[2]==='verify-rebate') {
  const receipt=await rpc.getTransactionReceipt('0xd4c4f97c601ea2acc7f129a5d537e2891952546fbf5f5f99d73fc727a115b8a1');
  assert.equal(receipt.status,1);
  const token=new Contract('0xBb062B32B6A1eB7697e4165788e856c340dab7ea',['event Transfer(address indexed from,address indexed to,uint256 value)'],rpc);
  const transfers=receipt.logs.flatMap(l=>{try{return [token.interface.parseLog(l)]}catch{return []}}).filter(Boolean);
  assert.ok(transfers.some(t=>t.args.from.toLowerCase()===report.contract.toLowerCase()&&t.args.to===admin.address&&t.args.value===20000000n));
  assert.equal((await c.accounts(admin.address)).rebateClaimed,true);
  await assert.rejects(c.claimRebate.staticCall());
  report.webRebate={hash:receipt.hash,cents:2000,duplicateRejected:true};await save();
  console.log('20 Mock USDT transfer verified; duplicate claim rejected');
 } else throw new Error('Use prepare, settle, start-vesting or verify-rebate');
} finally {rpc.destroy();}
