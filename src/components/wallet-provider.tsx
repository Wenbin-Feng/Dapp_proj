"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api-client";
import { fetchMe } from "@/lib/wallet-session";
import type { Profile, MeData } from "@/lib/types";
import {
  selectWalletTransport,
  type WalletTransport,
} from "@/lib/wallet-transport";

type AccountListener = (accounts: string[]) => void;
type EthereumProvider = WalletTransport;
interface WalletContextValue {
  profile: Profile | null;
  address: string | null;
  loading: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}
const WalletContext = createContext<WalletContextValue | null>(null);
function injectedMetaMask() {
  const ethereum = (window as Window & { ethereum?: EthereumProvider })
    .ethereum;
  return (
    ethereum?.providers?.find((p) => p.isMetaMask) ||
    (ethereum?.isMetaMask ? ethereum : null)
  );
}
function messageFor(error: unknown, fallback = "The wallet request failed.") {
  const detail = error && typeof error === "object" ? error : null;
  const code = detail && "code" in detail ? String(detail.code) : "";
  if (code === "4001")
    return "The wallet request was cancelled.";
  if (code === "-32002")
    return "A request is already open in MetaMask. Please finish it there.";
  const message = detail && "message" in detail ? detail.message : error;
  if (typeof message === "string" && message.trim()) {
    return message.trim().slice(0, 400);
  }
  return code ? `${fallback} (wallet error ${code})` : fallback;
}
function notifySessionChange() {
  try {
    localStorage.setItem("dapp-session-change", crypto.randomUUID());
  } catch {
    /* Storage may be disabled. */
  }
}
export function WalletProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true),
    [connecting, setConnecting] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<EthereumProvider | null>(null);
  const providerRef = useRef<EthereumProvider | null>(null),
    addressRef = useRef<string | null>(null);
  const alive = useRef(true),
    epoch = useRef(0),
    requestNumber = useRef(0),
    connectingRef = useRef(false),
    logoutRef = useRef<Promise<void> | null>(null);
  const clearIdentity = useCallback(() => {
    epoch.current++;
    requestNumber.current++;
    addressRef.current = null;
    if (alive.current) {
      setAddress(null);
      setProfile(null);
    }
  }, []);
  const signOut = useCallback(async () => {
    if (logoutRef.current) return logoutRef.current;
    clearIdentity();
    if (alive.current) {
      setError(null);
      setLoading(false);
    }
    const pending = (async () => {
      try {
        await api("/api/auth/logout", { method: "POST" });
        notifySessionChange();
      } catch (e) {
        if (alive.current) setError(messageFor(e));
      }
    })();
    logoutRef.current = pending;
    try {
      await pending;
    } finally {
      logoutRef.current = null;
    }
  }, [clearIdentity]);
  const refreshProfile = useCallback(async () => {
    if (logoutRef.current) return;
    const currentEpoch = epoch.current,
      number = ++requestNumber.current;
    const current = () =>
      alive.current &&
      epoch.current === currentEpoch &&
      requestNumber.current === number;
    try {
      const me = await fetchMe();
      if (!current()) return;
      if (me && providerRef.current && !connectingRef.current) {
        const accounts = await providerRef.current
          .request({ method: "eth_accounts" })
          .catch(() => null);
        if (!current()) return;
        if (
          Array.isArray(accounts) &&
          (typeof accounts[0] !== "string" ||
            accounts[0].toLowerCase() !== me.wallet_address.toLowerCase())
        ) {
          await signOut();
          if (alive.current)
            setError(
              "Your wallet account changed. Connect it again to continue.",
            );
          return;
        }
      }
      addressRef.current = me?.wallet_address.toLowerCase() || null;
      setAddress(me?.wallet_address || null);
      setProfile(me?.profile || null);
      if (me) setError(null);
    } catch (e) {
      if (current()) setError(messageFor(e));
      throw e;
    } finally {
      if (current()) setLoading(false);
    }
  }, [signOut]);
  const connect = useCallback(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setConnecting(true);
    setError(null);
    await logoutRef.current;
    clearIdentity();
    const currentEpoch = epoch.current;
    let verifyStarted = false;
    let failureContext = "MetaMask could not connect the selected account.";
    try {
      const wallet = providerRef.current || injectedMetaMask();
      if (!wallet)
        throw new Error(
          "Install the MetaMask browser extension to connect your wallet.",
        );
      if (!providerRef.current) {
        providerRef.current = wallet;
        selectWalletTransport(wallet);
        setProvider(wallet);
      }
      const accounts = await wallet.request({ method: "eth_requestAccounts" });
      if (
        !Array.isArray(accounts) ||
        typeof accounts[0] !== "string" ||
        !/^0x[0-9a-fA-F]{40}$/.test(accounts[0])
      )
        throw new Error("Select an Ethereum wallet account to continue.");
      const chain = await wallet.request({ method: "eth_chainId" });
      const chainId =
        typeof chain === "string" ? Number.parseInt(chain, 16) : NaN;
      if (!Number.isSafeInteger(chainId) || chainId <= 0)
        throw new Error("Your wallet returned an invalid network ID.");
      const challenge = await api<{ id: string; message: string }>(
        "/api/auth/challenge",
        {
          method: "POST",
          body: JSON.stringify({
            wallet_address: accounts[0],
            chain_id: chainId,
          }),
        },
      );
      const encoded =
        "0x" +
        Array.from(new TextEncoder().encode(challenge.message), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
      failureContext = "MetaMask did not return a login signature.";
      const signature = await wallet.request({
        method: "personal_sign",
        params: [encoded, accounts[0]],
      });
      if (typeof signature !== "string")
        throw new Error("Your wallet did not return a signature.");
      verifyStarted = true;
      failureContext = "The signed login could not be verified.";
      const me = await api<MeData>("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ id: challenge.id, signature }),
      });
      const active = await wallet.request({ method: "eth_accounts" });
      if (
        !Array.isArray(active) ||
        typeof active[0] !== "string" ||
        active[0].toLowerCase() !== me.wallet_address.toLowerCase()
      )
        throw new Error(
          "Your wallet account changed while signing in. Please connect again.",
        );
      if (!alive.current || epoch.current !== currentEpoch) {
        await api("/api/auth/logout", { method: "POST" });
        return;
      }
      requestNumber.current++;
      addressRef.current = me.wallet_address.toLowerCase();
      setAddress(me.wallet_address);
      setProfile(me.profile);
      notifySessionChange();
    } catch (e) {
      if (verifyStarted)
        await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
      clearIdentity();
      if (alive.current) setError(messageFor(e, failureContext));
    } finally {
      connectingRef.current = false;
      if (alive.current) {
        setConnecting(false);
        setLoading(false);
      }
    }
  }, [clearIdentity]);
  useEffect(() => {
    alive.current = true;
    void refreshProfile().catch(() => undefined);
    const restore = () => {
      if (alive.current && !connectingRef.current)
        void refreshProfile().catch(() => undefined);
    };
    const storage = (e: StorageEvent) => {
      if (e.key === "dapp-session-change") restore();
    };
    window.addEventListener("focus", restore);
    window.addEventListener("storage", storage);
    return () => {
      alive.current = false;
      epoch.current++;
      window.removeEventListener("focus", restore);
      window.removeEventListener("storage", storage);
    };
  }, [refreshProfile]);
  useEffect(() => {
    const select = (wallet: EthereumProvider) => {
      if (providerRef.current || typeof wallet.request !== "function") return;
      providerRef.current = wallet;
      selectWalletTransport(wallet);
      setProvider(wallet);
    };
    const announce = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          info?: { rdns?: string };
          provider?: EthereumProvider;
        }>
      ).detail;
      if (detail?.info?.rdns === "io.metamask" && detail.provider?.isMetaMask)
        select(detail.provider);
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const fallback = window.setTimeout(() => {
      const wallet = injectedMetaMask();
      if (wallet) select(wallet);
    }, 200);
    return () => {
      window.removeEventListener("eip6963:announceProvider", announce);
      window.clearTimeout(fallback);
    };
  }, []);
  useEffect(() => {
    if (!provider) return;
    const changed: AccountListener = (accounts) => {
      const next =
        typeof accounts[0] === "string" ? accounts[0].toLowerCase() : null;
      if (addressRef.current && next !== addressRef.current)
        void signOut().then(() => {
          if (alive.current)
            setError(
              "Your wallet account changed. Connect it again to continue.",
            );
        });
    };
    provider.on?.("accountsChanged", changed);
    if (!connectingRef.current) void refreshProfile().catch(() => undefined);
    return () => provider.removeListener?.("accountsChanged", changed);
  }, [provider, refreshProfile, signOut]);
  return (
    <WalletContext.Provider
      value={{
        profile,
        address,
        loading,
        connecting,
        error,
        connect,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
export function useWallet() {
  const context = useContext(WalletContext);
  if (!context)
    throw new Error("useWallet must be used inside WalletProvider.");
  return context;
}
