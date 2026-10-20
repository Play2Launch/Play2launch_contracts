import {Contract,id} from 'ethers';
export async function configureTestVesting(contract, base) {
 const schema=await contract.migrationVersion();
 const version=schema===id('P2L_IDO_MIGRATION_V2')?2:schema===id('P2L_IDO_MIGRATION_V1')?1:0;
 if(version===1)return new Contract(contract.target,['function configureVesting((uint64 start,uint64 cliff,uint64 duration,uint64 interval,uint16 initialBps))'],contract.runner).configureVesting(base);
 if(version!==2)throw new Error('Unsupported vesting version');
 // Test schedules use the same short duration for both parts, with no rebate TGE release.
 return contract.configureVesting([...base,base[1],base[2],base[3]]);
}
