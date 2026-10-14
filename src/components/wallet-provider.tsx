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
import type { EthereumWallet, SupabaseClient } from "@supabase/supabase-js";
import { createBrowserSupabase } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import { BRAND } from "@/lib/brand";
import { fetchMe } from "@/lib/wallet-session";

type EthereumProvider = EthereumWallet & {
  isMetaMask?: boolean;
  providers?: EthereumProvider[];
};
interface WalletContextValue {
  profile: Profile | null;
  loading: boolean;
  connecting: boolean;
  error: string | null;
  address: string | null;
  connect: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

function injectedMetaMask(): EthereumProvider | null {
  const ethereum = (window as Window & { ethereum?: EthereumProvider })
    .ethereum;
  return (
    ethereum?.providers?.find((provider) => provider.isMetaMask) ||
    (ethereum?.isMetaMask ? ethereum : null)
  );
}

function messageFor(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (code === 4001)
    return "The wallet request was cancelled. You can try again.";
  if (code === -32002)
    return "A request is already open in MetaMask. Please finish it there.";
  return error instanceof Error
    ? error.message
    : "Wallet sign-in failed. Please try again.";
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<EthereumProvider | null>(null);
  const clientRef = useRef<SupabaseClient | null>(null);
  const providerRef = useRef<EthereumProvider | null>(null);
  const addressRef = useRef<string | null>(null);
  const alive = useRef(true);
  const epoch = useRef(0);
  const requestNumber = useRef(0);
  const connectingRef = useRef(false);
  const logoutRef = useRef<Promise<void> | null>(null);

  const getClient = useCallback(() => {
    if (!clientRef.current) clientRef.current = createBrowserSupabase();
    return clientRef.current;
  }, []);

  const clearIdentity = useCallback(() => {
    epoch.current += 1;
    requestNumber.current += 1;
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
      // Sign-out is terminal even when it invalidates an initial restoration.
      setLoading(false);
    }
    const logout = (async () => {
      try {
        const { error: logoutError } = await getClient().auth.signOut({
          scope: "local",
        });
        if (logoutError) throw logoutError;
      } catch (logoutError) {
        if (alive.current) setError(messageFor(logoutError));
      }
    })();
    logoutRef.current = logout;
    try {
      await logout;
    } finally {
      logoutRef.current = null;
    }
  }, [clearIdentity, getClient]);

  const refreshProfile = useCallback(async () => {
    const currentEpoch = epoch.current;
    const number = ++requestNumber.current;
    try {
      const me = await fetchMe();
      if (
        !alive.current ||
        epoch.current !== currentEpoch ||
        requestNumber.current !== number
      )
        return;
      const activeProvider = providerRef.current;
      if (me && activeProvider && !connectingRef.current) {
        // eth_accounts is silent; it never opens a connection or signing prompt.
        const accounts = await activeProvider
          .request({ method: "eth_accounts" })
          .catch(() => null);
        if (
          !alive.current ||
          epoch.current !== currentEpoch ||
          requestNumber.current !== number
        )
          return;
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
      setError(null);
    } catch (loadError) {
      if (
        alive.current &&
        epoch.current === currentEpoch &&
        requestNumber.current === number
      ) {
        setError(messageFor(loadError));
      }
      throw loadError;
    } finally {
      // An earlier Strict Mode setup may finish after the next setup starts.
      // Only the current restoration request can release the initial loader.
      if (
        alive.current &&
        epoch.current === currentEpoch &&
        requestNumber.current === number
      ) {
        setLoading(false);
      }
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
    try {
      const wallet = providerRef.current || injectedMetaMask();
      if (!wallet)
        throw new Error(
          "Install the MetaMask browser extension to connect your wallet.",
        );
      if (!providerRef.current) {
        providerRef.current = wallet;
        setProvider(wallet);
      }
      const client = getClient();
      const { error: loginError } = await client.auth.signInWithWeb3({
        chain: "ethereum",
        wallet,
        statement:
          `Sign in to ${BRAND.name} to manage your product passports. This request does not send a transaction.`,
      });
      if (loginError) throw loginError;
      if (!alive.current || currentEpoch !== epoch.current) {
        await client.auth.signOut({ scope: "local" });
        return;
      }
      const me = await fetchMe();
      if (!me)
        throw new Error(
          "Your wallet session could not be verified. Please connect again.",
        );
      const accounts = await wallet.request({ method: "eth_accounts" });
      if (
        !Array.isArray(accounts) ||
        typeof accounts[0] !== "string" ||
        accounts[0].toLowerCase() !== me.wallet_address.toLowerCase()
      ) {
        throw new Error(
          "Your wallet account changed while signing in. Please connect again.",
        );
      }
      if (!alive.current || currentEpoch !== epoch.current) {
        await client.auth.signOut({ scope: "local" });
        return;
      }
      requestNumber.current += 1;
      addressRef.current = me.wallet_address.toLowerCase();
      setAddress(me.wallet_address);
      setProfile(me.profile);
    } catch (connectError) {
      // Do not leave a newly issued session behind when post-login verification fails.
      await clientRef.current?.auth
        .signOut({ scope: "local" })
        .catch(() => undefined);
      clearIdentity();
      if (alive.current) setError(messageFor(connectError));
    } finally {
      connectingRef.current = false;
      if (alive.current) {
        setConnecting(false);
        setLoading(false);
      }
    }
  }, [clearIdentity, getClient]);

  useEffect(() => {
    alive.current = true;
    let unsubscribe: (() => void) | undefined;
    try {
      const client = getClient();
      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((event) => {
        if (!alive.current) return;
        if (event === "SIGNED_OUT") clearIdentity();
        if (
          ["SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event) &&
          !connectingRef.current
        ) {
          queueMicrotask(() => {
            if (alive.current) void refreshProfile().catch(() => undefined);
          });
        }
      });
      unsubscribe = () => subscription.unsubscribe();
      void refreshProfile().catch(() => undefined);
    } catch (setupError) {
      setError(messageFor(setupError));
      setLoading(false);
    }
    return () => {
      alive.current = false;
      epoch.current += 1;
      unsubscribe?.();
    };
  }, [clearIdentity, getClient, refreshProfile]);

  useEffect(() => {
    const select = (wallet: EthereumProvider) => {
      if (providerRef.current || typeof wallet.request !== "function") return;
      providerRef.current = wallet;
      setProvider(wallet);
    };
    const onAnnounce = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          info?: { rdns?: string };
          provider?: EthereumProvider;
        }>
      ).detail;
      if (detail?.info?.rdns === "io.metamask" && detail.provider?.isMetaMask)
        select(detail.provider);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const fallback = window.setTimeout(() => {
      const wallet = injectedMetaMask();
      if (wallet) select(wallet);
    }, 200);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      window.clearTimeout(fallback);
    };
  }, []);

  useEffect(() => {
    if (!provider) return;
    const onAccountsChanged = (accounts: `0x${string}`[]) => {
      const next =
        typeof accounts[0] === "string" ? accounts[0].toLowerCase() : null;
      if (addressRef.current && next !== addressRef.current) {
        void signOut().then(() => {
          if (alive.current)
            setError(
              "Your wallet account changed. Connect it again to continue.",
            );
        });
      }
    };
    provider.on?.("accountsChanged", onAccountsChanged);
    if (!connectingRef.current) void refreshProfile().catch(() => undefined);
    return () =>
      provider.removeListener?.("accountsChanged", onAccountsChanged);
  }, [provider, refreshProfile, signOut]);

  return (
    <WalletContext.Provider
      value={{
        profile,
        loading,
        connecting,
        error,
        address,
        connect,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context)
    throw new Error("useWallet must be used inside WalletProvider.");
  return context;
}
