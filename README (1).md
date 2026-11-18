# Smog Relief Fund

A Sepolia testnet project exploring income support for outdoor daily-wage workers in Lahore when smog makes it unsafe to work.

Live dashboard: https://smog-relief-frontend-v3.vercel.app/

> **Sepolia testnet only.** Use a dedicated test wallet with testnet assets. Keep your main wallet and real funds separate.

## How it works

- **AQI updates.** A local Node.js keeper uses Chainlink CRE simulation broadcasts to post Lahore's Open-Meteo AQI readings on Sepolia. Windows Task Scheduler runs the keeper daily.
- **Worker registration.** Workers register with a MetaMask wallet. The V4 demo was configured for 20 wallets, and the contract owner can adjust capacity.
- **Relief credits.** A fresh on-chain AQI reading above 250 can trigger a $5 credit per registered wallet when the pool has sufficient funds. The pool allows one payout trigger per Lahore calendar day.
- **Deposits and claims.** Donors deposit testnet USDC or LINK. Workers can claim available credit in either token, subject to pool liquidity. The Chainlink LINK/USD Data Feed prices LINK claims.

## Known limitations

- **Open registration.** Any wallet can register while slots are available. There is no worker identity or eligibility verification, so one person can register multiple wallets and take up slots.
- **AQI-based eligibility.** The payout depends on the reported AQI and wallet registration. The project has no way to verify that a worker stayed home, skipped outdoor work, or lost income after claiming.
- **Data and uptime.** The demo relies on one Open-Meteo data source and a keeper running on a local Windows computer. A missed run or stale reading can delay a payout.
- **Funding and scale.** Payouts depend on donations, and a claim can fail if the pool lacks the chosen token. The payout transaction updates each worker's credit, so gas costs grow with the cohort.

## Tech stack

- **Contracts:** Solidity, OpenZeppelin, Ethereum Sepolia
- **Data and oracles:** Open-Meteo, Chainlink CRE, Chainlink Data Feeds
- **Frontend:** Next.js, React, Wagmi, Viem, TanStack Query, MetaMask, Vercel
- **Scheduling:** Node.js keeper, Windows Task Scheduler

## How the project uses Chainlink

- **Chainlink CRE** fetches Lahore's AQI from Open-Meteo, generates a report, and writes it to the custom `AirQualityOracle` on Sepolia through a local simulation broadcast and a mock forwarder.
- **Chainlink LINK/USD Data Feed** values LINK in the relief pool and converts a worker's USD credit into LINK when they claim.
- **Scheduling** runs on Windows Task Scheduler. Chainlink told me that free hosted CRE deployment on testnet was unavailable for my individual learner use case and that access would require commercial terms and an MNDA. I chose a local keeper to refresh the AQI and trigger eligible payouts. This project uses no Chainlink Automation upkeep.

CRE deployment access documentation: https://docs.chain.link/cre/guides/operations/deploy-access

## Verified contracts

- SmogReliefPoolV4: https://sepolia.etherscan.io/address/0x7bC02F88dfEa36f8Db7711b6AEA0092bd52D1966#code
- AirQualityOracle: https://sepolia.etherscan.io/address/0x2c401d4095056b8d6dccD6460fa43168A205a0AB#code

## Run the dashboard locally

With Node.js and npm installed, clone this repository and install its dependencies.

```bash
git clone https://github.com/umerrzz/smog-relief-lahore-project.git
cd smog-relief-lahore-project
npm ci
```

Create a `.env.local` file in the repository root with these public settings.

```dotenv
NEXT_PUBLIC_POOL_ADDRESS=0x7bC02F88dfEa36f8Db7711b6AEA0092bd52D1966
NEXT_PUBLIC_SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com
```

Run `npm run dev` and open http://localhost:3000. Wallet transactions require MetaMask on Sepolia and testnet ETH for gas.

## Repository layout

| Path | Contents |
| --- | --- |
| `app/`, `lib/` | Next.js dashboard and wallet integration |
| `contracts/` | Solidity pool and AQI oracle |
| `cre/` | Chainlink CRE workflow and configuration |
| `keeper/` | Local AQI refresh and payout script |

Built by Muhammad Umer.
