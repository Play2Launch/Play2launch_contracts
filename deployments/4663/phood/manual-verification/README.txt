PHOOD 主网源码验证说明

合约地址：0xb0f09c8bEC180aFEFE32C1D5bab1402121a1bBBE
验证页面：https://robinhoodchain.blockscout.com/address/0xb0f09c8bEC180aFEFE32C1D5bab1402121a1bBBE/contract-verification
网络：Robinhood Chain 主网（4663）

1. Contract license：MIT License (MIT)
2. Verification method：Solidity (Standard JSON input)
3. Compiler：v0.8.30+commit.73712a01
4. 上传 PHOOD-standard-input.json，然后点 Verify & publish。

标准 JSON 已包含 PHOOD 源码、全部 OpenZeppelin 依赖及编译参数，只需要上传这一份 JSON，不要上传 ZIP 或 deployment-info.json。

如果页面额外要求填写：
- Contract name：PHOOD（要求完整路径时填 src/PHOOD.sol:PHOOD）
- Constructor arguments：复制 constructor-arguments.txt 的完整内容；如输入框已固定显示 0x 前缀，则去掉文件开头的 0x。
- Optimization：开启
- Optimization runs：1
- Via IR：开启
- EVM version：cancun
- Libraries：无
以上编译设置已包含在标准 JSON 中，通常不用另填。

构造参数原始值（供核对，不是 ABI 编码输入）：
treasury = 0xD083f0d09ed4234B92bC8D1607E1fE7550AC7882
supply = 1000000000000000000000000000（18 位小数，等于 1,000,000,000 PHOOD）

Token 名称是 PAPERHOOD，符号是 PHOOD；验证的 Solidity 合约名称是 PHOOD。
源码和设置已与部署时存档核对一致。文件不含私钥、助记词或签名交易。
当前状态：已部署且链上核验通过；浏览器源码验证尚待提交成功。
