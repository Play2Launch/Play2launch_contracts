import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { JsonRpcProvider, Wallet, Contract, ContractFactory, parseEther, formatEther, id, MaxUint256 } from 'ethers';
import assert from 'node:assert/strict';

// This runner only uses dedicated local test wallets and a locally deployed mock payment token.
const root = new URL('../', import.meta.url);
const rpc = new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com', undefined, { cacheTimeout: -1 });
const network = await rpc.getNetwork();
assert.equal(network.chainId, 46630n, 'Refusing to run outside Robinhood testnet');
const secretFile = new URL('.secrets/vesting-v2-wallets.json', root);
await mkdir(new URL('.secrets/', root), {recursive:true});
let secret;
try { secret=JSON.parse(await readFile(secretFile,'utf8')); } catch(e) { if(e.code!=='ENOENT') throw e; }
if(!secret) {
  secret={testnetOnly:true,createdAt:new Date().toISOString(),wallets:{}};
  for(const role of ['admin','signer','buyerA','buyerB']) {
    const w=Wallet.createRandom(); secret.wallets[role]={address:w.address,privateKey:w.privateKey};
  }
  await writeFile(secretFile,JSON.stringify(secret,null,2)+'\n',{flag:'wx'});
}

const wallets = Object.fromEntries(Object.entries(secret.wallets).map(([role, value]) => [role, new Wallet(value.privateKey, rpc)]));
const { admin, signer, buyerA, buyerB } = wallets;
const runFile = new URL('testnet-runs/vesting-v2-e2e.json', root);
await mkdir(new URL('testnet-runs/', root), { recursive: true });
let report;
try { report = JSON.parse(await readFile(runFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
report ??= { chainId: 46630, startedAt: new Date().toISOString(), wallets: Object.fromEntries(Object.entries(wallets).map(([k,w]) => [k,w.address])), steps: {}, checks: [] };
const save = async () => writeFile(runFile, JSON.stringify(report, null, 2) + '\n');
const artifact = async name => JSON.parse(await readFile(new URL(`out/${name}.sol/${name}.json`, root), 'utf8'));
const idoArtifact = await artifact('PhoodIDO');
const now = async () => Number((await rpc.getBlock('latest')).timestamp);
const check = async (label, assertion) => { await assertion(); if (!report.checks.includes(label)) report.checks.push(label); await save(); console.log(`PASS ${label}`); };

async function step(label, submit) {
  let record = report.steps[label];
  if (record?.status === 'confirmed') return record;
  if (record?.hash) {
    const receipt = await rpc.getTransactionReceipt(record.hash);
    if (!receipt) throw new Error(`Pending transaction ${label}: ${record.hash}; wait before restarting`);
    if (receipt.status !== 1) throw new Error(`Transaction reverted ${label}: ${record.hash}`);
    Object.assign(record, { status: 'confirmed', block: receipt.blockNumber, address: receipt.contractAddress || record.address });
    await save(); return record;
  }
  const tx = await submit();
  record = report.steps[label] = { hash: tx.hash, status: 'pending' };
  await save(); console.log(`SENT ${label}: ${tx.hash}`);
  const receipt = await tx.wait(1, 180_000);
  assert.equal(receipt?.status, 1, `${label} reverted`);
  Object.assign(record, { status: 'confirmed', block: receipt.blockNumber, address: receipt.contractAddress });
  await save(); console.log(`CONFIRMED ${label}`); return record;
}

async function deploy(label, name, args) {
  const a = await artifact(name);
  const record = await step(label, async () => (await new ContractFactory(a.abi, a.bytecode.object, admin).deploy(...args)).deploymentTransaction());
  return new Contract(record.address, a.abi, admin);
}

async function until(timestamp, label) {
  let logged = false;
  while (await now() < timestamp) {
    if (!logged) { console.log(`WAIT ${label} until ${new Date(timestamp * 1000).toISOString()}`); logged = true; }
    await new Promise(resolve => setTimeout(resolve, 4000));
  }
}
async function reverts(label, call) {
  await check(label, async () => {
    let reverted = false;
    try { await call(); } catch (e) { if (e.code === 'CALL_EXCEPTION') reverted = true; else throw e; }
    assert(reverted, `${label}: expected a contract revert`);
  });
}

async function subscribe(c, who, cents, label) {
  const credential = { userId: id(`e2e-user-${who.address}`), wallet: who.address, maxCents: 100000n,
    deadline: BigInt(await now() + 3600), epoch: await c.signerEpoch() };
  const sig = await signer.signTypedData({ name: 'P2L IDO', version: '1', chainId: 46630, verifyingContract: c.target }, {
    Eligibility: [{name:'userId',type:'bytes32'},{name:'wallet',type:'address'},{name:'maxCents',type:'uint256'},{name:'deadline',type:'uint256'},{name:'epoch',type:'uint256'}],
  }, credential);
  return step(label, () => c.connect(who).subscribe(cents, credential, sig));
}

async function newIDO(label, payment, campaign) {
  const start = await now() + 25;
  // Reduced test caps ($1,000/$2,000) reach the hard cap with two buyers; deployed defaults remain $10k/$50k.
  return deploy(label, 'PhoodIDO', [admin.address, signer.address, admin.address, payment.target, id(campaign), [start,start+3600,100000,200000,parseEther('100'),parseEther('200000'),parseEther('1000000')]]);
}

async function run() {
  if (report.status === 'passed') { console.log('This testnet run already passed; see testnet-runs/vesting-v2-e2e.json.'); return; }
  if(await rpc.getBalance(admin.address)<parseEther('0.003') && !report.steps['fund-new-admin']) {
    const fundingSecret=JSON.parse(await readFile(new URL('.secrets/wallets.json',root),'utf8'));
    const funding=new Wallet(fundingSecret.wallets.admin.privateKey,rpc);
    assert((await rpc.getBalance(funding.address))>parseEther('0.0041'),'Insufficient test ETH');
    await step('fund-new-admin',()=>funding.sendTransaction({to:admin.address,value:parseEther('0.004')}));
  }
  const balance = await rpc.getBalance(admin.address);
  console.log(`Admin ${admin.address}: ${formatEther(balance)} test ETH`);
  if (balance < parseEther('0.001') && !report.steps['deploy-success-ido']) { report.status = 'waiting_for_test_eth'; await save(); console.log('WAITING: fund admin on Robinhood testnet; no deployments sent.'); return; }
  if (process.argv.includes('--check')) { console.log('Funding available. Run without --check to execute.'); return; }
  for (const [role,w] of [['buyerA',buyerA],['buyerB',buyerB]]) {
    await step(`fund-${role}`, () => admin.sendTransaction({to:w.address,value:parseEther('0.0003')}));
  }
  // MockUSDT is compiled from test/PhoodIDO.t.sol; unlike PHOOD, it has a test-only mint function.
  const mock = JSON.parse(await readFile(new URL('out/PhoodIDO.t.sol/MockUSDT.json', root),'utf8'));
  const mockRecord = await step('deploy-mock-usdt', async () => (await new ContractFactory(mock.abi,mock.bytecode.object,admin).deploy()).deploymentTransaction());
  const usd = new Contract(mockRecord.address,mock.abi,admin);
  const token = await deploy('deploy-phood','PHOOD',[admin.address,parseEther('1000000')]);
  for (const [role,w] of [['buyerA',buyerA],['buyerB',buyerB]]) await step(`mint-${role}`, () => usd.mint(w.address,5000n*1000000n));
  const old = await newIDO('deploy-success-ido',usd,'e2e-success');
  await check('V2 deployed with valid runtime size',async()=>{
    assert.equal(await old.migrationVersion(),id('P2L_IDO_MIGRATION_V2'));
    const code=await rpc.getCode(old.target); const size=(code.length-2)/2;
    assert.equal(size,24562); report.runtimeBytes=size;
  });
  await until(Number((await old.sale()).start),'sale start');
  for (const [role,w] of [['buyerA',buyerA],['buyerB',buyerB]]) await step(`approve-${role}`, () => usd.connect(w).approve(old.target,MaxUint256));
  await subscribe(old,buyerA,10000,'subscribe-A-first');
  await subscribe(old,buyerA,1,'subscribe-A-cent');
  await subscribe(old,buyerA,89999,'subscribe-A-cap');
  await subscribe(old,buyerB,100000,'subscribe-B-cap');
  await check('gross subscription $2000; two participants', async () => {
    assert.equal(await old.totalPaidCents(),200000n); assert.equal(await old.participantCount(),2n);
  });
  await reverts('principal refund unavailable before admin decision', () => old.connect(buyerA).claimRefund.staticCall());
  await step('bind-token', () => old.bindToken(token.target));
  await step('fund-sale-tokens', () => token.transfer(old.target,parseEther('200000')));
  if (!report.steps['close-sale']) await step('close-sale', async () => old.setSaleEnd(await now()+15));
  else await step('close-sale', () => { throw new Error('Unexpected close resubmission'); });
  await until(Number((await old.sale()).end),'sale close');
  await step('register-rebates', () => old.registerRebates([buyerA.address,buyerB.address],[20000,15000]));
  await step('lock-rebates', () => old.lockRebates());
  if (!report.steps['finalize-success'] && Number((await old.vesting()).start) <= await now()) {
    const label = `vesting-${Object.keys(report.steps).filter(k=>k.startsWith('vesting-')).length}`;
    await step(label, async () => old.configureVesting([await now()+45,0,180,15,3000,60,180,15]));
  }
  await step('finalize-success', () => old.finalizeSuccess());
  await check('final rebate $200 + $150', async () => assert.equal(await old.totalRebateCents(),35000n));
  await reverts('cannot refund successful sale', () => old.openRefunds.staticCall());
  await step('withdraw-unreserved-usdt', () => old.withdrawSurplus(usd.target,1650n*1000000n));
  await reverts('rebate reserve protected', () => old.withdrawSurplus.staticCall(usd.target,1));
  await until(Number((await old.vesting()).start),'vesting start');
  const schedule=await old.vesting();
  const start=Number(schedule.start);
  await check('TGE base release and rebate cliff',async()=>{
    const block=await rpc.getBlock('latest');
    assert(block.timestamp<start+60,'TGE test window missed');
    const p=await old.vestedTokenParts(buyerA.address,{blockTag:block.number});
    assert.equal(p[2],parseEther('80000')); assert.equal(p[3],parseEther('20000'));
    assert(p[0]>=parseEther('24000')); assert.equal(p[1],0n);
  });
  await reverts('vesting schedules locked after TGE',()=>old.configureVesting.staticCall([start+1000,0,180,15,3000,60,180,15]));
  await reverts('outsider cannot claim participant tokens',()=>old.connect(signer).claimTokens.staticCall());
  await step('claim-A-initial', () => old.connect(buyerA).claimAll());
  await check('cash rebate does not change token allocation',async()=>{
    const p=await old.vestedTokenParts(buyerA.address);
    assert.equal(p[2],parseEther('80000')); assert.equal(p[3],parseEther('20000'));
    assert.equal((await old.accounts(buyerA.address)).rebateClaimed,true);
    assert.equal(await usd.balanceOf(buyerA.address),4200n*1000000n);
  });
  await until(start+90,'both token schedules releasing');
  await check('both parts match independent linear schedules',async()=>{
    const block=await rpc.getBlock('latest');
    const p=await old.vestedTokenParts(buyerA.address,{blockTag:block.number});
    const elapsed=BigInt(block.timestamp-start);
    const baseTime=(elapsed>180n?180n:elapsed)/15n*15n;
    const rebateTime=(elapsed-60n>180n?180n:elapsed-60n)/15n*15n;
    assert.equal(p[0],parseEther('24000')+parseEther('56000')*baseTime/180n);
    assert.equal(p[1],parseEther('20000')*rebateTime/180n);
    assert(p[1]>0n && p[1]<p[3]);
  });
  await reverts('rebate cannot be claimed twice', () => old.connect(buyerA).claimRebate.staticCall());
  const next = await newIDO('deploy-migration-target',usd,'e2e-success');
  await step('freeze-source', () => old.emergencyFreeze('Testnet end-to-end migration'));
  if (!await old.migrated()) {
    await reverts('frozen source blocks claims', () => old.connect(buyerB).claimAll.staticCall());
  }
  await step('propose-target', () => old.proposeMigration(next.target));
  await step('begin-migration', () => next.beginMigration(old.target));
  await step('import-A', () => next.importNextBatch(1));
  if (!report.steps['import-B']) await reverts('partial import cannot execute', () => old.executeMigration.staticCall());
  await step('import-B', () => next.importNextBatch(1));
  await step('execute-migration', () => old.executeMigration());
  await check('source closed; funds and historical claims migrated', async () => {
    assert.equal(await old.migrated(),true); assert.equal(await next.frozen(),false);
    assert.equal(await usd.balanceOf(old.target),0n); assert.equal(await token.balanceOf(old.target),0n);
    if (!report.steps['claim-A-final']) assert.deepEqual(Array.from(await old.accountSnapshot(buyerA.address)),Array.from(await next.accountSnapshot(buyerA.address)));
    assert.deepEqual(Array.from(await old.vesting()),Array.from(await next.vesting()));
  });
  await reverts('source cannot reopen', () => old.unfreeze.staticCall('test'));
  const vesting = await next.vesting();
  await until(Number(vesting.start+vesting.duration),'base vesting finish');
  await check('base finished while rebate tokens remain locked',async()=>{
    const block=await rpc.getBlock('latest');
    assert(block.timestamp<Number(vesting.start+vesting.rebateCliff+vesting.rebateDuration),'Intermediate test window missed');
    const p=await next.vestedTokenParts(buyerB.address,{blockTag:block.number});
    assert.equal(p[0],p[2]); assert(p[1]>0n && p[1]<p[3]);
  });
  await until(Number(vesting.start+vesting.rebateCliff+vesting.rebateDuration),'rebate vesting finish');
  for (const [role,w] of [['A',buyerA],['B',buyerB]]) await step(`claim-${role}-final`, () => next.connect(w).claimAll());
  await check('both buyers receive full gross token allocation; all rebates paid', async () => {
    assert.equal(await token.balanceOf(buyerA.address),parseEther('100000'));
    assert.equal(await token.balanceOf(buyerB.address),parseEther('100000'));
    assert.equal(await next.totalClaimedTokens(),parseEther('200000'));
    assert.equal(await next.claimedRebateCents(),35000n); assert.equal(await next.reservedPayment(),0n);
  });
  await reverts('fully claimed tokens cannot be claimed twice',()=>next.connect(buyerA).claimTokens.staticCall());
  await reverts('migrated source rejects claims',()=>old.connect(buyerA).claimTokens.staticCall());
  const refund = await newIDO('deploy-refund-ido',usd,'e2e-refund');
  await until(Number((await refund.sale()).start),'refund sale start');
  await step('approve-refund-A', () => usd.connect(buyerA).approve(refund.target,MaxUint256));
  await subscribe(refund,buyerA,10000,'subscribe-refund-A');
  if (!report.steps['open-refunds']) await reverts('refund requires manual opening', () => refund.connect(buyerA).claimRefund.staticCall());
  await step('open-refunds', () => refund.openRefunds());
  await step('claim-refund-A', () => refund.connect(buyerA).claimRefund());
  await reverts('principal cannot be refunded twice', () => refund.connect(buyerA).claimRefund.staticCall());
  await check('refund fully paid; no principal reserve remains', async () => {
    assert.equal(await refund.refundedCents(),10000n); assert.equal(await refund.reservedPayment(),0n);
    assert.equal(await usd.balanceOf(refund.target),0n);
  });
  report.status = 'passed'; report.completedAt = new Date().toISOString(); await save();
  console.log('PASS complete testnet IDO lifecycle. Public receipts saved in testnet-runs/vesting-v2-e2e.json');
}

try { await run(); } catch(e) {
  report.status = 'interrupted'; report.error = e.shortMessage || e.reason || e.message; await save();
  console.error(`STOP: ${report.error}`); process.exitCode = 1;
} finally { rpc.destroy(); }
