import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const NBT_TOKEN = '0x2E38Df5650108378c9432d0cEe06A4B28cC6Cf99';
const EXPECTED_FROM = '0xD09Dc26F1c20E85879863A7e932735749efC1835';
const TO = '0x4bfe5e33edfa1ef6b2ed504a5e325507c6d8f21d';
const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

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
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function rpcUrls() {
  const raw = process.env.BSC_MAINNET_RPC_URLS || '';
  const urls = raw.split(',').map((item) => item.trim()).filter(Boolean);
  if (urls.length > 0) return urls;
  return [
    process.env.BSC_MAINNET_RPC_URL || 'https://bsc-dataseed.binance.org/',
    'https://bsc-dataseed1.binance.org/',
    'https://bsc-dataseed2.binance.org/',
    'https://bsc.publicnode.com',
    'https://bsc.blockpi.network/v1/rpc/public',
  ];
}

async function createProvider() {
  const errors = [];
  for (const rpcUrl of rpcUrls()) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== 56) {
        throw new Error(`expected chain id 56, got ${network.chainId}`);
      }
      return { provider, rpcUrl };
    } catch (error) {
      errors.push(`${rpcUrl}: ${error.message}`);
    }
  }
  throw new Error(`Unable to connect to BSC mainnet RPC:\n${errors.join('\n')}`);
}

async function main() {
  loadDotenv(path.join(rootDir, '.env.mainnet'));

  const privateKey = requireEnv('PRIVATE_KEY');
  const { provider, rpcUrl } = await createProvider();
  const wallet = new ethers.Wallet(privateKey, provider);
  const from = await wallet.getAddress();

  if (from.toLowerCase() !== EXPECTED_FROM.toLowerCase()) {
    throw new Error(`Private key signs for ${from}, expected ${EXPECTED_FROM}. Refusing to transfer.`);
  }

  const token = new ethers.Contract(NBT_TOKEN, ERC20_ABI, wallet);
  const [symbol, decimals, balance, bnbBalance] = await Promise.all([
    token.symbol(),
    token.decimals(),
    token.balanceOf(from),
    provider.getBalance(from),
  ]);

  console.log(`RPC URL: ${rpcUrl}`);
  console.log(`From: ${from}`);
  console.log(`To: ${TO}`);
  console.log(`Token: ${symbol} (${NBT_TOKEN})`);
  console.log(`BNB balance: ${ethers.formatEther(bnbBalance)}`);
  console.log(`Token balance: ${ethers.formatUnits(balance, decimals)} ${symbol}`);

  if (balance === 0n) {
    console.log('No NBT balance to transfer.');
    return;
  }

  const tx = await token.transfer(TO, balance);
  console.log(`Transfer tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Confirmed in block: ${receipt.blockNumber}`);

  const [fromAfter, toAfter] = await Promise.all([
    token.balanceOf(from),
    token.balanceOf(TO),
  ]);
  console.log(`From balance after: ${ethers.formatUnits(fromAfter, decimals)} ${symbol}`);
  console.log(`To balance after: ${ethers.formatUnits(toAfter, decimals)} ${symbol}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
