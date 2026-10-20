import { readFile, writeFile } from 'node:fs/promises';
import { JsonRpcProvider, Wallet, Contract, ContractFactory, parseEther } from 'ethers';
import assert from 'node:assert/strict';

// Fixture preparation and independent verification only. Migration actions use the admin UI.
const root = new URL('../', import.meta.url);
const rpc = new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com', undefined, { cacheTimeout: -1 });
assert.equal((await rpc.getNetwork()).chainId, 46630n);
const keys = JSON.parse(await readFile(new URL('.secrets/wallets.json', root), 'utf8'));
const admin = new Wallet(keys.wallets.admin.privateKey, rpc);
const artifact = JSON.parse(await readFile(new URL('out/PhoodIDO.sol/PhoodIDO.json', root), 'utf8'));
const old = new Contract('0xd66daE98cE2D9CF181AFD91107B52a9C4F89C6ce', artifact.abi, admin);
const file = new URL('testnet-runs/admin-migration.json', root);
const serial = value => JSON.stringify(value, (_,v) => typeof v === 'bigint' ? v.toString() : v, 2);
let report;
try { report = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
report ??= { chainId:46630, source:old.target, steps:{} };
const save = () => writeFile(file, serial(report) + '\n');
async function step(label, submit) {
  let r = report.steps[label];
  if (!r) { const tx = await submit(); r = report.steps[label] = {hash:tx.hash}; await save(); }
  const receipt = await rpc.waitForTransaction(r.hash, 1, 120000);
  assert.equal(receipt.status, 1); r.address = receipt.contractAddress; r.block = receipt.blockNumber;
  await save(); console.log(label, r.hash); return r;
}
const payment = new Contract(await old.paymentToken(), ['function mint(address,uint256)', 'function balanceOf(address) view returns(uint256)'], admin);
const token = new Contract(await old.saleToken(), ['function transfer(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)'], admin);
if (process.argv.includes('--prepare')) {
  assert.equal(await old.migrated(), false);
  assert.equal(await old.owner(), admin.address);
  await step('seed-mock-usdt', () => payment.mint(old.target, 12340000n));
  await step('seed-phood', () => token.transfer(old.target, parseEther('56.78')));
  const deployed = await step('deploy-target', async () => {
    const config = Array.from(await old.sale());
    config[0] = BigInt((await rpc.getBlock('latest')).timestamp + 3600); config[1] = config[0] + 3600n;
    return (await new ContractFactory(artifact.abi, artifact.bytecode.object, admin).deploy(admin.address, await old.signer(), await old.treasury(), payment.target, await old.campaignId(), config)).deploymentTransaction();
  });
  report.destination = deployed.address;
  report.before = {snapshot: (await old.snapshot()).toObject(true), accounts:[], paymentBalance:await payment.balanceOf(old.target), tokenBalance:await token.balanceOf(old.target)};
  for (let i=0n; i<await old.participantCount(); i++) {
    const wallet = await old.participants(i);
    report.before.accounts.push({wallet, account:(await old.accountSnapshot(wallet)).toObject(true)});
  }
  await save(); console.log('Destination:', report.destination);
} else if (process.argv.includes('--verify')) {
  assert(report.destination && report.before);
  const next = new Contract(report.destination, artifact.abi, rpc);
  assert.equal(await old.migrated(), true); assert.equal(await old.frozen(), true);
  assert.equal(await next.frozen(), false); assert.equal(await next.importing(), false);
  assert.equal(serial((await old.snapshot()).toObject(true)), serial((await next.snapshot()).toObject(true)));
  for (const row of report.before.accounts) assert.equal(serial((await next.accountSnapshot(row.wallet)).toObject(true)), serial(row.account));
  assert.equal(await payment.balanceOf(old.target),0n); assert.equal(await token.balanceOf(old.target),0n);
  assert.equal(String(await payment.balanceOf(next.target)),String(report.before.paymentBalance));
  assert.equal(String(await token.balanceOf(next.target)),String(report.before.tokenBalance));
  await assert.rejects(old.unfreeze.staticCall('test'), e => e.code === 'CALL_EXCEPTION');
  const fromBlock = report.steps['deploy-target'].block;
  report.uiTransactions = [];
  for (const contract of [old,next]) {
    for (const log of await contract.queryFilter('*',fromBlock,'latest')) {
      if (['EmergencyFreeze','MigrationProposed','MigrationStarted','MigrationBatchImported','MigrationCompleted'].includes(log.fragment?.name)) {
        report.uiTransactions.push({contract:contract.target,event:log.fragment.name,hash:log.transactionHash,block:log.blockNumber});
      }
    }
  }
  report.verifiedAt = new Date().toISOString(); report.status = 'passed'; await save();
  console.log('PASS: both accounts, claims, vesting, totals, balances, activation and permanent source closure');
} else { console.log(serial({source:old.target, destination:report.destination, frozen:await old.frozen(), migrated:await old.migrated()})); }
