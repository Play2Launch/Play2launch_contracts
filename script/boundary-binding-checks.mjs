import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,Wallet,Contract,id} from 'ethers';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),rpc=new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com');
try{
assert.equal((await rpc.getNetwork()).chainId,46630n);
const secrets=JSON.parse(await readFile(new URL('.secrets/boundary-wallets.json',root),'utf8'));
const keys=JSON.parse(await readFile(new URL('.secrets/wallets.json',root),'utf8'));
const signer=new Wallet(keys.wallets.signer.privateKey);
const artifact=JSON.parse(await readFile(new URL('out/PhoodIDO.sol/PhoodIDO.json',root),'utf8'));
const address='0x274114A83c733BcfcDDF14F03bb78223D84e8661';
const c=new Contract(address,artifact.abi,rpc);
const gmail=new Wallet(secrets.wallets.gmail.privateKey,rpc),other=new Wallet(secrets.wallets.outsider.privateKey,rpc);
const account=await c.accounts(gmail.address);
assert.equal(account.userId,id('ur2dgglpvzjeo0'));
assert.equal(account.paidCents,10001n);
assert.equal((await c.userWallet(id('ur2dgglpvzjeo0'))).toLowerCase(),gmail.address.toLowerCase());
const checks=[];
async function rejected(name,fn,expected){try{await fn();assert.fail(name+' unexpectedly succeeded')}catch(e){assert.equal(e.code,'CALL_EXCEPTION');const error=c.interface.parseError(e.data)?.name;assert.equal(error,expected);checks.push({name,error,result:'pass',method:'testnet eth_call'});}}
const domain={name:'P2L IDO',version:'1',chainId:46630,verifyingContract:address};
const types={Eligibility:[{name:'userId',type:'bytes32'},{name:'wallet',type:'address'},{name:'maxCents',type:'uint256'},{name:'deadline',type:'uint256'},{name:'epoch',type:'uint256'}]};
async function proof(user,wallet){const e={userId:id(user),wallet,maxCents:100000n,deadline:BigInt((await rpc.getBlock('latest')).timestamp+300),epoch:await c.signerEpoch()};return [e,await signer.signTypedData(domain,types,e)]}
let p=await proof('ur2dgglpvzjeo0',other.address);
await rejected('same P2L user with another wallet',()=>c.connect(other).subscribe.staticCall(10000,...p),'UserAlreadyBound');
p=await proof('ur2aay4pi3stmo',gmail.address);
await rejected('same wallet with another P2L user',()=>c.connect(gmail).subscribe.staticCall(1,...p),'WalletAlreadyBound');
await rejected('claim tokens before settlement',()=>c.connect(gmail).claimTokens.staticCall(),'NotSuccessful');
await rejected('claim rebate before settlement',()=>c.connect(gmail).claimRebate.staticCall(),'NotSuccessful');
await rejected('refund without admin opening',()=>c.connect(gmail).claimRefund.staticCall(),'RefundsNotOpen');
const live=new Wallet(secrets.wallets.live.privateKey,rpc);
p=await proof('ur2aay4pi3stmo',live.address);
assert.equal((await c.accounts(live.address)).paidCents,100000n);
await rejected('one cent above cumulative user cap',()=>c.connect(live).subscribe.staticCall(1,...p),'UserCap');
await writeFile(new URL('testnet-runs/boundary-binding-checks.json',root),JSON.stringify({contract:address,paidCents:account.paidCents.toString(),checks},null,2));
console.log(JSON.stringify({paidCents:account.paidCents.toString(),checks}));
}finally{rpc.destroy();}
