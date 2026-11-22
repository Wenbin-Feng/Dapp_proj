import Link from "next/link";
import type { ChainProof as Proof } from "@/lib/types";
export function ChainProof({ proof }: { proof?: Proof }) {
  if (!proof) return null;
  return (
    <section className="panel chain-proof" aria-label="Blockchain evidence">
      <h3>Blockchain record</h3>
      <p className="small">Local Ethereum · Chain {proof.chain_id}</p>
      <p className="mono small">{proof.contract_address}</p>
      <ol>
        {proof.transactions.map((t) => (
          <li key={t.transaction_hash}>
            <strong>{t.operation}</strong>
            <span className="small muted">Block {t.block_number}</span>
            <Link
              href={`/transactions/${t.transaction_hash}`}
              className="mono small"
            >
              {t.transaction_hash.slice(0, 14)}…{t.transaction_hash.slice(-8)}
            </Link>
          </li>
        ))}
      </ol>
      <p className="small muted">
        Wallet addresses and commitments are public on-chain. Private repair
        text stays in the local database.
      </p>
    </section>
  );
}
