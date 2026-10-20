import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,Contract} from 'ethers';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),rpc=new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com',undefined,{cacheTimeout:-1});
try{
 assert.equal((await rpc.getNetwork()).chainId,46630n);
 const r=JSON.parse(await readFile(new URL('testnet-runs/refund-boundary.json',root),'utf8'));
 const artifact=JSON.parse(await readFile(new URL('out/PhoodIDO.sol/PhoodIDO.json',root),'utf8'));
 const c=new Contract(r.contract,artifact.abi,rpc),wallet='0xB8DeD53EA8F17e5CEE1ED40323EF8C569f9C1Fd4';
 const usd=new Contract('0xBb062B32B6A1eB7697e4165788e856c340dab7ea',['function balanceOf(address) view returns(uint256)'],rpc);
 const a=await c.accounts(wallet),balance=await usd.balanceOf(wallet);
 const result={contract:r.contract,wallet,refunded:a.refunded,paidCents:a.paidCents.toString(),balance:balance.toString(),reservedPayment:(await c.reservedPayment()).toString()};
 if(a.refunded){
  assert.equal(balance,115000000n);assert.equal(await c.reservedPayment(),0n);
  try{await c.claimRefund.staticCall({from:wallet});assert.fail('Duplicate refund accepted')}catch(e){assert.equal(e.code,'CALL_EXCEPTION');assert.equal(c.interface.parseError(e.data)?.name,'NothingToRefund');}
  result.duplicateRefund='NothingToRefund';
  const logs=await c.queryFilter(c.filters.Refunded(null,wallet),r.steps.deploy.block,'latest');
  result.transactions=logs.map(x=>({hash:x.transactionHash,cents:x.args[2].toString()}));
 }
 await writeFile(new URL('testnet-runs/refund-web-verified.json',root),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{rpc.destroy();}
