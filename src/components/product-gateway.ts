"use client";
import { useMemo } from "react";
import { erc20Abi, getAddress, type Address, type Hash, type Hex } from "viem";
import { useWallet } from "./wallet-provider";
import { useDemoChain } from "./demo-chain-provider";
import { api, productGateway } from "@/lib/api-client";
import type { Profile } from "@/lib/types";
import { productAbi } from "@/lib/chain/product-abi";
import { productHex, productId } from "@/lib/chain/product-events";
import { parseAmount } from "@/lib/chain/amounts";
import type { SyncResult } from "@/lib/chain/product-indexer";

import { chainRoles } from "@/lib/chain/config";
export type Sale = { price: string; expiresAt: string };
type Participant = Pick<Profile, "id" | "role" | "wallet_address"> & {
  chain_role: number;
};

export function useProductGateway() {
  const chain = useDemoChain();
  const wallet = useWallet();
  return useMemo(() => {
    async function context() {
      if (chain.loading)
        throw new Error(
          "The network configuration is still loading. Try again in a moment.",
        );
      if (chain.configError) throw new Error(chain.configError);
      if (chain.config?.productBackend !== "chain") return null;
      if (
        !chain.client ||
        !chain.config.products ||
        !wallet.profile ||
        !wallet.address
      )
        throw new Error(
          "Connect your wallet and configure the product registry first.",
        );
      const role = await chain.client.readContract({
        address: chain.config.products,
        abi: productAbi,
        functionName: "roles",
        args: [wallet.address as Address],
      });
      if (role !== chainRoles[wallet.profile.role])
        throw new Error(
          "Activate your matching role in the test-network banner before continuing.",
        );
      return {
        config: chain.config,
        client: chain.client,
        account: wallet.address as Address,
        products: chain.config.products,
      };
    }
    async function reconcile(hash: Hash) {
      for (let batch = 0; batch < 8; batch++) {
        const result = await api<SyncResult>("/api/chain/sync", {
          method: "POST",
          body: JSON.stringify({ transaction_hash: hash }),
        });
        if (result.indexed) return;
        if (!result.backlog) break;
      }
      throw new Error(
        `Transaction ${hash} is confirmed on chain. The read model is still catching up; use Sync products instead of submitting the operation again.`,
      );
    }
    async function registered(hash: Hash, id: string) {
      try {
        await reconcile(hash);
        return await productGateway.detail(id);
      } catch (error) {
        throw new Error(
          `Chain transaction ${hash} is confirmed. ${error instanceof Error ? error.message : "Use Sync products to recover its read model."}`,
        );
      }
    }
    const participant = (key: "wallet" | "id", value: string) =>
      api<Participant>(
        `/api/chain/participant?${key}=${encodeURIComponent(value)}`,
      );
    const privatePayload = (
      product_id: string,
      claim_id: string,
      kind: "description" | "reason" | "resolution",
      body: string,
    ) =>
      api<{ commitment: Hex }>("/api/chain/private-payload", {
        method: "POST",
        body: JSON.stringify({ product_id, claim_id, kind, body }),
      });
    return {
      ...productGateway,
      async register(input: Parameters<typeof productGateway.register>[0]) {
        const c = await context();
        if (!c) return productGateway.register(input);
        if (
          !/^[\x20-\x7e]{1,120}$/.test(input.serial_number) ||
          input.serial_number.trim() !== input.serial_number
        )
          throw new Error(
            "Use a trimmed printable ASCII serial number (up to 120 characters) for the chain registry.",
          );
        const id = crypto.randomUUID();
        const hash = await chain.invoke(
          {
            address: c.products,
            abi: productAbi,
            functionName: "registerProduct",
            args: [
              productHex(id),
              input.serial_number,
              input.model,
              input.warranty_duration_days,
              input.max_claims,
            ],
          },
          "Register product",
        );
        return (await registered(hash, id)).product;
      },
      async transfer(id: string, toWallet: string, sale?: Sale) {
        const c = await context();
        if (!c) {
          if (sale)
            throw new Error("PDC sales require the chain product backend.");
          return productGateway.transfer(id, toWallet);
        }
        const buyer = await participant("wallet", getAddress(toWallet));
        const transferId = crypto.randomUUID();
        let args: readonly unknown[] = [
          productHex(transferId),
          productHex(id),
          buyer.wallet_address,
        ];
        if (sale) {
          const seconds = Math.floor(new Date(sale.expiresAt).getTime() / 1000);
          const now = (await c.client.getBlock()).timestamp;
          if (!Number.isSafeInteger(seconds) || BigInt(seconds) <= now)
            throw new Error(
              "Choose an offer expiry later than the current chain time.",
            );
          args = [...args, parseAmount(sale.price), BigInt(seconds)];
        }
        const hash = await chain.invoke(
          {
            address: c.products,
            abi: productAbi,
            functionName: sale ? "createPaidOffer" : "requestTransfer",
            args,
          },
          sale ? "Create PDC offer" : "Request product transfer",
        );
        const detail = await registered(hash, id);
        const result = detail.transfers.find((t) => t.id === transferId);
        if (!result)
          throw new Error(
            "Transfer confirmed; sync products to load its index.",
          );
        return result;
      },
      async transferAction(id: string, action: "accept" | "reject" | "cancel") {
        const c = await context();
        if (!c) return productGateway.transferAction(id, action);
        const transfer = await c.client.readContract({
          address: c.products,
          abi: productAbi,
          functionName: "getTransfer",
          args: [productHex(id)],
        });
        if (transfer.status !== 1)
          throw new Error(
            "This offer is already resolved. Sync products to refresh its status.",
          );
        if (action === "accept" && transfer.price > 0n) {
          const allowance = await c.client.readContract({
            address: c.config.pdc,
            abi: erc20Abi,
            functionName: "allowance",
            args: [c.account, c.products],
          });
          if (allowance < transfer.price)
            throw new Error(
              "Review the PDC payment and approve the product contract first.",
            );
        }
        const hash = await chain.invoke(
          {
            address: c.products,
            abi: productAbi,
            functionName:
              action === "accept"
                ? transfer.price > 0n
                  ? "acceptPaidOffer"
                  : "acceptTransfer"
                : action === "reject"
                  ? "rejectTransfer"
                  : "cancelTransfer",
            args: [productHex(id)],
          },
          action === "accept" && transfer.price > 0n
            ? "Pay PDC and accept product"
            : `${action[0].toUpperCase() + action.slice(1)} product transfer`,
        );
        const detail = await registered(hash, productId(transfer.productId));
        const result = detail.transfers.find((t) => t.id === id);
        if (!result)
          throw new Error(
            "The transfer is confirmed. Sync products and reload its index.",
          );
        return result;
      },
      async claim(input: Parameters<typeof productGateway.claim>[0]) {
        const c = await context();
        if (!c) return productGateway.claim(input);
        const center = await participant("id", input.service_center_id);
        if (center.chain_role !== 4 || center.role !== "service_center")
          throw new Error("Choose an active service center.");
        const id = crypto.randomUUID();
        const draft = await privatePayload(
          input.product_id,
          id,
          "description",
          input.description,
        );
        const hash = await chain.invoke(
          {
            address: c.products,
            abi: productAbi,
            functionName: "submitClaim",
            args: [
              productHex(id),
              productHex(input.product_id),
              center.wallet_address,
              draft.commitment,
            ],
          },
          "Submit warranty request",
        );
        const result = (await registered(hash, input.product_id)).claims.find(
          (claim) => claim.id === id,
        );
        if (!result)
          throw new Error(
            "The request is confirmed. Sync products and reload its index.",
          );
        return result;
      },
      async claimAction(
        id: string,
        input: Parameters<typeof productGateway.claimAction>[1],
      ) {
        const c = await context();
        if (!c) return productGateway.claimAction(id, input);
        const claim = await c.client.readContract({
          address: c.products,
          abi: productAbi,
          functionName: "getClaim",
          args: [productHex(id)],
        });
        const product = productId(claim.productId);
        let args: readonly unknown[] = [productHex(id)];
        if (input.action !== "approve") {
          const draft = await privatePayload(
            product,
            id,
            input.action === "reject" ? "reason" : "resolution",
            (input.action === "reject" ? input.reason : input.resolution) || "",
          );
          args = [...args, draft.commitment];
        }
        const hash = await chain.invoke(
          {
            address: c.products,
            abi: productAbi,
            functionName:
              input.action === "approve"
                ? "approveClaim"
                : input.action === "reject"
                  ? "rejectClaim"
                  : "completeClaim",
            args,
          },
          input.action === "complete"
            ? "Complete repair"
            : `${input.action[0].toUpperCase() + input.action.slice(1)} warranty request`,
        );
        const result = (await registered(hash, product)).claims.find(
          (item) => item.id === id,
        );
        if (!result)
          throw new Error(
            "The claim action is confirmed. Sync products and reload its index.",
          );
        return result;
      },
    };
  }, [
    chain.config,
    chain.configError,
    chain.loading,
    chain.client,
    chain.invoke,
    wallet.profile,
    wallet.address,
  ]);
}
