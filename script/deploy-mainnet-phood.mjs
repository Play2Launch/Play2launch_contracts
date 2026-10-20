import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {updateDeployedContracts} from './update-deployed-contracts.mjs';
import {JsonRpcProvider,Wallet,ContractFactory,Contract,parseEther,formatEther,keccak256,getCreateAddress,AbiCoder} from 'ethers';

// Explicitly authorized issuance: 1 billion PHOOD to the dedicated mainnet deployer.
// Private keys and the recoverable signed transaction stay in the ignored .secrets directory.
const root=new URL('../',import.meta.url);
const directory=new URL('deployments/4663/phood/',root);
const recordFile=new URL('deployment.json',directory);
const signedFile=new URL('.secrets/mainnet-phood-deployment-tx.txt',root);
const treasury='0xD083f0d09ed4234B92bC8D1607E1fE7550AC7882';
const supply=parseEther('1000000000');
const provider=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',undefined,{cacheTimeout:-1});
await mkdir(directory,{recursive:true});
let record;
try{record=JSON.parse(await readFile(recordFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const save=()=>writeFile(recordFile,JSON.stringify(record,null,2)+'\n');
try{
  assert.equal((await provider.getNetwork()).chainId,4663n);
  const secret=JSON.parse(await readFile(new URL('.secrets/mainnet-deployer.json',root),'utf8'));
  const wallet=new Wallet(secret.privateKey,provider);
  assert.equal(wallet.address,treasury);
  const artifact=JSON.parse(await readFile(new URL('out/PHOOD.sol/PHOOD.json',root),'utf8'));
  if(!record){
    const factory=new ContractFactory(artifact.abi,artifact.bytecode.object,wallet);
    const request=await factory.getDeployTransaction(treasury,supply);
    const gas=await provider.estimateGas({...request,from:treasury});
    const tx=await wallet.populateTransaction({...request,gasLimit:gas*120n/100n});
    const maxCost=tx.gasLimit*(tx.maxFeePerGas??tx.gasPrice);
    assert(maxCost<parseEther('0.005'),'Deployment fee exceeds the local safety ceiling');
    assert((await provider.getBalance(treasury))>=maxCost,'Insufficient ETH');
    const signed=await wallet.signTransaction(tx);
    record={network:'Robinhood Chain mainnet',chainId:4663,name:'PAPERHOOD',symbol:'PHOOD',decimals:18,totalSupply:'1000000000',totalSupplyUnits:supply.toString(),deployer:treasury,treasury,contractAddress:getCreateAddress({from:treasury,nonce:tx.nonce}),transactionHash:keccak256(signed),nonce:tx.nonce,status:'prepared',createdAt:new Date().toISOString(),gasLimit:tx.gasLimit.toString(),maximumFeeETH:formatEther(maxCost),compiler:artifact.metadata.compiler,compilerSettings:artifact.metadata.settings,constructorArguments:AbiCoder.defaultAbiCoder().encode(['address','uint256'],[treasury,supply]),verification:{status:'pending'}};
    await writeFile(new URL('artifact.json',directory),JSON.stringify(artifact,null,2)+'\n',{flag:'wx'});
    await writeFile(new URL('PHOOD.sol',directory),await readFile(new URL('src/PHOOD.sol',root)),{flag:'wx'});
    await writeFile(signedFile,signed+'\n',{flag:'wx',mode:0o600});
    await save();
  }
  assert.equal(record.treasury,treasury);assert.equal(record.totalSupplyUnits,supply.toString());
  console.log('Deployment',JSON.stringify({address:record.contractAddress,hash:record.transactionHash,maximumFeeETH:record.maximumFeeETH}));
  let receipt=await provider.getTransactionReceipt(record.transactionHash);
  if(!receipt){
    if(!await provider.getTransaction(record.transactionHash)){
      const signed=(await readFile(signedFile,'utf8')).trim();
      assert.equal(keccak256(signed),record.transactionHash);
      const sent=await provider.broadcastTransaction(signed);
      assert.equal(sent.hash,record.transactionHash);
      record.status='broadcast';await save();
    }
    receipt=await provider.waitForTransaction(record.transactionHash,2,180000);
  }
  assert(receipt,'Transaction is still pending; do not deploy again');
  assert.equal(receipt.status,1,'Deployment reverted');
  assert.equal(receipt.contractAddress.toLowerCase(),record.contractAddress.toLowerCase());
  const frozenArtifact=JSON.parse(await readFile(new URL('artifact.json',directory),'utf8'));
  const token=new Contract(record.contractAddress,frozenArtifact.abi,provider);
  assert.equal(await token.name(),'PAPERHOOD');assert.equal(await token.symbol(),'PHOOD');
  assert.equal(await token.decimals(),18n);assert.equal(await token.totalSupply(),supply);
  assert.equal(await token.balanceOf(treasury),supply);
  const code=await provider.getCode(record.contractAddress);
  assert.equal(code.toLowerCase(),frozenArtifact.deployedBytecode.object.toLowerCase());
  Object.assign(record,{status:'deployed',blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed.toString(),transactionFeeETH:formatEther(receipt.fee),runtimeBytes:(code.length-2)/2,checkedAt:new Date().toISOString(),explorer:`https://robinhoodchain.blockscout.com/address/${record.contractAddress}`,checks:['name','symbol','18 decimals','fixed issuance of 1 billion','entire supply received by treasury','runtime bytecode matches compiled artifact']});
  await save();
  await updateDeployedContracts();
  console.log('DEPLOYED AND CHECKED',record.contractAddress,'fee ETH',record.transactionFeeETH);
}catch(e){console.error(e.shortMessage||e.message);process.exitCode=1;}finally{provider.destroy();}
