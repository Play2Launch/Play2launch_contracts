import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {JsonRpcProvider,Wallet,Contract,parseEther,formatEther,keccak256,ZeroAddress} from 'ethers';
const base=new URL('../',import.meta.url),dir=new URL('deployments/4663/ido-paperhood/',base);
const r=JSON.parse(await readFile(new URL('deployment.json',dir)));
const artifact=JSON.parse(await readFile(new URL('artifact.json',dir)));
const tokenRecord=JSON.parse(await readFile(new URL('deployments/4663/phood/deployment.json',base)));
const provider=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',undefined,{cacheTimeout:-1});
const deployer=new Wallet(JSON.parse(await readFile(new URL('.secrets/mainnet-deployer.json',base))).privateKey,provider);
const admin=new Wallet(JSON.parse(await readFile(new URL('.secrets/mainnet-ido-wallets.json',base))).wallets.adminA.privateKey,provider);
const ido=new Contract(r.contractAddress,artifact.abi,admin);
const token=new Contract(tokenRecord.contractAddress,['function balanceOf(address) view returns(uint256)','function totalSupply() view returns(uint256)','function decimals() view returns(uint8)','function transfer(address,uint256) returns(bool)'],deployer);
const journalFile=new URL('funding.json',dir);let journal={steps:{}};
try{journal=JSON.parse(await readFile(journalFile));}catch(e){if(e.code!=='ENOENT')throw e;}
const save=()=>writeFile(journalFile,JSON.stringify(journal,null,2)+'\n');
const broadcast=process.argv.includes('--broadcast');
async function send(name,wallet,request){
 let step=journal.steps[name];
 if(!step){
  assert.equal(await provider.getTransactionCount(wallet.address,'pending'),await provider.getTransactionCount(wallet.address,'latest'),'Pending wallet transaction');
  const gas=await provider.estimateGas({...request,from:wallet.address});
  const tx=await wallet.populateTransaction({...request,gasLimit:gas*120n/100n});
  assert(tx.gasLimit*(tx.maxFeePerGas??tx.gasPrice)<parseEther('0.001'),'Fee ceiling exceeded');
  const signed=await wallet.signTransaction(tx);
  await writeFile(new URL(`.secrets/mainnet-ido-${name}.signed`,base),signed,{flag:'wx'});
  step=journal.steps[name]={hash:keccak256(signed),status:'prepared'};await save();
 }
 let receipt=await provider.getTransactionReceipt(step.hash);
 if(!receipt){
  if(!await provider.getTransaction(step.hash)){
   const signed=await readFile(new URL(`.secrets/mainnet-ido-${name}.signed`,base),'utf8');assert.equal(keccak256(signed),step.hash);
   await provider.broadcastTransaction(signed);console.log(name,step.hash);
  }
  receipt=await provider.waitForTransaction(step.hash,2,180000);
 }
 assert(receipt&&receipt.status===1,`${name} failed or pending; inspect journal`);
 Object.assign(step,{status:'confirmed',blockNumber:receipt.blockNumber,feeETH:formatEther(receipt.fee)});await save();
}
try{
 assert.equal((await provider.getNetwork()).chainId,4663n);assert.equal(admin.address,r.admin);assert.equal(deployer.address,r.deployer);
 assert.equal((await ido.owner()).toLowerCase(),admin.address.toLowerCase());assert.equal(await ido.campaignId(),r.campaignId);assert.equal(await ido.phase(),0n);
 const sale=await ido.sale();assert.equal(sale.saleAllocation,parseEther('200000000'));assert.equal(await token.totalSupply(),parseEther('1000000000'));assert.equal(await token.decimals(),18n);
 const bound=await ido.saleToken();assert(bound===ZeroAddress||bound.toLowerCase()===token.target.toLowerCase());
 const balance=await token.balanceOf(ido.target),available=await token.balanceOf(deployer.address),adminETH=await provider.getBalance(admin.address);
 assert(balance<=sale.saleAllocation);assert(available>=sale.saleAllocation-balance);
 console.log(JSON.stringify({ido:ido.target,token:token.target,bound,idoPHOOD:formatEther(balance),deployerPHOOD:formatEther(available),targetPHOOD:formatEther(sale.saleAllocation),adminETH:formatEther(adminETH),broadcast}));
 if(broadcast){
  if(bound===ZeroAddress){
   if(adminETH<parseEther('0.0001'))await send('admin-gas',deployer,{to:admin.address,value:parseEther('0.0003')});
   await send('bind-token',admin,await ido.bindToken.populateTransaction(token.target));
  }
  assert.equal((await ido.saleToken()).toLowerCase(),token.target.toLowerCase());
  if(journal.steps['fund-token'])await send('fund-token',deployer,{});
  else if(balance<sale.saleAllocation)await send('fund-token',deployer,await token.transfer.populateTransaction(ido.target,sale.saleAllocation-balance));
  assert.equal(await token.balanceOf(ido.target),sale.saleAllocation);
  journal.ido=ido.target;journal.token=token.target;journal.fundedPHOOD=formatEther(sale.saleAllocation);journal.checkedAt=new Date().toISOString();await save();
  r.notes=r.notes.filter(n=>!n.startsWith('仅部署'));r.notes.push('已绑定 PHOOD 并注资 200,000,000 PHOOD；TGE/Vesting 待确认配置。');r.funding={token:token.target,amountPHOOD:journal.fundedPHOOD,record:'funding.json'};await writeFile(new URL('deployment.json',dir),JSON.stringify(r,null,2)+'\n');
  console.log('BINDING AND FUNDING VERIFIED',JSON.stringify(journal));
 }
}finally{provider.destroy();}
