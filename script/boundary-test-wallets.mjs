import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,Wallet,Contract,parseEther} from 'ethers';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url), file=new URL('.secrets/boundary-wallets.json',root);
let secret;try{secret=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;}
if(!secret){secret={testnetOnly:true,wallets:{}};for(const label of ['gmail','live','outsider']){const w=Wallet.createRandom();secret.wallets[label]={address:w.address,privateKey:w.privateKey};}await writeFile(file,JSON.stringify(secret,null,2));}
const rpc=new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com');
try{assert.equal((await rpc.getNetwork()).chainId,46630n);
const old=JSON.parse(await readFile(new URL('.secrets/wallets.json',root),'utf8'));
const admin=new Wallet(old.wallets.admin.privateKey,rpc);
const usd=new Contract('0xBb062B32B6A1eB7697e4165788e856c340dab7ea',['function mint(address,uint256)','function balanceOf(address) view returns(uint256)'],admin);
for(const [label,w] of Object.entries(secret.wallets)){
if(await rpc.getBalance(w.address)<parseEther('0.0001'))await (await admin.sendTransaction({to:w.address,value:parseEther('0.0004')})).wait(2);
if(await usd.balanceOf(w.address)<1000000000n)await(await usd.mint(w.address,1100000000n)).wait(2);
console.log(label,w.address,'funded');
}}finally{rpc.destroy();}
