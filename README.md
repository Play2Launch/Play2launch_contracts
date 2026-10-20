# Play2Launch contracts

独立 Foundry 项目：PHOOD ERC20 + 单活动 IDO/返点/Vesting。当前为本地测试版本，尚未部署，也未经过独立安全审计。

## 安装与验证

```sh
npm ci
npm run build
npm test
npm run fmt
```

固定使用 Solidity 0.8.30、OpenZeppelin 5.4.0、Foundry 1.7.1。`.npmrc` 禁用依赖生命周期脚本，避开 Foundry npm 包在 Windows 的安装脚本兼容问题；直接通过官方平台二进制运行。原生安装 Forge 后也可以直接运行 `forge test`。首次编译需要下载 Solidity 编译器。

## PHOOD

- 名称 PAPERHOOD，符号 PHOOD，18 位小数。
- 部署时指定总量和接收钱包，一次铸造全部总量，无后续增发、税费、黑名单、暂停或管理后门。
- `supply` 为最小单位；例如 100 万枚写作 `1000000 * 10**18`。实际总量尚未确定，不在代码中硬编码。

## IDO 规则

- 每个活动部署一个 `PhoodIDO`，支付币、活动 ID 在部署时固定。
- 首次至少 $100；追加至少 $0.01；个人累计最多 $1,000。参数和事件中的认购金额统一使用整数美分。支付币按其 decimals 转换，不假设 USDT 一定为 6 位小数。
- 默认部署配置软顶 $10,000、硬顶 $50,000，按认购原价累计计算。开始前可调整软硬顶、价格、销售份额和承诺总量，开始后锁定。已绑定 Token 后不再允许整体修改销售参数。
- 价格以 `tokenUnitsPerDollar`（每 $1 对应多少 Token 最小单位）表达，要求能被 100 整除，确保按美分追加不会产生分单舍入差异。
- 认购全额托管，Token 权益按原价计算。可在未部署/绑定 PHOOD 时先开放认购；绑定时验证 18 位小数和承诺总量，绑定后不能更换。绑定前管理员必须自行核对 Token 地址；总量检查无法证明任意外部 Token 的行为安全，应使用本项目 PHOOD。
- 结束时间在尚未结束时可提前到当前时刻或延后；已结束不可重新开放，避免已冻结成绩与新增认购混用。达到硬顶不自动提前结束成绩窗口。
- 认购额度按链上 userId 与钱包一对一绑定。首次签名必须由服务端对登录用户及其钱包绑定校验后签发；合约无法独立判断多个平台账号是否属于同一自然人。

## 返点与退款

返点不是本金退款。用户先支付全款，活动结束后根据最高有效成绩统一结算，成功后主动领取：

```text
返点美分 = min(最高有效游戏分, 20000, floor(累计认购美分 / 5))
```

每 $1 返点需要 100 分；$1,000 + 20,000 分获得 $200 返点。超过 20,000 分不增加返点。金额不足一美分向下取整。追加认购和多局游戏不会重复使用积分额度。

活动结束后管理员批量调用 `registerRebates(wallets, scores)`，所有买家都必须登记，包括 0 分。锁定前可修正，重复登记更新同一账户而不重复累计。登记人数齐全后调用 `lockRebates` 永久锁定，然后才能成功结算。链上只能验证返点公式与上限，游戏成绩真实性由服务端校验和管理员确认负责。

本金退款只有管理员调用 `openRefunds` 才开放，适用于整个活动，开启后不可撤销；用户调用 `claimRefund` 领取全额本金，不发 Token 和返点。未达软顶或超时不会自动开启退款。管理员不操作时资金继续托管。成功结算后不能再开启本金退款。

## 状态与资金准备金

`Pending` 包括待开始、认购中和结束待结算，时间条件另外判断。终态为 `Successful` 或 `Refunding`。

成功结算需要：活动已结束、达软顶、所有返点已锁定、Token 已绑定且足额入账、Vesting 起点在未来、支付资金完整。

- 未成功时保留全部未退本金。
- 成功后保留全部未领取返点；Token 保留全部未领取额度，包括尚未解锁的部分。
- 退款状态保留未退本金，销售 Token 可以回收。
- `withdrawSurplus` 只能将准备金之外的余额发送到配置的 treasury，不可动用用户准备金。
- 领取权不设过期日；不能因用户长期不领而提走准备金。
- 支付币须无转账税、不 rebasing，且按 1 Token = $1 计价。本合约无价格预言机。测试网支付币地址需实际核实；不要将 MockUSDT 当作正式 USDT。

## Vesting

`start` 为释放起点；此时释放 `initialBps / 10000`。剩余部分从 `start + cliff` 开始，按 `interval` 秒步进，在 `duration` 秒内释放；末尾不足完整步长的尾数在结束时全部释放。Cliff 不会推迟首发部分。

示例：首发 10%、cliff 30 天、duration 180 天、interval 1 天，即起点释放 10%，30 天后开始剩余 90% 的 180 天逐日释放。

成功结算后、释放开始前可调整全部 Vesting 参数；释放开始后永久锁定，不能延期、回收已释放部分或降低权益。待结算期间若预设起点已过，可重新设置未来起点，因为尚未成功的活动没有开始释放。

`claimTokens`、`claimRebate` 独立领取；`claimAll` 一次领取当前可领两项。累计已领取量保存在链上，防止重复领取。

## 钱包及服务端签名

- A：owner + treasury，可使用同一用户钱包；管理员连接钱包发交易，服务端不保存 A 私钥。
- B：服务端 EOA 签名地址，只签认购资格，不需要 Gas、资金或 owner 权限。
- 部署钱包可以是第三个钱包；构造函数直接指定 A/B，不给部署者隐含权限。
- owner 转移需新 owner 调用 `acceptOwnership`。禁止放弃 owner，避免永久失去手动结算/退款能力。treasury 独立设置，不随 owner 转移自动改变。

EIP-712 domain：`name = P2L IDO`、`version = 1`、实际 `chainId`、实际 IDO 地址 `verifyingContract`。

```text
Eligibility(bytes32 userId,address wallet,uint256 maxCents,uint256 deadline,uint256 epoch)
```

`userId` 为固定不透明 bytes32 ID，数据库关联原始用户；不要直接上链邮箱等个人信息。一个 IDO 对应一个 campaignId，合约地址绑定签名的活动范围。

服务端确认完成有效游戏和钱包归属后签发，`maxCents` 默认 100000，`deadline` 为短期有效截止时间，`epoch` 读取合约 `signerEpoch`。有效凭证可以多次追加，合约校验累计额度，所以无需一次性 nonce。调用者必须等于签名钱包。`setSigner` 每次递增 epoch，可轮换签名钱包或撤销所有旧凭证。

最终返点采用 A 审核并批量登记链上的方案，成功后用户领取无需 B 在线签发凭证。数据库保存资格凭证审计和链上事件镜像；以实际链上事件为准，按 chainId + txHash + logIndex 去重，处理确认和重组。

## 部署准备（尚未执行）

复制 `.env.example` 为 `.env`，填写公开参数。不要在配置中保存私钥；使用 Foundry keystore，通过 `--account` 指定部署钱包。当前脚本仅允许 Robinhood Testnet 46630 和本地 31337，正式链部署需另行确认。

先模拟，检查地址及构造参数：

```sh
node node_modules/@foundry-rs/forge/bin.mjs script script/Deploy.s.sol:DeployIDO --rpc-url robinhood_testnet --account deployer
node node_modules/@foundry-rs/forge/bin.mjs script script/Deploy.s.sol:DeployPHOOD --rpc-url robinhood_testnet --account deployer
```

准备好后在相同命令后增加 `--broadcast` 才会发送交易。两个脚本独立运行，可以先 IDO 后 PHOOD。部署完成后由 A 绑定 PHOOD、转入销售所需 Token、配置 Vesting。服务端/Admin 接口集成尚未包含在本项目内。

上线前仍需确定：PHOOD 总量、价格、销售份额、时间、Vesting 参数、支付 Token 地址、A/B/部署钱包地址。还需要独立审计及测试网端到端验收。

## 紧急冻结与迁移

本版新增兼容协议 `P2L_IDO_MIGRATION_V1`。迁移入口有管理员权限，管理员能指定新代码，因此这仍是信任管理员的恢复机制，并不是去信任升级。建议将 owner 交给多签；本版后台先支持浏览器 EOA 钱包操作。不得仅凭接口探测通过就信任目标代码。

1. A 调用旧合约 `emergencyFreeze(reason)`。认购、Token/返点/退款领取、资金提取、修改业务配置和所有权变更全部停止。读取不受影响，Vesting 的自然时间继续流逝，不重置或暂停释放时钟。
2. 部署修复版本的新合约，保留迁移协议。必须同链、同 owner、同 campaignId、同支付币，且新合约尚未使用。部署时仍需未来时间窗口；`beginMigration` 会用旧合约的真实销售窗口、状态、Vesting、签名和财库配置覆盖占位配置。
3. 旧合约 `proposeMigration(target)` 记录目标地址、代码哈希和轮次；目标 `beginMigration(source)` 固定快照。目标进入冻结导入状态。
4. 目标 `importNextBatch(count)` 分批读取旧合约参与者索引及账户记录，每批 1–100 人；已导入游标保存在链上。不是上传可编辑金额，刷新页面后读取进度继续下一批。
5. `migrationReady()` 校验完整用户数和所有汇总，包括已领 Token/返点、已退本金、登记返点人数。旧合约快照必须不变。
6. A 调用旧合约 `executeMigration()`。全部支付币余额、已绑定 Token 余额直接转入目标，然后目标校验资金和准备金并启用。转账与激活在同一事务中；任何失败都撤回。旧合约永久保持冻结且标记已迁出，不能再次领取或解冻。

迁移保留认购额度、用户 ID 与钱包绑定、Vesting 原时间表、成功/退款状态、已领已退记录。不允许把已成功活动变成可退款状态。新合约地址改变后，原资格签名失效，待认购活动须由服务端签发新合约域的凭证，并由用户对新合约重新授权支付币。

执行前可 `cancelMigration()`，旧合约继续冻结，可随后 `unfreeze(reason)`。取消会使旧的导入目标永久失效，下一次必须部署新的空目标；不能复用已导入记录。无迁移目标时，可直接解除冻结。资金迁移后不可回滚，目标日后仍可再次走冻结迁移流程。

仅自动迁移支付币与已绑定销售 Token。其他误转资产应在迁移前核查处理，旧合约永久关闭后无法取出误转资产。若源合约已被盗、内部状态损坏导致无法校验，或紧急函数本身不可调用，此流程不能保证恢复。

### Admin 操作入口

Admin 顶部新增「IDO 合约」，沿用 `campaigns.write` 的后台可见权限；链上 owner 才能执行。输入旧/新地址，连接 A 钱包，按冻结、核查快照、指定目标、初始化、分批导入、执行顺序操作。当前只允许 Robinhood 测试网 46630 和本地开发链 31337。每次写操作都会模拟校验并请求钱包签名，记录链上事件与交易哈希；此页面不保存任何私钥。

JSON 快照仅供核对/归档，按固定区块读取，不用于修改迁移权益。页面关闭后重新输入旧地址、刷新，即可恢复链上目标和导入进度。迁移完成后平台合约配置与服务端事件索引尚需另行更新；当前项目尚无已部署 IDO 地址，不自动修改服务器配置。管理员操作审计以链上事件为准，本版未额外接入服务端审计表。

前端 ABI 来自 `out/PhoodIDO.sol/PhoodIDO.json`，保存至 Admin `src/idoAbi.json`；合约接口变更后须同步。构建使用 via-IR 和自定义错误，保证 IDO 本体低于 EVM 合约大小限制。

## 专用测试钱包与公网测试网验收

本地测试钱包存于 `.secrets/wallets.json`，包含 admin、signer、buyerA、buyerB；该目录已排除 Git。仅用于无真实价值的测试，不要给这些钱包转入主网资金。私钥不打印到终端或报告。

在测试管理员钱包领取 Robinhood Testnet ETH 后执行：

```sh
node script/testnet-e2e.mjs --check
node script/testnet-e2e.mjs
```

脚本强制校验 Chain ID 46630，自行部署 MockUSDT、PHOOD 和独立测试 IDO。覆盖签名认购、美分追加、累计额度、返点结算、Vesting 领取、冻结迁移、管理员开放退款及重复领取保护。为了只用两个买家完成验收，该测试活动软/硬顶用 $1,000/$2,000，不改变正式部署模板 $10,000/$50,000。所有支付币均为脚本部署的 MockUSDT，不是真实 USDT。

交易哈希、确认区块和检查结果保存在 `testnet-runs/e2e.json`（不含私钥），中断后按已记录步骤继续，不自动重发已确认交易。该目录也排除 Git。`--check` 只检查余额，不部署或发交易。公网水龙头需要人机验证及 Google 登录时，由用户自行完成。


## V2 split vesting

Token totals do not change. Base allocation = (paid cents - FINAL rebate cents) * tokenUnitsPerDollar / 100; rebate-backed allocation = final rebate cents * tokenUnitsPerDollar / 100. A cash rebate claim does not modify either allocation. Both are final only after rebate registration and locking, before successful settlement.

`configureVesting` now takes `(start, cliff, duration, interval, initialBps, rebateCliff, rebateDuration, rebateInterval)` in one transaction. Recommended values: `(TGE, 0, 7776000, 1, 3000, 2592000, 7776000, 1)`. Months mean fixed 30-day periods. Rebate-backed tokens have a fixed 0% initial release. At day 30 their linear release begins at zero, without catching up the cliff; day 120 unlocks their full allocation. Base tokens finish at day 90. Configure before TGE; after successful settlement and TGE neither schedule can change. `claimTokens` combines both unlocked amounts and deducts the existing aggregate claimedTokens counter.

This is a new, non-upgradeable deployment. Existing contracts retain V1 behavior; Web and Admin detect the version and use the corresponding ABI. V2 uses migration schema `P2L_IDO_MIGRATION_V2`, copying both schedules and the aggregate claimed amounts. V1/V2 direct migrations are intentionally rejected: changing an existing vesting promise or already-claimed entitlement requires a separately reviewed migration strategy. Do not reuse historical V1 deployment reports as V2 addresses. No live deployment or user-fund migration is implied by this code change.

The `vesting-config.mjs` helper selects the V1 or V2 configuration selector for historical test scripts. Fresh V2 short tests use the same short cliff/duration for both allocations; production recommendations are the 30/90-day settings above, also available as the Admin preset.

The pinned Solidity 0.8.30 build uses via-IR and optimizer_runs=1 to fit EIP-170. The test suite checks deployed bytecode length; retain this deployment-size check for future changes.
