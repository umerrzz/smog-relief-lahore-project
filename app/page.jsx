"use client";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useReadContracts, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { sepolia } from "wagmi/chains";
import { formatUnits, parseUnits } from "viem";
import { poolAbi, oracleAbi, erc20Abi } from "../lib/abi";
import { POOL } from "../lib/wagmi";

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (v, dec, max = 2) => (v === undefined ? "…" : Number(formatUnits(v, dec)).toLocaleString(undefined, { maximumFractionDigits: max }));
const usd = (v) => (v === undefined ? "…" : `$${fmt(v, 6)}`); // contract USD credit uses 6 decimals

export default function Home() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [tok, setTok] = useState("usdc");
  const [amount, setAmount] = useState("5");
  const [simThreshold, setSimThreshold] = useState("100");
  const me = address ?? "0x0000000000000000000000000000000000000000";

  // Stage 1: pool state (also gives us the token and oracle addresses)
  const p = (functionName, args) => ({ address: POOL, abi: poolAbi, functionName, args, chainId: sepolia.id });
  const s1 = useReadContracts({
    contracts: [p("usdc"), p("link"), p("oracle"), p("owner"), p("aqiThreshold"), p("payoutUsd"), p("maxWorkers"),
      p("workerCount"), p("totalOwedUsd"), p("availableFundsUsd"), p("unallocatedFundsUsd"), p("triggeredToday"),
      p("isRegistered", [me]), p("owedUsd", [me]), p("currentLinkPrice")],
    query: { enabled: !!POOL, refetchInterval: 15000 },
  });
  const r = (i) => s1.data?.[i]?.result;
  const [usdc, link, oracle, owner, threshold, payout, maxW, workers, totalOwed, gross, unalloc, doneToday, registered, myOwed, linkPrice] =
    Array.from({ length: 15 }, (_, i) => r(i));

  // Stage 2: oracle, token balances, claim previews
  const t = (addr, functionName, args) => ({ address: addr, abi: erc20Abi, functionName, args, chainId: sepolia.id });
  const s2 = useReadContracts({
    contracts: [
      { address: oracle, abi: oracleAbi, functionName: "latestAqi", chainId: sepolia.id },
      t(usdc, "balanceOf", [me]), t(usdc, "allowance", [me, POOL]),
      t(link, "balanceOf", [me]), t(link, "allowance", [me, POOL]),
      p("previewClaim", [me, usdc]), p("previewClaim", [me, link]),
      t(usdc, "balanceOf", [POOL]), t(link, "balanceOf", [POOL]),
    ],
    query: { enabled: !!usdc && !!link && !!oracle, refetchInterval: 15000 },
  });
  const q = (i) => s2.data?.[i]?.result;
  const [aqi, updatedAt] = q(0) ?? [];
  const TOK = {
    usdc: { addr: usdc, sym: "USDC", dec: 6, bal: q(1), allow: q(2), preview: q(5), pool: q(7) },
    link: { addr: link, sym: "LINK", dec: 18, bal: q(3), allow: q(4), preview: q(6), pool: q(8) },
  };
  const cur = TOK[tok];

  // Transactions
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  useEffect(() => { if (receipt.isSuccess) { s1.refetch(); s2.refetch(); } }, [receipt.isSuccess]);
  const send = (contract, functionName, args = []) => { reset(); writeContract({ ...contract, functionName, args, chainId: sepolia.id }); };
  const poolTx = (fn, args) => send({ address: POOL, abi: poolAbi }, fn, args);
  const busy = isPending || receipt.isLoading;
  const off = !isConnected || chainId !== sepolia.id || busy;

  const depositAmt = (() => { try { return parseUnits(amount || "0", cur.dec); } catch { return 0n; } })();
  const needsApproval = (cur.allow ?? 0n) < depositAmt;
  const triggered = aqi !== undefined && threshold !== undefined && aqi > threshold;
  const isOwner = address && owner && address.toLowerCase() === owner.toLowerCase();
  const wrongChain = isConnected && chainId !== sepolia.id;
  const ageH = updatedAt ? Math.round((Date.now() / 1000 - Number(updatedAt)) / 3600) : null;

  if (!POOL) return <main><p className="card">Set NEXT_PUBLIC_POOL_ADDRESS in .env.local, then restart <code>npm run dev</code>.</p></main>;

  return (
    <main>
      <div className="banner">Sepolia testnet proof of concept. Valueless tokens. Not for real funds.</div>
      <header>
        <div>
          <h1>Smog Relief Fund</h1>
          <p className="sub">When Lahore’s air is hazardous (AQI above {threshold?.toString() ?? "…"}), every registered outdoor worker is credited {usd(payout)}, claimable in USDC or LINK. No applications, no officials, every step is a public transaction.</p>
        </div>
        {isConnected
          ? <button className="ghost" onClick={() => disconnect()}>{short(address)} · Disconnect</button>
          : <button onClick={() => connect({ connector: connectors[0] })}>Connect wallet</button>}
      </header>

      {wrongChain && <div className="card warn">Wrong network. <button onClick={() => switchChain({ chainId: sepolia.id })}>Switch to Sepolia</button></div>}

      <section className="grid">
        <div className={`card big ${triggered ? "hot" : ""}`}>
          <span className="label">Lahore AQI (on-chain)</span>
          <span className="num">{aqi?.toString() ?? "…"}</span>
          <span className="label">{triggered ? "Above threshold" : "Below threshold"}{ageH !== null && ` · updated ${ageH}h ago`}</span>
        </div>
        <div className="card">
          <span className="label">Pool value</span><span className="num">{usd(gross)}</span>
          <span className="label">{usd(unalloc)} unallocated · {usd(totalOwed)} owed</span>
          <span className="label">{fmt(TOK.usdc.pool, 6)} USDC · {fmt(TOK.link.pool, 18, 4)} LINK{linkPrice ? ` · LINK $${fmt(linkPrice, 8)}` : ""}</span>
        </div>
        <div className="card"><span className="label">Registered workers</span><span className="num">{workers?.toString() ?? "…"}/{maxW?.toString() ?? "…"}</span><span className="label">{doneToday ? "Payout already triggered today" : "No payout yet today (Lahore time)"}</span></div>
      </section>

      <section className="grid two">
        <div className="card">
          <h2>Worker</h2>
          <p>Your credit: <b>{usd(myOwed)}</b></p>
          <div className="row">
            <button disabled={off || registered} onClick={() => poolTx("register")}>{registered ? "Registered ✓" : "Register"}</button>
          </div>
          <div className="row">
            {["usdc", "link"].map((k) => (
              <button key={k} disabled={off || !myOwed} onClick={() => poolTx("claim", [TOK[k].addr])}>
                Claim {TOK[k].preview !== undefined && myOwed ? `${fmt(TOK[k].preview, TOK[k].dec, 4)} ` : ""}{TOK[k].sym}
              </button>
            ))}
          </div>
        </div>
        <div className="card">
          <h2>Donor / NGO</h2>
          <p>Your wallet: {fmt(cur.bal, cur.dec, 4)} {cur.sym}</p>
          <div className="row">
            <select value={tok} onChange={(e) => setTok(e.target.value)}><option value="usdc">USDC</option><option value="link">LINK</option></select>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            {needsApproval
              ? <button disabled={off} onClick={() => send({ address: cur.addr, abi: erc20Abi }, "approve", [POOL, depositAmt])}>1. Approve</button>
              : <button disabled={off || depositAmt === 0n} onClick={() => poolTx("deposit", [cur.addr, depositAmt])}>2. Deposit</button>}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Trigger payout</h2>
        <p>Anyone can call this. It credits every registered worker if the latest on-chain AQI is above the threshold. One successful trigger per Lahore day.</p>
        <button disabled={off || doneToday} onClick={() => poolTx("trigger")}>{doneToday ? "Already triggered today" : "Trigger"}</button>
      </section>

      {isOwner && (
        <section className="card sim">
          <h2>Simulation (owner only)</h2>
          <p>Demo aid: lowers the AQI threshold so a trigger can be forced on a clear day. This is a simulation, not a real reading.</p>
          <div className="row">
            <input value={simThreshold} onChange={(e) => setSimThreshold(e.target.value)} inputMode="numeric" />
            <button disabled={busy} onClick={() => poolTx("setThreshold", [BigInt(simThreshold || 0)])}>Set threshold</button>
          </div>
        </section>
      )}

      {(hash || error) && (
        <div className="card status">
          {busy && <p>{isPending ? "Confirm in your wallet…" : "Waiting for confirmation…"}</p>}
          {receipt.isSuccess && <p>Confirmed ✓</p>}
          {error && <p className="err">{error.shortMessage ?? error.message}</p>}
          {hash && <a href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">View on Etherscan</a>}
        </div>
      )}

      <footer>
        Pool <a href={`https://sepolia.etherscan.io/address/${POOL}`} target="_blank" rel="noreferrer">{short(POOL)}</a>
        {oracle && <> · Oracle <a href={`https://sepolia.etherscan.io/address/${oracle}`} target="_blank" rel="noreferrer">{short(oracle)}</a></>}
        {" "}· Payout is parametric: it cannot verify who stayed home.
      </footer>
    </main>
  );
}
