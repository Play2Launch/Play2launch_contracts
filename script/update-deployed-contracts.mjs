import {readdir,readFile,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=new URL('../',import.meta.url);
// Read public deployment journals only. Never scan .secrets or export whole records.
export async function updateDeployedContracts() {
  const records=[];
  async function scan(directory) {
    let entries;
    try {entries=await readdir(directory,{withFileTypes:true});}
    catch(e){if(e.code==='ENOENT')return;throw e;}
    for(const entry of entries){
      const path=new URL(encodeURIComponent(entry.name)+(entry.isDirectory()?'/':''),directory);
      if(entry.isDirectory())await scan(path);
      else if(entry.name==='deployment.json'){
        const r=JSON.parse(await readFile(path,'utf8'));
        if(r.status!=='deployed')continue;
        if(!Number.isSafeInteger(r.chainId)||!/^0x[\da-f]{40}$/i.test(r.contractAddress)||!/^0x[\da-f]{64}$/i.test(r.transactionHash))throw new Error(`Invalid deployment journal: ${path.pathname}`);
        records.push({record:r,path:fileURLToPath(path).slice(fileURLToPath(root).length).replaceAll('\\','/')});
      }
    }
  }
  await scan(new URL('deployments/',root));
  records.sort((a,b)=>a.record.chainId-b.record.chainId||a.record.contractAddress.localeCompare(b.record.contractAddress));
  const lines=['已部署合约地址清单','==================','',
    '# 此文件自动生成。部署成功并完成链上核对后，部署脚本自动更新。',
    '# 手动刷新：make addresses（只读本地部署记录，不访问私钥，不发送交易）。',
    '# 数据来源：deployments/ 下的 deployment.json；仅收录 status=deployed 的成功记录。',
    '# 后续新合约请使用独立部署目录保留历史，并在部署脚本成功后调用 updateDeployedContracts()。',
    '# 不要手工修改本清单；备注和验证状态请维护在对应 deployment.json 中。',
    '# 测试脚本的 testnet-runs/ 不混入正式部署清单；本文件不包含任何私钥。',''];
  const seen=new Set();
  for(const {record:r,path} of records){
    const identity=`${r.chainId}:${r.contractAddress.toLowerCase()}`;
    if(seen.has(identity))continue;
    seen.add(identity);
    lines.push(`[${r.symbol||r.name||'合约'} · ${r.network||'Network'}]`,
      `网络 Chain ID：${r.chainId}`,`合约地址：${r.contractAddress}`,
      `名称：${r.name||'未记录'}`,`部署交易：${r.transactionHash}`,
      `部署区块：${r.blockNumber??'未记录'}`,`部署钱包：${r.deployer||'未记录'}`);
    if(r.treasury)lines.push(`首次代币接收钱包：${r.treasury}`);
    if(r.totalSupply)lines.push(`发行总量：${r.totalSupply} ${r.symbol||''}`);
    if(r.decimals!==undefined)lines.push(`精度：${r.decimals}`);
    if(r.explorer)lines.push(`浏览器：${r.explorer}`);
    const v=r.verification;
    lines.push(`源码验证：${v?.status==='verified'?'已完成'+(v.source==='user-confirmed'?'（用户手动验证并确认）':''):v?.status||'未记录'}`);
    if(r.notes)for(const note of r.notes)lines.push(`# ${note}`);
    lines.push(`详细记录：${path}`,'');
  }
  if(!records.length)lines.push('暂无成功部署记录。','');
  const target=new URL('DEPLOYED_CONTRACTS.txt',root);
  const temp=new URL('DEPLOYED_CONTRACTS.txt.tmp',root);
  await writeFile(temp,lines.join('\n'),'utf8');
  await rename(temp,target);
  return target;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  console.log(fileURLToPath(await updateDeployedContracts()));
}
