import {configureTestVesting} from './vesting-config.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,Wallet,Contract} from 'ethers';
import assert from 'node:assert/strict';
const rpc=new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com');
try{
assert.equal((await rpc.getNetwork()).chainId,46630n);
const keys=JSON.parse(await readFile('.secrets/wallets.json','utf8'));
const abi=JSON.parse(await readFile('out/PhoodIDO.sol/PhoodIDO.json','utf8')).abi;
const c=new Contract('0x274114A83c733BcfcDDF14F03bb78223D84e8661',abi,new Wallet(keys.wallets.admin.privateKey,rpc));
const now=(await rpc.getBlock('latest')).timestamp;
assert.equal(await c.phase(),1n);assert.ok(Number((await c.vesting()).start)>now);
const tx=await configureTestVesting(c,[now+45,0,1800,60,1000]);
await writeFile('testnet-runs/boundary-vesting-start.json',JSON.stringify({hash:tx.hash,start:now+45,duration:1800,interval:60,initialBps:1000},null,2));
const receipt=await tx.wait(2);assert.equal(receipt.status,1);
console.log('Vesting begins',new Date((now+45)*1000).toISOString(),tx.hash);
}finally{rpc.destroy();}
