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
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.includes('YOUR_')) {
    throw new Error(`Missing ${name}. Copy .env.mainnet to .env and fill ${name}.`);
  }
  return value;
}

function optionalEnv(name, fallback = '') {
  const value = process.env[name];
  return value === undefined ? fallback : value;
}

function artifact(contractFile, contractName) {
  const artifactPath = path.join(rootDir, 'out', contractFile, `${contractName}.json`);
  if (!existsSync(artifactPath)) {
    throw new Error(`Missing artifact ${artifactPath}. Run forge build first.`);
  }
  return JSON.parse(readFileSync(artifactPath, 'utf8'));
}

function writeFrontendEnv(filePath, values) {
  const envContent = [
    'VITE_CHAIN_ID=0x38',
    `VITE_NBT_TOKEN=${values.nbtToken}`,
    `VITE_STAKING_BANK=${values.stakingBank}`,
    `VITE_NBT_PAIR=${values.nbtPair || ''}`,
    '',
  ].join('\n');
  writeFileSync(filePath, envContent);
}

function writeDeploymentJson(dirPath, payload) {
  mkdirSync(dirPath, { recursive: true });
  const filePath = path.join(dirPath, `bsc-mainnet-${payload.timestamp}.json`);
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

async function wait(tx, label) {
  console.log(`${label}: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`${label} confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

function parseRpcUrls() {
  const raw = optionalEnv('BSC_MAINNET_RPC_URLS', '');
  const urls = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (urls.length > 0) return urls;

  return [
    optionalEnv('BSC_MAINNET_RPC_URL', 'https://bsc-dataseed.binance.org/'),
    'https://bsc-dataseed1.binance.org/',
    'https://bsc-dataseed2.binance.org/',
    'https://bsc.publicnode.com',
    'https://bsc.blockpi.network/v1/rpc/public',
  ];
}

async function createProvider() {
  const rpcUrls = parseRpcUrls();
  const errors = [];

  for (const rpcUrl of rpcUrls) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      await provider.getNetwork();
      return { provider, rpcUrl };
    } catch (error) {
      errors.push(`${rpcUrl}: ${error.message}`);
    }
  }

  throw new Error(`Unable to connect to any BSC mainnet RPC.\n${errors.join('\n')}`);
}

async function main() {
  loadDotenv(path.join(rootDir, '.env.mainnet'));

  const privateKey = requireEnv('PRIVATE_KEY');
  const tokenName = optionalEnv('TOKEN_NAME', 'NBT');
  const tokenSymbol = optionalEnv('TOKEN_SYMBOL', 'NBT');
  const initialSupply = optionalEnv('INITIAL_SUPPLY', '200000000');
  const initialRewardFund = optionalEnv('INITIAL_REWARD_FUND', '0');
  const depositFee = Number(optionalEnv('DEPOSIT_FEE', '0'));
  const depositFeeReceiverInput = optionalEnv('DEPOSIT_FEE_RECEIVER', '');
  const deploymentsDir = path.resolve(rootDir, optionalEnv('DEPLOYMENTS_DIR', 'deployments'));
  const frontendEnvPath = path.resolve(rootDir, optionalEnv('FRONTEND_ENV_PATH', 'frontend 3/.env'));

  console.log('Building contracts with forge...');
  execFileSync('forge', ['build'], { cwd: rootDir, stdio: 'inherit' });

  const { provider, rpcUrl } = await createProvider();
  const wallet = new ethers.Wallet(privateKey, provider);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 56) {
    throw new Error(`Expected BSC Mainnet chain id 56, got ${network.chainId}. Check BSC_MAINNET_RPC_URL.`);
  }

  const deployer = await wallet.getAddress();
  const feeReceiverInput = optionalEnv('FEE_RECEIVER', '');
  const feeReceiver = feeReceiverInput && ethers.isAddress(feeReceiverInput) ? feeReceiverInput : deployer;
  const pairInput = optionalEnv('NBT_PAIR', '');
  const nbtPair = pairInput && ethers.isAddress(pairInput) ? pairInput : '';

  const balance = await provider.getBalance(deployer);
  console.log(`Deployer: ${deployer}`);
  console.log(`BNB balance: ${ethers.formatEther(balance)}`);
  console.log(`RPC URL: ${rpcUrl}`);

  if (balance < ethers.parseEther('0.01')) {
    console.warn('WARNING: BNB balance is very low. Deployment may fail due to insufficient gas.');
  }

  const tokenArtifact = artifact('NBTToken.sol', 'NBTToken');
  const stakingArtifact = artifact('NBTStakingBank.sol', 'NBTStakingBank');

  const tokenFactory = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode.object, wallet);
  const initialSupplyWei = ethers.parseEther(initialSupply);
  const buyFee = Number(optionalEnv('BUY_FEE', '0'));
  const sellFee = Number(optionalEnv('SELL_FEE', '280'));
  if (!Number.isInteger(buyFee) || buyFee < 0 || buyFee > 1000) {
    throw new Error(`Invalid BUY_FEE ${buyFee}, must be integer 0-1000`);
  }
  if (!Number.isInteger(sellFee) || sellFee < 0 || sellFee > 1000) {
    throw new Error(`Invalid SELL_FEE ${sellFee}, must be integer 0-1000`);
  }
  const initialPairs = nbtPair ? [nbtPair] : [];
  const initialExcluded = [];

  console.log('\n========== DEPLOYMENT CONFIG ==========');
  console.log(`Network: BSC Mainnet (Chain ID: 56)`);
  console.log(`Token Name: ${tokenName}`);
  console.log(`Token Symbol: ${tokenSymbol}`);
  console.log(`Initial Supply: ${initialSupply}`);
  console.log(`Buy Fee: ${buyFee / 100}%`);
  console.log(`Sell Fee: ${sellFee / 100}%`);
  console.log(`Fee Receiver: ${feeReceiver}`);
  console.log(`NBT Pair: ${nbtPair || '(none)'}`);
  console.log(`Deposit Fee: ${depositFee / 100}%`);
  console.log(`Deposit Fee Receiver: ${depositFeeReceiverInput || deployer}`);
  console.log(`Initial Reward Fund: ${initialRewardFund}`);
  console.log('=======================================\n');

  console.log('Deploying NBTToken...');
  const token = await tokenFactory.deploy(
    tokenName,
    tokenSymbol,
    initialSupplyWei,
    feeReceiver,
    buyFee,
    sellFee,
    initialPairs,
    initialExcluded,
  );
  await token.waitForDeployment();
  const nbtToken = await token.getAddress();
  console.log(`NBTToken deployed: ${nbtToken}`);
  console.log(`  buyFee=${buyFee} sellFee=${sellFee} feeReceiver=${feeReceiver}`);
  console.log(`  initial pairs: ${initialPairs.length ? initialPairs.join(', ') : '(none)'}`);
  console.log('  Token has NO owner — all fee/pair settings are immutable.');

  console.log('\nDeploying NBTStakingBank...');
  const stakingFactory = new ethers.ContractFactory(stakingArtifact.abi, stakingArtifact.bytecode.object, wallet);
  const staking = await stakingFactory.deploy(nbtToken, nbtToken);
  await staking.waitForDeployment();
  const stakingBank = await staking.getAddress();
  console.log(`NBTStakingBank deployed: ${stakingBank}`);

  const depositFeeReceiver =
    depositFeeReceiverInput && ethers.isAddress(depositFeeReceiverInput)
      ? depositFeeReceiverInput
      : deployer;
  if (depositFee > 0 || depositFeeReceiverInput) {
    console.log('\nConfiguring staking deposit fee...');
    await wait(await staking.setDepositFee(depositFee, depositFeeReceiver), 'Set deposit fee');
  }

  const rewardFundWei = ethers.parseEther(initialRewardFund);
  if (rewardFundWei > 0n) {
    console.log('\nFunding initial rewards...');
    await wait(await token.approve(stakingBank, rewardFundWei), 'Approve initial rewards');
    await wait(await staking.fundRewards(rewardFundWei), 'Fund initial rewards');
  }

  writeFrontendEnv(frontendEnvPath, { nbtToken, stakingBank, nbtPair });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const deploymentPath = writeDeploymentJson(deploymentsDir, {
    network: 'bsc-mainnet',
    chainId: Number(network.chainId),
    timestamp,
    deployer,
    nbtToken,
    stakingBank,
    nbtPair,
    depositFee,
    depositFeeReceiver,
    tokenName,
    tokenSymbol,
    initialSupply,
    feeReceiver,
    initialRewardFund,
    frontendEnvPath,
  });

  console.log('\n========== DEPLOYMENT COMPLETE ==========');
  console.log(`Network: BSC Mainnet`);
  console.log(`NBTToken: ${nbtToken}`);
  console.log(`StakingBank: ${stakingBank}`);
  console.log(`DepositFee: ${depositFee / 100}%`);
  console.log(`DepositFeeReceiver: ${depositFeeReceiver}`);
  console.log(`Deployer: ${deployer}`);
  console.log(`Frontend env written: ${frontendEnvPath}`);
  console.log(`Deployment record: ${deploymentPath}`);
  console.log('\nIMPORTANT: Save these addresses! They cannot be changed.');
  console.log('=========================================\n');
  console.log('Next commands:');
  console.log('  npm --prefix "frontend 3" run build');
  console.log('  npm --prefix "frontend 3" run dev');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
