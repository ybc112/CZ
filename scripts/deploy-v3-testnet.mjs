import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function loadDotenv(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.includes('YOUR_')) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill ${name}.`);
  }
  return value;
}

function optionalEnv(name, fallback = '') {
  const value = process.env[name];
  return value === undefined ? fallback : value;
}

function artifact(contractFile, contractName) {
  const artifactPath = path.join(rootDir, 'artifacts', 'contracts', contractFile, `${contractName}.json`);
  if (!existsSync(artifactPath)) {
    throw new Error(`Missing artifact ${artifactPath}. Run hardhat compile first.`);
  }
  return JSON.parse(readFileSync(artifactPath, 'utf8'));
}

function writeFrontendEnv(filePath, values) {
  const envContent = [
    'VITE_CHAIN_ID=0x61',
    `VITE_NBT_TOKEN=${values.nbtToken}`,
    `VITE_STAKING_BANK=${values.stakingBank}`,
    `VITE_NBT_PAIR=${values.nbtPair || ''}`,
    `VITE_FEE_TOKEN=${values.feeToken || values.nbtToken}`,
    '',
  ].join('\n');
  writeFileSync(filePath, envContent);
}

function writeDeploymentJson(dirPath, payload) {
  mkdirSync(dirPath, { recursive: true });
  const filePath = path.join(dirPath, `bsc-testnet-v3-${payload.timestamp}.json`);
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

async function wait(tx, label) {
  console.log(`${label}: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`${label} confirmed in block ${receipt.blockNumber} (gasUsed ${receipt.gasUsed.toString()})`);
  return receipt;
}

async function main() {
  loadDotenv(path.join(rootDir, '.env'));

  const rpcUrl = optionalEnv('BSC_TESTNET_RPC_URL', 'https://bsc-testnet.bnbchain.org');
  const privateKey = requireEnv('PRIVATE_KEY');
  const tokenName = optionalEnv('TOKEN_NAME', 'NBT');
  const tokenSymbol = optionalEnv('TOKEN_SYMBOL', 'NBT');
  const initialSupply = optionalEnv('INITIAL_SUPPLY', '200000000');
  const buyFee = Number(optionalEnv('BUY_FEE', '0'));
  const sellFee = Number(optionalEnv('SELL_FEE', '0'));
  const interactionFee = optionalEnv('INTERACTION_FEE', '0.001');
  const inviteReward = optionalEnv('INVITE_REWARD', '10000');
  const minReferralStakeValue = optionalEnv('MIN_REFERRAL_STAKE_VALUE', '100');
  const initialRewardFund = optionalEnv('INITIAL_REWARD_FUND', '1000000');
  // 交互费收取钱包（业务硬性要求）
  const feeReceiverInput = optionalEnv('FEE_RECEIVER');
  const feeReceiver = feeReceiverInput && ethers.isAddress(feeReceiverInput)
    ? feeReceiverInput
    : '0x5A378b61193ac2ce07cE816893C080804504a2f0';
  const deploymentsDir = path.resolve(rootDir, optionalEnv('DEPLOYMENTS_DIR', 'deployments'));
  const frontendEnvPath = path.resolve(rootDir, optionalEnv('FRONTEND_ENV_PATH', 'frontend 3/.env'));

  if (!ethers.isAddress(feeReceiver)) throw new Error(`Invalid FEE_RECEIVER: ${feeReceiver}`);
  if (!Number.isInteger(buyFee) || buyFee < 0 || buyFee > 1000) throw new Error(`Invalid BUY_FEE ${buyFee}`);
  if (!Number.isInteger(sellFee) || sellFee < 0 || sellFee > 1000) throw new Error(`Invalid SELL_FEE ${sellFee}`);

  console.log('Building contracts with Hardhat...');
  execFileSync('npx', ['hardhat', 'compile'], { cwd: rootDir, stdio: 'inherit', shell: true });

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 97) {
    throw new Error(`Expected BSC Testnet chain id 97, got ${network.chainId}. Check BSC_TESTNET_RPC_URL.`);
  }

  const deployer = await wallet.getAddress();
  const balance = await provider.getBalance(deployer);
  console.log(`Deployer: ${deployer}`);
  console.log(`tBNB balance: ${ethers.formatEther(balance)}`);

  // ---- 1. NBTToken ----
  const tokenArtifact = artifact('NBTToken.sol', 'NBTToken');
  const tokenFactory = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, wallet);
  const token = await tokenFactory.deploy(
    tokenName,
    tokenSymbol,
    ethers.parseEther(initialSupply),
    feeReceiver,
    buyFee,
    sellFee,
    [],
    [],
  );
  await token.waitForDeployment();
  const nbtToken = await token.getAddress();
  console.log(`NBTToken deployed: ${nbtToken} (buyFee=${buyFee} sellFee=${sellFee})`);

  // ---- 2. NBTStakingBankV3 ----
  const bankArtifact = artifact('NBTStakingBankV3.sol', 'NBTStakingBankV3');
  const bankFactory = new ethers.ContractFactory(bankArtifact.abi, bankArtifact.bytecode, wallet);
  const bank = await bankFactory.deploy(
    nbtToken,
    nbtToken,
    feeReceiver,
    ethers.parseEther(interactionFee),
  );
  await bank.waitForDeployment();
  const stakingBank = await bank.getAddress();
  console.log(`NBTStakingBankV3 deployed: ${stakingBank}`);
  console.log(`  interactionFee=${interactionFee} BNB, feeReceiver=${feeReceiver}`);

  // ---- 3. 注入奖励资金 ----
  const rewardFundWei = ethers.parseEther(initialRewardFund);
  if (rewardFundWei > 0n) {
    await wait(await token.transfer(stakingBank, rewardFundWei), 'Transfer initial reward fund');
    console.log(`Reward fund funded: ${initialRewardFund} ${tokenSymbol} -> bank`);
  }

  // ---- 4. 配置合约参数 ----
  await wait(await bank.setInviteReward(ethers.parseEther(inviteReward)), 'setInviteReward');
  await wait(await bank.setMinReferralStakeValue(ethers.parseEther(minReferralStakeValue)), 'setMinReferralStakeValue');
  console.log(`Invite reward=${inviteReward} ${tokenSymbol}, minReferralStakeValue=${minReferralStakeValue} ${tokenSymbol}`);

  // ---- 5. 写前端环境变量 ----
  writeFrontendEnv(frontendEnvPath, { nbtToken, stakingBank, nbtPair: '', feeToken: nbtToken });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const deploymentPath = writeDeploymentJson(deploymentsDir, {
    network: 'bsc-testnet',
    chainId: Number(network.chainId),
    timestamp,
    deployer,
    nbtToken,
    stakingBank,
    nbtPair: '',
    feeToken: nbtToken,
    interactionFee,
    feeReceiver,
    inviteReward,
    minReferralStakeValue,
    tokenName,
    tokenSymbol,
    initialSupply,
    initialRewardFund,
    frontendEnvPath,
  });

  console.log('');
  console.log('V3 deployment complete.');
  console.log(`Frontend env written: ${frontendEnvPath}`);
  console.log(`Deployment record: ${deploymentPath}`);
  console.log('');
  console.log('Next commands:');
  console.log('  npm --prefix "frontend 3" run build');
  console.log('  npm --prefix "frontend 3" run dev');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
