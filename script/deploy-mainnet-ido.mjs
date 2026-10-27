import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {JsonRpcProvider,Wallet,ContractFactory,Contract,parseEther,formatEther,keccak256,getCreateAddress,ZeroAddress} from 'ethers';
import {updateDeployedContracts} from './update-deployed-contracts.mjs';

// Approved mainnet sale: 2026-10-19 21:40 America/Vancouver, seven days.
// Only deploys the IDO; does not bind/fund PHOOD or select a TGE date.
const root=new URL('../',import.meta.url);
const directory=new URL('deployments/4663/ido-paperhood/',root);
const recordFile=new URL('deployment.json',directory);
const signedFile=new URL('.secrets/mainnet-ido-paperhood-deployment-tx.txt',root);
const deployer='0xD083f0d09ed4234B92bC8D1607E1fE7550AC7882';
const admin='0xE92Fc761286F8b4c83E9F7d9E47D4B0045653154';
const signer='0x4712Af8D8FC28b4378087452E8Ffa3C03ba51A63';
const treasury='0x35A25D464e8bfC92f66665d6aB019Fc71Aae1271';
const payment='0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const campaign='0xadb590c1da4993e4b0e76e0433bd09d03cbda23ccbac810a92a2066a2bbd81c4';
const start=BigInt(Date.parse('2026-10-20T04:40:00Z')/1000),end=start+7n*86400n;
const sale=[start,end,1000000n,5000000n,parseEther('4000'),parseEther('200000000'),parseEther('1000000000')];
const args=[admin,signer,treasury,payment,campaign,sale];
const provider=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',undefined,{cacheTimeout:-1});
const broadcast=process.argv.includes('--broadcast');
let record;
const save=async()=>{const temp=new URL('deployment.json.tmp',directory);await writeFile(temp,JSON.stringify(record,null,2)+'\n');await rename(temp,recordFile);};
function normalizeRuntime(code,refs){const bytes=Buffer.from(code.replace(/^0x/,''),'hex');for(const entries of Object.values(refs??{}))for(const {start,length} of entries)bytes.fill(0,start,start+length);return bytes.toString('hex');}
try{
 assert.equal((await provider.getNetwork()).chainId,4663n);
 const secret=JSON.parse(await readFile(new URL('.secrets/mainnet-deployer.json',root),'utf8'));
 const wallet=new Wallet(secret.privateKey,provider);assert.equal(wallet.address,deployer);
 const artifact=JSON.parse(await readFile(new URL('out/PhoodIDO.sol/PhoodIDO.json',root),'utf8'));
 assert.equal(artifact.metadata.compiler.version,'0.8.30+commit.73712a01');
 assert.equal(artifact.metadata.settings.optimizer.runs,1);assert.equal(artifact.metadata.settings.viaIR,true);
 assert((artifact.deployedBytecode.object.length-2)/2<=24576,'Runtime size exceeds EIP-170');
 const sources={};
 for(const [path,meta] of Object.entries(artifact.metadata.sources)){
  // Foundry normalizes Windows line endings before sending sources to solc.
  const raw=await readFile(new URL(path,root));
  const compiled=keccak256(raw)===meta.keccak256?raw:Buffer.from(raw.toString('utf8').replaceAll('\r\n','\n'));
  assert.equal(keccak256(compiled),meta.keccak256,`Stale artifact: ${path}`);sources[path]={content:compiled.toString('utf8')};
 }
 const factory=new ContractFactory(artifact.abi,artifact.bytecode.object,wallet);
 const encoded=factory.interface.encodeDeploy(args);
 try{record=JSON.parse(await readFile(recordFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!record){
  const usd=new Contract(payment,['function decimals() view returns(uint8)','function symbol() view returns(string)'],provider);
  assert.equal(await usd.symbol(),'USDG');assert.equal(await usd.decimals(),6n);
  const block=await provider.getBlock('latest');assert(BigInt(block.timestamp)+60n<start,'Start is too close or passed; request a new authorized time');
  assert.equal(await provider.getTransactionCount(deployer,'pending'),await provider.getTransactionCount(deployer,'latest'),'Deployer has a pending transaction');
  const request=await factory.getDeployTransaction(...args);
  const gas=await provider.estimateGas({...request,from:deployer});
  const tx=await wallet.populateTransaction({...request,gasLimit:gas*120n/100n});
  const maxCost=tx.gasLimit*(tx.maxFeePerGas??tx.gasPrice);
  assert(maxCost<parseEther('0.005'),'Deployment fee exceeds ceiling');assert((await provider.getBalance(deployer))>=maxCost,'Insufficient ETH');
  console.log(JSON.stringify({chainId:4663,admin,signer,treasury,payment,campaign,startUTC:new Date(Number(start)*1000).toISOString(),endUTC:new Date(Number(end)*1000).toISOString(),estimatedGas:gas.toString(),maximumFeeETH:formatEther(maxCost),broadcast}));
  if(!broadcast)process.exitCode=0;
  else{
   const signed=await wallet.signTransaction(tx);
   record={network:'Robinhood Chain mainnet',chainId:4663,name:'PAPERHOOD IDO',deployer,admin,signer,fundsTreasury:treasury,paymentToken:payment,campaignId:campaign,sale:sale.map(String),startUTC:new Date(Number(start)*1000).toISOString(),endUTC:new Date(Number(end)*1000).toISOString(),timeZone:'America/Vancouver',issuePrice:'0.00025 USDG per PHOOD',contractAddress:getCreateAddress({from:deployer,nonce:tx.nonce}),transactionHash:keccak256(signed),nonce:tx.nonce,status:'prepared',createdAt:new Date().toISOString(),maximumFeeETH:formatEther(maxCost),constructorArguments:encoded,compiler:artifact.metadata.compiler,compilerSettings:artifact.metadata.settings,verification:{status:'pending'},notes:['IDO 合约，支付币 USDG；软顶 10,000，硬顶 50,000。','发行价格 0.00025 USDG/PHOOD；销售份额 200,000,000 PHOOD。','认购时间：温哥华 2026-10-19 21:40 至 2026-10-26 21:40。','仅部署；PHOOD 绑定、注资及 TGE/Vesting 配置需另行完成。']};
   await mkdir(directory,{recursive:true});
   await writeFile(new URL('artifact.json',directory),JSON.stringify(artifact,null,2)+'\n',{flag:'wx'});
   const settings={...artifact.metadata.settings};delete settings.compilationTarget;
   await writeFile(new URL('standard-input.json',directory),JSON.stringify({language:'Solidity',sources,settings},null,2)+'\n',{flag:'wx'});
   await writeFile(new URL('constructor-arguments.txt',directory),encoded.slice(2)+'\n',{flag:'wx'});
   await writeFile(signedFile,signed+'\n',{flag:'wx',mode:0o600});await save();
  }
 }
 if(record){
  assert.equal(record.constructorArguments,encoded,'Journal terms differ');
  let receipt=await provider.getTransactionReceipt(record.transactionHash);
  if(!receipt&&broadcast){
   if(!await provider.getTransaction(record.transactionHash)){
    const block=await provider.getBlock('latest');assert(BigInt(block.timestamp)+30n<start,'Start too close; do not broadcast');
    const signed=(await readFile(signedFile,'utf8')).trim();assert.equal(keccak256(signed),record.transactionHash);
    const sent=await provider.broadcastTransaction(signed);assert.equal(sent.hash,record.transactionHash);record.status='broadcast';await save();console.log('BROADCAST',sent.hash);
   }
   receipt=await provider.waitForTransaction(record.transactionHash,2,180000);
  }
  assert(receipt,'Pending transaction; rerun this script, never deploy another copy');assert.equal(receipt.status,1,'Deployment reverted');
  const ido=new Contract(record.contractAddress,artifact.abi,provider);
  assert.equal((await ido.owner()).toLowerCase(),admin.toLowerCase());assert.equal((await ido.signer()).toLowerCase(),signer.toLowerCase());assert.equal((await ido.treasury()).toLowerCase(),treasury.toLowerCase());assert.equal((await ido.paymentToken()).toLowerCase(),payment.toLowerCase());assert.equal(await ido.campaignId(),campaign);
  assert.deepEqual(Array.from(await ido.sale()),sale);assert.equal(await ido.saleToken(),ZeroAddress);assert.equal(await ido.phase(),0n);assert.equal(await ido.totalPaidCents(),0n);assert.equal(await ido.paymentUnitsPerCent(),10000n);
  const code=await provider.getCode(record.contractAddress);assert.equal(normalizeRuntime(code,artifact.deployedBytecode.immutableReferences),normalizeRuntime(artifact.deployedBytecode.object,artifact.deployedBytecode.immutableReferences),'Runtime differs outside compiler immutable slots');
  Object.assign(record,{status:'deployed',blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed.toString(),transactionFeeETH:formatEther(receipt.fee),runtimeBytes:(code.length-2)/2,checkedAt:new Date().toISOString(),explorer:`https://robinhoodchain.blockscout.com/address/${record.contractAddress}`,checks:['owner','signer','treasury','USDG address and decimals','campaign identity','all seven sale fields','pending phase','no token binding','zero subscribed','runtime bytecode except compiler immutable slots']});await save();await updateDeployedContracts();console.log('DEPLOYED AND CHECKED',JSON.stringify({address:record.contractAddress,block:record.blockNumber,feeETH:record.transactionFeeETH}));
 }
}catch(e){console.error(e.shortMessage||e.message);process.exitCode=1;}finally{provider.destroy();}
