import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,Wallet,Contract} from 'ethers';
import assert from 'node:assert/strict';
const rpc=new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com');
try{
const abi=JSON.parse(await readFile('out/PhoodIDO.sol/PhoodIDO.json','utf8')).abi;
const keys=JSON.parse(await readFile('.secrets/boundary-wallets.json','utf8'));
const w=new Wallet(keys.wallets.live.privateKey,rpc),c=new Contract('0x274114A83c733BcfcDDF14F03bb78223D84e8661',abi,w);
const a=await c.accounts(w.address),token=new Contract(await c.saleToken(),['function balanceOf(address) view returns(uint256)'],rpc);
assert.equal(a.claimedTokens,43000n*10n**18n);assert.equal(await token.balanceOf(w.address),a.claimedTokens);
assert.equal((await c.accounts(keys.wallets.gmail.address)).claimedTokens,0n);
// At a fixed block, a successful claim must consume all currently vested tokens.
const latest=await rpc.getBlock('latest'); const v=await c.vestedTokens(w.address,{blockTag:latest.number});
let repeat='new tranche already unlocked';
if(v===a.claimedTokens){try{await c.claimTokens.staticCall({blockTag:latest.number});assert.fail('double claim succeeded')}catch(e){assert.equal(e.code,'CALL_EXCEPTION');repeat=c.interface.parseError(e.data).name;assert.equal(repeat,'NothingVested');}}
await writeFile('testnet-runs/boundary-live-tokens-verified.json',JSON.stringify({claimed:'43000',walletBalance:'43000',repeat,gmailClaimed:'0'},null,2));console.log(JSON.stringify({claimed:'43000',repeat,gmailClaimed:'0'}));
}finally{rpc.destroy();}
