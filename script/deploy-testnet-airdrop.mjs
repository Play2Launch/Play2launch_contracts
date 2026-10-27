import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {AbiCoder,Contract,ContractFactory,JsonRpcProvider,Wallet,ZeroHash,formatEther,getCreateAddress,id,keccak256} from 'ethers';
import {updateDeployedContracts} from './update-deployed-contracts.mjs';

// Dedicated testnet deployment. Only test wallets are loaded; the chain is checked before signing.
const base=new URL('../',import.meta.url);
const directory=new URL('deployments/46630/airdrop-phood/',base);
const journal=new URL('deployment.json',directory);
const signedFile=new URL('.secrets/testnet-airdrop-phood.signed',base);
const provider=new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com',undefined,{cacheTimeout:-1});
const campaignID='cp2azzme0n5534';
const campaignHash=id('p2l-airdrop-v1:'+campaignID);
const tokenAddress='0x39A717B283A51b7b270f6cbFC4C75d84b64277D8';
try {
  assert.equal((await provider.getNetwork()).chainId,46630n);
  const secret=JSON.parse(await readFile(new URL('.secrets/wallets.json',base),'utf8'));
  const admin=new Wallet(secret.wallets.admin.privateKey,provider);
  const signer=new Wallet(secret.wallets.signer.privateKey).address;
  const artifact=JSON.parse(await readFile(new URL('out/P2LAirdrop.sol/P2LAirdrop.json',base),'utf8'));
  const args=[admin.address,campaignHash,tokenAddress,signer];
  const token=new Contract(tokenAddress,['function symbol() view returns(string)','function decimals() view returns(uint8)'],provider);
  assert.equal(await token.symbol(),'PHOOD');assert.equal(await token.decimals(),18n);
  assert.notEqual(await provider.getCode(tokenAddress),'0x');
  await mkdir(directory,{recursive:true});
  let record;
  try {record=JSON.parse(await readFile(journal,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const save=()=>writeFile(journal,JSON.stringify(record,null,2)+'\n');
  if(!record){
    const factory=new ContractFactory(artifact.abi,artifact.bytecode.object,admin);
    const request=await factory.getDeployTransaction(...args);
    const gas=await provider.estimateGas({...request,from:admin.address});
    const tx=await admin.populateTransaction({...request,gasLimit:gas*120n/100n});
    const maxFee=tx.gasLimit*(tx.maxFeePerGas??tx.gasPrice);
    assert(maxFee<1000000000000000n,'Deployment exceeds 0.001 test ETH fee cap');
    assert((await provider.getBalance(admin.address))>=maxFee,'Insufficient test ETH');
    const signed=await admin.signTransaction(tx);
    await writeFile(signedFile,signed,{mode:0o600});
    record={name:'PAPERHOOD Airdrop',network:'Robinhood Chain testnet',chainId:46630,status:'prepared',campaignID,campaignSlug:'phood',campaignId:campaignHash,token:tokenAddress,deployer:admin.address,admin:admin.address,signer,contractAddress:getCreateAddress({from:admin.address,nonce:tx.nonce}),transactionHash:keccak256(signed),nonce:tx.nonce,maximumFeeETH:formatEther(maxFee),createdAt:new Date().toISOString(),constructorArguments:AbiCoder.defaultAbiCoder().encode(['address','bytes32','address','address'],args),compiler:artifact.metadata.compiler,verification:{status:'pending'},notes:['测试网 PHOOD 空投合约，绑定本地 PAPERHOOD 活动 phood。','部署时未结算、未注资、未开放领取；deadline=0。']};
    await save();
  }
  assert.equal(record.chainId,46630);assert.equal(record.campaignId,campaignHash);assert.equal(record.admin,admin.address);assert.equal(record.signer,signer);assert.equal(record.token,tokenAddress);
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
  assert.equal(await c.version(),1n);assert.equal(await c.owner(),admin.address);assert.equal(await c.campaignHash(),campaignHash);assert.equal(await c.token(),tokenAddress);assert.equal(await c.signer(),signer);
  assert.notEqual(await provider.getCode(c.target),'0x');
  // Check initial state only on first completion; reruns must preserve later admin configuration.
  if(record.status!=='deployed'){assert.equal(await c.root(),ZeroHash);assert.equal(await c.opened(),false);assert.equal(await c.closed(),false);assert.equal(await c.deadline(),0n);}
  Object.assign(record,{status:'deployed',blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed.toString(),transactionFeeETH:formatEther(receipt.fee),checkedAt:new Date().toISOString(),explorer:'https://explorer.testnet.chain.robinhood.com/address/'+c.target,checks:['chain ID','deployment receipt and code','version','owner','campaign hash','token','signer','initial distribution closed to claims']});
  await save();await writeFile(new URL('abi.json',directory),JSON.stringify(artifact.abi,null,2)+'\n');await updateDeployedContracts();
  console.log(JSON.stringify({contract:c.target,chainId:46630,campaignID,campaignHash,token:tokenAddress,owner:admin.address,signer,block:receipt.blockNumber,transaction:record.transactionHash,feeETH:record.transactionFeeETH}));
} finally {provider.destroy();}
