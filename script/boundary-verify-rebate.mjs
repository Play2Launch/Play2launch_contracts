import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,Wallet,Contract} from 'ethers';
import assert from 'node:assert/strict';
const rpc=new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com');
try{
assert.equal((await rpc.getNetwork()).chainId,46630n);
const abi=JSON.parse(await readFile('out/PhoodIDO.sol/PhoodIDO.json','utf8')).abi;
const k=JSON.parse(await readFile('.secrets/boundary-wallets.json','utf8'));
const live=new Wallet(k.wallets.live.privateKey,rpc);
const c=new Contract('0x274114A83c733BcfcDDF14F03bb78223D84e8661',abi,live);
assert.equal((await c.accounts(live.address)).rebateClaimed,true);
const usd=new Contract('0xBb062B32B6A1eB7697e4165788e856c340dab7ea',['function balanceOf(address) view returns(uint256)'],rpc);
const balance=await usd.balanceOf(live.address);assert.equal(balance,115000000n);
let duplicateError;try{await c.claimRebate.staticCall();assert.fail('duplicate succeeded')}catch(e){assert.equal(e.code,'CALL_EXCEPTION');duplicateError=c.interface.parseError(e.data).name;assert.equal(duplicateError,'NothingToRebate');}
assert.equal((await c.accounts(k.wallets.gmail.address)).rebateClaimed,false);
const result={livePaymentBalance:'115.000000',rebateClaimed:true,duplicateError,gmailRebateClaimed:false};
await writeFile('testnet-runs/boundary-live-rebate-verified.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{rpc.destroy();}
