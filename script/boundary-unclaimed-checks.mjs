import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,Wallet,Contract} from 'ethers';
import assert from 'node:assert/strict';
const rpc=new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com');
try{
const abi=JSON.parse(await readFile('out/PhoodIDO.sol/PhoodIDO.json','utf8')).abi;
const keys=JSON.parse(await readFile('.secrets/boundary-wallets.json','utf8'));
const c=new Contract('0x274114A83c733BcfcDDF14F03bb78223D84e8661',abi,rpc);
const outsider=new Wallet(keys.wallets.outsider.privateKey,rpc);
const checks=[];
for(const [method,expected]of [['claimRebate','NothingToRebate'],['claimTokens','NothingVested'],['claimRefund','RefundsNotOpen']]){
try{await c.connect(outsider)[method].staticCall();assert.fail('unexpected success')}catch(e){assert.equal(e.code,'CALL_EXCEPTION');const error=c.interface.parseError(e.data).name;assert.equal(error,expected);checks.push({method,error,methodOfTest:'testnet eth_call'});}}
const accounts=[];
for(const label of ['gmail','live']){const a=await c.accounts(keys.wallets[label].address);assert.equal(a.rebateClaimed,false);assert.equal(a.claimedTokens,0n);accounts.push({label,rebate:a.rebateCents.toString(),claimedTokens:a.claimedTokens.toString()});}
await writeFile('testnet-runs/boundary-unclaimed-checks.json',JSON.stringify({checks,accounts},null,2));console.log(JSON.stringify({checks,accounts}));
}finally{rpc.destroy();}
