// Smog Relief Fund keeper — Sepolia testnet demo.
// Refreshes AQI through a CRE simulation broadcast,
// then triggers worker credits when eligible.

import { execSync } from "node:child_process";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const log = (message) =>
  console.log(`[${new Date().toISOString()}] ${message}`);

const poolAbi = parseAbi([
  "function trigger()",
  "function oracle() view returns (address)",
  "function aqiThreshold() view returns (uint256)",
  "function triggeredToday() view returns (bool)",
]);

const oracleAbi = parseAbi([
  "function latestAqi() view returns (uint256 aqi, uint256 updatedAt)",
]);

async function main() {
  const POOL = process.env.NEXT_PUBLIC_POOL_ADDRESS;
  const KEY = process.env.KEEPER_PRIVATE_KEY;
  const CRE_DIR = process.env.CRE_PROJECT_DIR;
  const RPC =
    process.env.NEXT_PUBLIC_SEPOLIA_RPC ||
    "https://ethereum-sepolia-rpc.publicnode.com";

  if (!POOL || !KEY || !CRE_DIR) {
    throw new Error(
      "Missing pool address, keeper key, or CRE project directory."
    );
  }

  if (!isAddress(POOL)) {
    throw new Error("The configured pool address is invalid.");
  }

  const normalizedKey = KEY.startsWith("0x") ? KEY : `0x${KEY}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedKey)) {
    throw new Error("The keeper key has an invalid format.");
  }

  const account = privateKeyToAccount(normalizedKey);

  const pub = createPublicClient({
    chain: sepolia,
    transport: http(RPC),
  });

  const wallet = createWalletClient({
    account,
    chain: sepolia,
    transport: http(RPC),
  });

  if ((await pub.getChainId()) !== sepolia.id) {
    throw new Error("The RPC endpoint is not Ethereum Sepolia.");
  }

  // Refresh AQI even if today's payout has already occurred.
  log("Running CRE workflow to refresh AQI...");

  try {
    execSync(
      "cre workflow simulate aqi-workflow --target staging-settings --broadcast",
      {
        cwd: CRE_DIR,
        stdio: "inherit",
        timeout: 300_000,
      }
    );
  } catch {
    // Stop rather than silently using an older report.
    throw new Error(
      "CRE refresh failed or timed out. No payout attempted."
    );
  }

  const alreadyTriggered = await pub.readContract({
    address: POOL,
    abi: poolAbi,
    functionName: "triggeredToday",
  });

  if (alreadyTriggered) {
    log("Already triggered today (Lahore time). Nothing to do.");
    return;
  }

  const oracle = await pub.readContract({
    address: POOL,
    abi: poolAbi,
    functionName: "oracle",
  });

  const [aqi, updatedAt] = await pub.readContract({
    address: oracle,
    abi: oracleAbi,
    functionName: "latestAqi",
  });

  const threshold = await pub.readContract({
    address: POOL,
    abi: poolAbi,
    functionName: "aqiThreshold",
  });

  log(`AQI: ${aqi}. Threshold: ${threshold}.`);
  log(
    `Report timestamp: ${new Date(
      Number(updatedAt) * 1000
    ).toISOString()}`
  );

  if (aqi <= threshold) {
    log("AQI is not above the threshold. No payout.");
    return;
  }

  // Contract simulation checks freshness, funding,
  // registered workers, and the daily payout limit.
  const { request } = await pub.simulateContract({
    account,
    address: POOL,
    abi: poolAbi,
    functionName: "trigger",
  });

  const hash = await wallet.writeContract(request);

  log(`Trigger sent: https://sepolia.etherscan.io/tx/${hash}`);

  const receipt = await pub.waitForTransactionReceipt({
    hash,
    timeout: 180_000,
  });

  if (receipt.status !== "success") {
    throw new Error(`Trigger transaction reverted: ${hash}`);
  }

  log("Payout confirmed. Workers can now claim.");
}

main().catch((error) => {
  // Avoid printing error objects that might contain RPC credentials.
  const message =
    error?.name === "Error"
      ? error.message
      : "Keeper operation failed. Check RPC, funding, and contract conditions.";

  log(message);
  process.exitCode = 1;
});