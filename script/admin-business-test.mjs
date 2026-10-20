import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,Wallet,Contract,ContractFactory,parseEther,id} from 'ethers';
import assert from 'node:assert/strict';
// Only fixture deployment, buyer actions and read-only assertions. Admin actions are performed in the UI.
const root=new URL('../',import.meta.url);
const rpc=new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com',undefined,{cacheTimeout:-1});
assert.equal((await rpc.getNetwork()).chainId,46630n);
const secret=JSON.parse(await readFile(new URL('.secrets/wallets.json',root),'utf8'));
const wallets=Object.fromEntries(Object.entries(secret.wallets).map(([k,v])=>[k,new Wallet(v.privateKey,rpc)]));
const {admin,signer,buyerA,buyerB}=wallets;
const artifact=JSON.parse(await readFile(new URL('out/PhoodIDO.sol/PhoodIDO.json',root),'utf8'));
const file=new URL('testnet-runs/admin-business.json',root);
const serial=v=>JSON.stringify(v,(_,v)=>typeof v==='bigint'?v.toString():v,2);
let report;
try{report=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
report??={chainId:46630,steps:{},checks:[],startedAt:new Date().toISOString()};
const save=()=>writeFile(file,serial(report)+'\n');
const now=async()=>BigInt((await rpc.getBlock('latest')).timestamp);
const usd=new Contract('0xBb062B32B6A1eB7697e4165788e856c340dab7ea',['function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)'],admin);
const token=new Contract('0x39A717B283A51b7b270f6cbFC4C75d84b64277D8',['function transfer(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)'],admin);
async function step(label,submit){
 let r=report.steps[label];
 if(!r){const tx=await submit();r=report.steps[label]={hash:tx.hash};await save();}
 const receipt=await rpc.waitForTransaction(r.hash,1,120000);assert.equal(receipt.status,1);
 Object.assign(r,{address:receipt.contractAddress,block:receipt.blockNumber});await save();console.log(label,r.hash);return r;
}
async function check(label,fn){await fn();if(!report.checks.includes(label))report.checks.push(label);await save();console.log('PASS',label);}
async function rejects(fn){await assert.rejects(fn,e=>e.code==='CALL_EXCEPTION');}
async function buy(c,w,cents,label){
 const e={userId:id(`admin-business-${w.address}`),wallet:w.address,maxCents:100000n,deadline:await now()+3600n,epoch:await c.signerEpoch()};
 const sig=await signer.signTypedData({name:'P2L IDO',version:'1',chainId:46630,verifyingContract:c.target},{Eligibility:[{name:'userId',type:'bytes32'},{name:'wallet',type:'address'},{name:'maxCents',type:'uint256'},{name:'deadline',type:'uint256'},{name:'epoch',type:'uint256'}]},e);
 await step(`${label}-approve`,()=>usd.connect(w).approve(c.target,cents*10000n));
 await step(label,()=>c.connect(w).subscribe(cents,e,sig));
}
const mode=process.argv[2];
if(mode==='prepare'){
 for(const role of ['success','refund']){
  const r=await step(`deploy-${role}`,async()=>{
   const start=await now()+(role==='success'?86400n:30n);
   return (await new ContractFactory(artifact.abi,artifact.bytecode.object,admin).deploy(admin.address,signer.address,admin.address,usd.target,id(`admin-business-${role}`),[start,start+86400n,20000n,100000n,parseEther('100'),parseEther('100000'),parseEther('1000000')])).deploymentTransaction();
  });report[role]=r.address;await save();
 }
 console.log(serial({success:report.success,refund:report.refund}));
}else{
 const success=new Contract(report.success,artifact.abi,admin),refund=new Contract(report.refund,artifact.abi,admin);
 if(mode==='buy-success'){
  await check('UI sale terms, token binding and vesting persisted',async()=>{
   const s=await success.sale(),v=await success.vesting();
   assert.equal(s.softCapCents,20000n);assert.equal(s.hardCapCents,200000n);assert.equal(s.saleAllocation,parseEther('200000'));
   assert.equal(await success.saleToken(),token.target);assert.equal(v.initialBps,1000n);assert.equal(v.duration,60n);assert.equal(v.interval,10n);
   await rejects(()=>success.configureSale.staticCall(Array.from(s)));
  });
  const start=(await success.sale()).start;
  let remaining=start-await now();
  assert(remaining<600n,'Start is too far away; configure the test window in Admin first');
  while(remaining>0n){console.log('Waiting for configured sale start:',remaining.toString(),'seconds');await new Promise(r=>setTimeout(r,Math.min(Number(remaining)*1000,30000)));remaining=start-await now();}
  await buy(success,buyerA,10001n,'success-A');await buy(success,buyerB,15000n,'success-B');
  await step('fund-sale-token',()=>token.transfer(success.target,parseEther('30000')));
  await check('success subscriptions $250.01 and 25001 tokens',async()=>{assert.equal(await success.totalPaidCents(),25001n);assert.equal(await success.totalAllocatedTokens(),parseEther('25001'));});
  await check('pending principal cannot be withdrawn',()=>rejects(()=>success.withdrawSurplus.staticCall(usd.target,1n)));
 }else if(mode==='buy-refund'){
  await buy(refund,buyerA,10001n,'refund-A');
  await check('refund unavailable before admin opens',()=>rejects(()=>refund.connect(buyerA).claimRefund.staticCall()));
 }else if(mode==='verify-success'){
  await check('UI success settlement and rebates $20 plus $10',async()=>{assert.equal(await success.phase(),1n);assert.equal(await success.rebatesLocked(),true);assert.equal(await success.totalRebateCents(),3000n);});
  await check('rebate reserves intact after surplus withdrawals',async()=>{assert.equal(await usd.balanceOf(success.target),30000000n);assert.equal(await token.balanceOf(success.target),parseEther('25001'));await rejects(()=>success.withdrawSurplus.staticCall(usd.target,1n));await rejects(()=>success.withdrawSurplus.staticCall(token.target,1n));});
  for(const [role,w,cents] of [['A',buyerA,2000n],['B',buyerB,1000n]]){
   if(!report.steps[`claim-rebate-${role}`]){report[`balanceBefore${role}`]=(await usd.balanceOf(w.address)).toString();await save();}
   await step(`claim-rebate-${role}`,()=>success.connect(w).claimRebate());
   await check(`buyer ${role} received exact rebate`,async()=>assert.equal(await usd.balanceOf(w.address)-BigInt(report[`balanceBefore${role}`]),cents*10000n));
  }
  await check('rebates cannot repeat; success cannot refund',async()=>{await rejects(()=>success.connect(buyerA).claimRebate.staticCall());await rejects(()=>success.openRefunds.staticCall());});
 }else if(mode==='verify-refund'){
  await check('UI opened collective refunds',async()=>assert.equal(await refund.phase(),2n));
  await check('refund principal remains reserved',async()=>{assert.equal(await usd.balanceOf(refund.target),100010000n);await rejects(()=>refund.withdrawSurplus.staticCall(usd.target,1n));});
  if(!report.steps['claim-refund']){report.refundBalanceBefore=(await usd.balanceOf(buyerA.address)).toString();await save();}
  await step('claim-refund',()=>refund.connect(buyerA).claimRefund());
  await check('full $100.01 refund received and cannot repeat',async()=>{assert.equal(await usd.balanceOf(buyerA.address)-BigInt(report.refundBalanceBefore),100010000n);await rejects(()=>refund.connect(buyerA).claimRefund.staticCall());});
 }else if(mode==='finish'){
  assert(report.checks.includes('buyer B received exact rebate'));
  assert(report.checks.includes('full $100.01 refund received and cannot repeat'));
  report.uiTransactions=[];
  for(const [role,c] of [['success',success],['refund',refund]]){
   for(const log of await c.queryFilter('*',report.steps[`deploy-${role}`].block,'latest')){
    const name=log.fragment?.name;
    if(['SaleConfigured','SaleEndChanged','TokenBound','VestingConfigured','RebateRegistered','RebatesLocked','PhaseChanged','SurplusWithdrawn'].includes(name))report.uiTransactions.push({contract:c.target,event:name,hash:log.transactionHash,block:log.blockNumber});
   }
  }
  report.status='passed';report.finishedAt=new Date().toISOString();await save();console.log('PASS admin business workflow; report saved');
 }else if(mode==='status'){
  console.log(serial({now:await now(),success:report.success,refund:report.refund,sale:(await success.sale()).toObject(),vesting:(await success.vesting()).toObject(),phase:await success.phase(),token:await success.saleToken(),registered:await success.registeredCount(),locked:await success.rebatesLocked(),paymentBalance:await usd.balanceOf(success.target),tokenBalance:await token.balanceOf(success.target),refundPhase:await refund.phase()}));
 }else throw new Error('Unknown mode');
}
