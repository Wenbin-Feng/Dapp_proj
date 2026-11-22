"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PassportShell } from "@/components/app-shell";
import { ErrorNotice, Loading } from "@/components/ui";
import { api } from "@/lib/api-http";
interface Receipt {
  hash: string;
  status: string;
  chain_id: number;
  contract: string;
  from: string;
  block_number: number;
  block_hash: string;
  gas_used: string;
  events: string[];
}
export default function TransactionPage() {
  const { hash } = useParams<{ hash: string }>(),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setReceipt(null);
    setError(null);
    api<Receipt>(`/api/chain/transaction?hash=${encodeURIComponent(hash)}`)
      .then((r) => {
        if (!cancelled) setReceipt(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [hash]);
  return (
    <PassportShell>
      <div className="transaction-page">
        <h1>Transaction receipt</h1>
        <ErrorNotice error={error} />
        {!receipt && !error && <Loading text="Reading the local blockchain…" />}
        {receipt && (
          <div className="panel">
            <dl className="facts-grid">
              {[
                ["Status", receipt.status],
                ["Chain ID", receipt.chain_id],
                ["Block", receipt.block_number],
                ["Gas used", receipt.gas_used],
                ["Transaction hash", receipt.hash],
                ["Contract", receipt.contract],
                ["Sender wallet", receipt.from],
                ["Block hash", receipt.block_hash],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <h2>Contract events</h2>
            <ul>
              {receipt.events.map((name, i) => (
                <li key={i}>{name}</li>
              ))}
            </ul>
            <p className="small muted">
              This receipt is read from the configured local node. The SQLite
              database does not fabricate transaction hashes.
            </p>
          </div>
        )}
      </div>
    </PassportShell>
  );
}
