const ethers = require("ethers");
const fs = require("fs");

async function main() {
  const env = fs.readFileSync(".env", "utf8").split("\n").reduce((acc, line) => {
    if (line.includes("=") && !line.startsWith("#")) {
      const [key, value] = line.split("=");
      acc[key.trim()] = value.trim();
    }
    return acc;
  }, {});

  const deployment = JSON.parse(fs.readFileSync("deployments/bsc-mainnet-2026-05-22T01-15-17-377Z.json", "utf8"));

  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org/");
  const wallet = new ethers.Wallet(env.PRIVATE_KEY, provider);

  const tokenAbi = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function feeReceiver() view returns (address)",
    "function buyFee() view returns (uint256)",
    "function sellFee() view returns (uint256)",
    "function isExcludedFromFee(address) view returns (bool)",
  ];

  const stakingAbi = [
    "function stakingToken() view returns (address)",
    "function rewardToken() view returns (address)",
    "function owner() view returns (address)",
    "function paused() view returns (bool)",
    "function rewardPool() view returns (uint256)",
    "function depositFee() view returns (uint256)",
    "function depositFeeReceiver() view returns (address)",
    "function totalStaked() view returns (uint256)",
    "function getTierInfo(uint256) view returns (uint256, uint256, uint256)",
    "function pendingSyncRewards() view returns (uint256)",
    "function totalRewards() view returns (uint256)",
    "function totalMiningDistributed() view returns (uint256)",
    "function totalReferralAccrued() view returns (uint256)",
    "function totalReferralClaimed() view returns (uint256)",
    "function startTime() view returns (uint256)",
    "function miningEnded() view returns (bool)",
  ];

  const tokenContract = new ethers.Contract(deployment.nbtToken, tokenAbi, provider);
  const stakingContract = new ethers.Contract(deployment.stakingBank, stakingAbi, provider);

  console.log("\n" + "=".repeat(80));
  console.log("                链上合约分析报告");
  console.log("=".repeat(80));

  console.log("\n📋 部署信息");
  console.log("─".repeat(80));
  console.log(`网络: ${deployment.network} (Chain ID: ${deployment.chainId})`);
  console.log(`部署时间: ${deployment.timestamp}`);
  console.log(`部署者地址: ${deployment.deployer}`);
  console.log(`当前钱包地址: ${wallet.address}`);

  const deployerBnbBalance = await provider.getBalance(deployment.deployer);
  console.log(`部署者 BNB 余额: ${ethers.formatEther(deployerBnbBalance)} BNB`);

  console.log("\n🪙 NBT 代币合约");
  console.log("─".repeat(80));
  const tokenName = await tokenContract.name();
  const tokenSymbol = await tokenContract.symbol();
  const decimals = await tokenContract.decimals();
  const totalSupply = await tokenContract.totalSupply();
  const feeReceiver = await tokenContract.feeReceiver();
  const buyFee = await tokenContract.buyFee();
  const sellFee = await tokenContract.sellFee();

  console.log(`合约地址: ${deployment.nbtToken}`);
  console.log(`代币名称: ${tokenName}`);
  console.log(`代币符号: ${tokenSymbol}`);
  console.log(`小数位数: ${decimals}`);
  console.log(`总供应量: ${ethers.formatUnits(totalSupply, decimals)} ${tokenSymbol}`);
  console.log(`手续费接收地址: ${feeReceiver}`);
  console.log(`买入手续费: ${(buyFee / 100).toFixed(2)}%`);
  console.log(`卖出手续费: ${(sellFee / 100).toFixed(2)}%`);

  console.log("\n🏦 NBT 代币余额分布");
  console.log("─".repeat(80));
  const deployerNbtBalance = await tokenContract.balanceOf(deployment.deployer);
  const stakingNbtBalance = await tokenContract.balanceOf(deployment.stakingBank);
  const feeReceiverNbtBalance = await tokenContract.balanceOf(feeReceiver);

  console.log(`部署者 NBT 余额: ${ethers.formatUnits(deployerNbtBalance, decimals)} ${tokenSymbol}`);
  console.log(`质押合约 NBT 余额: ${ethers.formatUnits(stakingNbtBalance, decimals)} ${tokenSymbol}`);
  console.log(`手续费接收地址 NBT 余额: ${ethers.formatUnits(feeReceiverN