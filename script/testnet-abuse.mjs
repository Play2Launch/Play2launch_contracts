import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,Wallet,Contract,ContractFactory,parseEther,id} from 'ethers';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url), file=new URL('testnet-runs/abuse-20261019.json',root);
const rpc=new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com',undefined,{cacheTimeout:-1});
const secret=JSON.parse(await readFile(new URL('.secrets/wallets.json',root),'utf8'));
const wallets=Object.fromEntries(Object.entries(secret.wallets).map(([k,v])=>[k,new Wallet(v.privateKey,rpc)]));
const {admin,signer,buyerA:a,buyerB:b}=wallets;
const artifact=JSON.parse(await readFile(new URL('out/PhoodIDO.sol/PhoodIDO.json',root),'utf8'));
let report;try{report=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;}
report??={chain:46630,steps:{},checks:[],identities:'Isolated synthetic contract identities; browser account tests are separate'};
const save=()=>writeFile(file,JSON.stringify(report,null,2)+'\n');
async function step(name,fn){
 let r=report.steps[name];if(!r){const tx=await fn();r=report.steps[name]={hash:tx.hash};await save();console.log('SENT',name,tx.hash);}
 const receipt=await rpc.waitForTransaction(r.hash,2,120000);assert.equal(receipt.status,1);
 r.address=receipt.contractAddress;r.block=receipt.blockNumber;await save();return r;
}
async function rejects(name,fn,expected){
 try{await fn();assert.fail('Unexpected success: '+name)}catch(e){
  assert.equal(e.code,'CALL_EXCEPTION',name+' must be an EVM rejection, not a network error');
  const parsed=e.data?artifact.abi&&new Contract(report.contract,artifact.abi,rpc).interface.parseError(e.data):null;
  if(expected)assert.equal(parsed?.name,expected,name);
  report.checks.push({name,result:'rejected',error:parsed?.name,method:'testnet eth_call'});await save();console.log('PASS',name,parsed?.name);
 }
}
const types={Eligibility:[{name:'userId',type:'bytes32'},{name:'wallet',type:'address'},{name:'maxCents',type:'uint256'},{name:'deadline',type:'uint256'},{name:'epoch',type:'uint256'}]};
try{
 assert.equal((await rpc.getNetwork()).chainId,46630n);
 const usd=new Contract('0xBb062B32B6A1eB7697e4165788e856c340dab7ea',['function mint(address,uint256)','function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)'],admin);
 for(const [label,w]of[['a',a],['b',b]]){
  if(await rpc.getBalance(w.address)<parseEther('0.0002'))await step('fund-'+label,()=>admin.sendTransaction({to:w.address,value:parseEther('0.0005')}));
  await step('mint-'+label,()=>usd.mint(w.address,200n*1000000n));
 }
 const now=(await rpc.getBlock('latest')).timestamp;
 const d=await step('deploy',async()=>(await new ContractFactory(artifact.abi,artifact.bytecode.object,admin).deploy(admin.address,signer.address,admin.address,usd.target,id('abuse-fixture-20261019'),[now+5,now+7200,10000,200000,parseEther('100'),parseEther('200000'),parseEther('1000000')])).deploymentTransaction());
 report.contract=d.address;await save();const c=new Contract(d.address,artifact.abi,admin);
 const credential=async(user,w,overrides={},domainOverrides={})=>{
  const e={userId:id(user),wallet:w.address,maxCents:100000n,deadline:BigInt((await rpc.getBlock('latest')).timestamp+1800),epoch:await c.signerEpoch(),...overrides};
  const sig=await signer.signTypedData({name:'P2L IDO',version:'1',chainId:46630,verifyingContract:c.target,...domainOverrides},types,e);return[e,sig];
 };
 for(const [label,w]of[['a',a],['b',b]])await step('approve-'+label,()=>usd.connect(w).approve(c.target,200n*1000000n));
 const ca=await credential('abuse-user-a',a);
 await rejects('wallet B steals wallet A credential',()=>c.connect(b).subscribe.staticCall(10000,...ca),'InvalidIdentity');
 await rejects('expired credential',async()=>c.connect(a).subscribe.staticCall(10000,...await credential('abuse-user-a',a,{deadline:1n})),'ExpiredCredential');
 await rejects('wrong chain signature',async()=>c.connect(a).subscribe.staticCall(10000,...await credential('abuse-user-a',a,{}, {chainId:1})),'InvalidSignature');
 await step('subscribe-a',()=>c.connect(a).subscribe(10000,...ca));
 if(Number(await c.phase())===0){
  await rejects('same account switches to wallet B',async()=>c.connect(b).subscribe.staticCall(10000,...await credential('abuse-user-a',b)),'UserAlreadyBound');
  await rejects('wallet A switches to account B',async()=>c.connect(a).subscribe.staticCall(1,...await credential('abuse-user-b',a)),'WalletAlreadyBound');
  await rejects('refund before administrator enables',()=>c.connect(a).claimRefund.staticCall(),'RefundsNotOpen');
  await rejects('token claim before success',()=>c.connect(a).claimTokens.staticCall(),'NotSuccessful');
  await rejects('rebate claim before success',()=>c.connect(a).claimRebate.staticCall(),'NotSuccessful');
  await rejects('non-owner enables refund',()=>c.connect(b).openRefunds.staticCall(),'OwnableUnauthorizedAccount');
  await step('enable-refunds',()=>c.openRefunds());
 }
 await rejects('wallet B claims wallet A refund',()=>c.connect(b).claimRefund.staticCall(),'NothingToRefund');
 await step('refund-a',()=>c.connect(a).claimRefund());
 await rejects('double refund',()=>c.connect(a).claimRefund.staticCall(),'NothingToRefund');
 await rejects('refunded account claims tokens',()=>c.connect(a).claimTokens.staticCall(),'NotSuccessful');
 await rejects('refunded account claims rebate',()=>c.connect(a).claimRebate.staticCall(),'NotSuccessful');
 const successful=new Contract('0x2c1663f34A4Dc06F810FA86a7bF81CF8a04ae5A1',artifact.abi,admin);
 await rejects('wallet B claims another wallet tokens',()=>successful.connect(b).claimTokens.staticCall(),'NothingVested');
 await rejects('wallet B claims another wallet rebate',()=>successful.connect(b).claimRebate.staticCall(),'NothingToRebate');
 await rejects('double token claim',()=>successful.claimTokens.staticCall(),'NothingVested');
 await rejects('double rebate claim',()=>successful.claimRebate.staticCall(),'NothingToRebate');
 await rejects('successful account claims principal refund',()=>successful.claimRefund.staticCall(),'RefundsNotOpen');
 report.status='passed';await save();console.log('PASS',report.checks.length,'contract checks');
}finally{rpc.destroy();}
