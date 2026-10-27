import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,open,unlink,rename} from 'node:fs/promises';
import {AbiCoder,Contract,ContractFactory,JsonRpcProvider,Wallet,ZeroHash,formatEther,getCreateAddress,id,keccak256,getAddress,ZeroAddress,parseEther} from 'ethers';
import {updateDeployedContracts} from './update-deployed-contracts.mjs';

// Public deployment configuration; keys and signed transactions remain in .secrets/.
const base=new URL('../',import.meta.url);
const configArg=process.argv.find(a=>a.startsWith('--config='))?.slice(9);
assert(configArg,'Usage: node script/deploy-airdrop.mjs --config=config/airdrop.json [--dry-run]');
const cfg=JSON.parse(await readFile(configArg,'utf8'));
assert([4663,46630].includes(cfg.chainId),'chainId must be Robinhood mainnet 4663 or testnet 46630');
assert(/^[a-z0-9][a-z0-9-]{0,63}$/.test(cfg.deploymentName),'deploymentName must be a unique lowercase directory name');
assert(typeof cfg.campaignHash==='string' && /^0x[0-9a-f]{64}$/i.test(cfg.campaignHash) && cfg.campaignHash!==ZeroHash,'Copy campaignHash from the activity airdrop editor');
const campaignHash=cfg.campaignHash.toLowerCase();
if(cfg.campaignID)assert.equal(id('p2l-airdrop-v1:'+cfg.campaignID),campaignHash,'campaignID does not match campaignHash');
const campaignID=cfg.campaignID||'';
const tokenAddress=getAddress(cfg.token),owner=getAddress(cfg.admin),signer=getAddress(cfg.signer),deployer=getAddress(cfg.deployer);
for(const address of [tokenAddress,owner,signer,deployer])assert.notEqual(address,ZeroAddress);
assert(typeof cfg.keyFile==='string' && /^\.secrets\/[a-zA-Z0-9_-]+\.json$/.test(cfg.keyFile),'keyFile must be a JSON file directly inside .secrets/');
const feeCap=parseEther(String(cfg.maxFeeETH));assert(feeCap>0n,'maxFeeETH must be positive');
const network=cfg.chainId===4663?'Robinhood Chain':'Robinhood Chain testnet';
const rpc=cfg.chainId===4663?'https://rpc.mainnet.chain.robinhood.com':'https://rpc.testnet.chain.robinhood.com';
const explorer=cfg.chainId===4663?'https://robinhoodchain.blockscout.com':'https://explorer.testnet.chain.robinhood.com';
const directory=new URL(`deployments/${cfg.chainId}/${cfg.deploymentName}/`,base);
const journal=new URL('deployment.json',directory);
const signedFile=new URL(`.secrets/airdrop-${cfg.chainId}-${cfg.deploymentName}.signed`,base);
if(process.argv.includes('--dry-run')){
 console.log(JSON.stringify({chainId:cfg.chainId,network,campaignHash,token:tokenAddress,admin:owner,signer,deployer,record:journal.pathname,maxFeeETH:cfg.maxFeeETH},null,2));
 process.exit(0);
}
await mkdir(directory,{recursive:true});
const lockFile=new URL('deploy.lock',directory);
const lock=await open(lockFile,'wx'); // Refuse simultaneous deployments using the same journal.
const provider=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1});
try {
  assert.equal((await provider.getNetwork()).chainId,BigInt(cfg.chainId));
  const secret=JSON.parse(await readFile(new URL(cfg.keyFile,base),'utf8'));
  const admin=new Wallet(secret.privateKey,provider);
  assert.equal(admin.address,deployer,'Key file does not match configured deployer');
  const artifact=JSON.parse(await readFile(new URL('out/P2LAirdrop.sol/P2LAirdrop.json',base),'utf8'));
  const args=[owner,campaignHash,tokenAddress,signer];
  const token=new Contract(tokenAddress,['function symbol() view returns(string)','function decimals() view returns(uint8)'],provider);
  const symbol=await token.symbol();const decimals=Number(await token.decimals());
  assert.notEqual(await provider.getCode(tokenAddress),'0x');
  await mkdir(directory,{recursive:true});
  let record;
  try {record=JSON.parse(await readFile(journal,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const save=async()=>{const temp=new URL('deployment.json.tmp',directory);await writeFile(temp,JSON.stringify(record,null,2)+'\n');await rename(temp,journal)};
  if(!record){
    const factory=new ContractFactory(artifact.abi,artifact.bytecode.object,admin);
    const request=await factory.getDeployTransaction(...args);
    const gas=await provider.estimateGas({...request,from:admin.address});
    const tx=await admin.populateTransaction({...request,gasLimit:gas*120n/100n});
    const maxFee=tx.gasLimit*(tx.maxFeePerGas??tx.gasPrice);
    assert(maxFee<=feeCap,'Deployment exceeds configured maxFeeETH');
    assert((await provider.getBalance(admin.address))>=maxFee,'Insufficient ETH for deployment');
    const signed=await admin.signTransaction(tx);
    await writeFile(signedFile,signed,{mode:0o600});
    record={name:cfg.name||'P2L Airdrop',network,chainId:cfg.chainId,status:'prepared',campaignID,campaignSlug:cfg.campaignSlug||'',campaignId:campaignHash,token:tokenAddress,symbol,decimals,deployer:admin.address,admin:owner,signer,contractAddress:getCreateAddress({from:admin.address,nonce:tx.nonce}),transactionHash:keccak256(signed),nonce:tx.nonce,maximumFeeETH:formatEther(maxFee),createdAt:new Date().toISOString(),constructorArguments:AbiCoder.defaultAbiCoder().encode(['address','bytes32','address','address'],args),compiler:artifact.metadata.compiler,verification:{status:'pending'},notes:['空投合约绑定指定活动标识。部署不会结算、注资或开放领取。']};
    await save();
  }
  assert.equal(record.chainId,cfg.chainId);assert.equal(record.campaignId,campaignHash);assert.equal(record.admin,owner);assert.equal(record.deployer,admin.address);assert.equal(record.signer,signer);assert.equal(record.token,tokenAddress);
  let receipt=await provider.getTransactionReceipt(record.transactionHash);
  if(!receipt){
    const pending=await provider.getTransaction(record.transactionHash);
    if(!pending){const signed=(await readFile(signedFile,'utf8')).trim();assert.equal(keccak256(signed),record.transactionHash);await provider.broadcastTransaction(signed);}
    console.log('Submitted:',record.transactionHash);
    receipt=await provider.waitForTransaction(record.transactionHash,2,120000);
  } else {await provider.waitForTransaction(record.transactionHash,2,120000);}
  assert(receipt&&receipt.status===1,'Deployment failed or not confirmed');
  assert.equal(receipt.contractAddress,record.contractAddress);
  const c=new Contract(record.contractAddress,artifact.abi,provider);
  assert.equal(await c.version(),1n);if(record.status!=='deployed')assert.equal(await c.owner(),owner);assert.equal(await c.campaignHash(),campaignHash);assert.equal(await c.token(),tokenAddress);assert.equal(await c.signer(),signer);
  assert.notEqual(await provider.getCode(c.target),'0x');
  // Check initial state only on first completion; reruns must preserve later admin configuration.
  if(record.status!=='deployed'){assert.equal(await c.root(),ZeroHash);assert.equal(await c.opened(),false);assert.equal(await c.closed(),false);assert.equal(await c.deadline(),0n);}
  Object.assign(record,{status:'deployed',blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed.toString(),transactionFeeETH:formatEther(receipt.fee),checkedAt:new Date().toISOString(),explorer:explorer+'/address/'+c.target,checks:['chain ID','deployment receipt and code','version','owner','campaign hash','token','signer','initial distribution closed to claims']});
  await save();await writeFile(new URL('abi.json',directory),JSON.stringify(artifact.abi,null,2)+'\n');await updateDeployedContracts();
  console.log(JSON.stringify({contract:c.target,chainId:cfg.chainId,campaignID,campaignHash,token:tokenAddress,owner:owner,signer,block:receipt.blockNumber,transaction:record.transactionHash,feeETH:record.transactionFeeETH}));
} finally {provider.destroy();await lock.close();await unlink(lockFile);}
