import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,Contract,id} from 'ethers';
import assert from 'node:assert/strict';
const rpc=new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com');
try{
const abi=JSON.parse(await readFile('out/PhoodIDO.sol/PhoodIDO.json','utf8')).abi;
const c=new Contract('0x274114A83c733BcfcDDF14F03bb78223D84e8661',abi,rpc);
const checks=[];
for(const [user,wallet,paid]of [['ur2dgglpvzjeo0','0xCca07db328ff1580Ba0D331FF56f9D5bE430e5DC',10001n],['ur2aay4pi3stmo','0xB8DeD53EA8F17e5CEE1ED40323EF8C569f9C1Fd4',10000n]]){
const a=await c.accounts(wallet);assert.equal(a.userId,id(user));assert.equal(a.paidCents,paid);assert.equal(a.claimedTokens,0n);assert.equal((await c.userWallet(id(user))).toLowerCase(),wallet.toLowerCase());checks.push({wallet,paidCents:paid.toString(),claimedTokens:'0',identityMatches:true});
}
assert.equal(Number(await c.phase()),0);
await writeFile('testnet-runs/boundary-two-buyers.json',JSON.stringify({checks,phase:'pending'},null,2));console.log(JSON.stringify(checks));
}finally{rpc.destroy();}
