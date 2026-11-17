import { parseAbi } from "viem";

// Matches SmogReliefPoolV3
export const poolAbi = parseAbi([
  "function usdc() view returns (address)",
  "function link() view returns (address)",
  "function oracle() view returns (address)",
  "function owner() view returns (address)",
  "function aqiThreshold() view returns (uint256)",
  "function payoutUsd() view returns (uint256)",
  "function maxWorkers() view returns (uint256)",
  "function workerCount() view returns (uint256)",
  "function totalOwedUsd() view returns (uint256)",
  "function availableFundsUsd() view returns (uint256)",
  "function unallocatedFundsUsd() view returns (uint256)",
  "function triggeredToday() view returns (bool)",
  "function currentLinkPrice() view returns (uint256)",
  "function isRegistered(address) view returns (bool)",
  "function owedUsd(address) view returns (uint256)",
  "function previewClaim(address worker, address token) view returns (uint256)",
  "function deposit(address token, uint256 amount)",
  "function register()",
  "function trigger()",
  "function claim(address token)",
  "function setThreshold(uint256 value)",
]);

export const oracleAbi = parseAbi([
  "function latestAqi() view returns (uint256 aqi, uint256 updatedAt)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
