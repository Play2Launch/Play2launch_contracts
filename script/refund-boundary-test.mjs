import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,Wallet,Contract,ContractFactory,parseEther,id} from 'ethers';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),file=new URL('testnet-runs/refund-boundary.json',root);
const rpc=new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com',undefined,{cacheTimeout:-1});
const keys=JSON.parse(await readFile(new URL('.secrets/wallets.json',root),'utf8'));
const buyers=JSON.parse(await readFile(new URL('.secrets/boundary-wallets.json',root),'utf8'));
const admin=new Wallet(keys.wallets.admin.privateKey,rpc),signer=new Wallet(keys.wallets.signer.privateKey);
const live=new Wallet(buyers.wallets.live.privateKey,rpc),gmail=new Wallet(buyers.wallets.gmail.privateKey,rpc),outsider=new Wallet(buyers.wallets.outsider.privateKey,rpc);
const artifact=JSON.parse(await readFile(new URL('out/PhoodIDO.sol/PhoodIDO.json',root),'utf8'));
let report;try{report=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;}
report??={campaignID:'cp2dy0zrr8kp34',slug:'marketcombo-refund-test',chainId:46630,steps:{},checks:[],note:'Script-funded contract fixture; does not represent Web game eligibility verification.'};
const save=()=>writeFile(file,JSON.stringify(report,null,2)+'\n');
async function step(name,send){let s=report.steps[name];if(!s){const tx=await send();s=report.steps[name]={hash:tx.hash};await save();console.log('SENT',name,tx.hash);}const receipt=await rpc.waitForTransaction(s.hash,2,120000);assert.equal(receipt.status,1);Object.assign(s,{address:receipt.contractAddress,block:receipt.blockNumber});await save();return s;}
try{
 assert.equal((await rpc.getNetwork()).chainId,46630n);
 const usd=new Contract('0xBb062B32B6A1eB7697e4165788e856c340dab7ea',['function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)'],rpc);
 const now=(await rpc.getBlock('latest')).timestamp+10;
 const d=await step('deploy',async()=>(await new ContractFactory(artifact.abi,artifact.bytecode.object,admin).deploy(admin.address,signer.address,admin.address,usd.target,id(report.campaignID),[now,now+86400,10000,20001,parseEther('100'),parseEther('20001'),parseEther('1000000')])).deploymentTransaction());
 report.contract=d.address;await save();const c=new Contract(d.address,artifact.abi,admin);
 const types={Eligibility:[{name:'userId',type:'bytes32'},{name:'wallet',type:'address'},{name:'maxCents',type:'uint256'},{name:'deadline',type:'uint256'},{name:'epoch',type:'uint256'}]};
 async function proof(user,w){const e={userId:id(user),wallet:w.address,maxCents:100000n,deadline:BigInt((await rpc.getBlock('latest')).timestamp+3600),epoch:await c.signerEpoch()};return[e,await signer.signTypedData({name:'P2L IDO',version:'1',chainId:46630,verifyingContract:c.target},types,e)];}
 async function rejects(name,fn,expected){try{await fn();assert.fail(name+' unexpectedly succeeded')}catch(e){assert.equal(e.code,'CALL_EXCEPTION');assert.equal(c.interface.parseError(e.data)?.name,expected);report.checks.push({name,error:expected,method:'testnet eth_call'});await save();console.log('PASS',name);}}
 if(Number(await c.phase())===0){
  await step('approve-live',()=>usd.connect(live).approve(c.target,100010000n));
  const lp=await proof('ur2aay4pi3stmo',live);
  await step('subscribe-live',()=>c.connect(live).subscribe(10001,...lp));
  await step('approve-gmail',()=>usd.connect(gmail).approve(c.target,100000000n));
  const gp=await proof('ur2dgglpvzjeo0',gmail);
  if(!report.steps['subscribe-gmail'])await rejects('one cent above remaining hard cap',()=>c.connect(gmail).subscribe.staticCall(10001,...gp),'HardCap');
  await step('subscribe-gmail',()=>c.connect(gmail).subscribe(10000,...gp));
  assert.equal(await c.totalPaidCents(),20001n);
  await rejects('one cent after exact hard cap',()=>c.connect(live).subscribe.staticCall(1,...lp),'HardCap');
  await rejects('refund before opening',()=>c.connect(live).claimRefund.staticCall(),'RefundsNotOpen');
  await rejects('non-admin opens refunds',()=>c.connect(outsider).openRefunds.staticCall(),'OwnableUnauthorizedAccount');
  await step('open-refunds',()=>c.openRefunds());
 }
 await rejects('admin cannot withdraw reserved principal',()=>c.withdrawSurplus.staticCall(usd.target,1),'ReservedFunds');
 await rejects('unrelated wallet cannot refund',()=>c.connect(outsider).claimRefund.staticCall(),'NothingToRefund');
 const before=await usd.balanceOf(gmail.address);
 const already=(await c.accounts(gmail.address)).refunded;
 await step('refund-gmail',()=>c.connect(gmail).claimRefund());
 if(!already)assert.equal(await usd.balanceOf(gmail.address)-before,100000000n);
 await rejects('duplicate refund',()=>c.connect(gmail).claimRefund.staticCall(),'NothingToRefund');
 await rejects('refund and token claim mutually exclusive',()=>c.connect(gmail).claimTokens.staticCall(),'NotSuccessful');
 await rejects('refund and rebate mutually exclusive',()=>c.connect(gmail).claimRebate.staticCall(),'NotSuccessful');
 assert.equal(await c.reservedPayment(),100010000n);
 report.status='contract checks passed; live wallet $100.01 refund reserved for Web';await save();console.log(JSON.stringify({contract:report.contract,checks:report.checks.length,status:report.status}));
}finally{rpc.destroy();}
