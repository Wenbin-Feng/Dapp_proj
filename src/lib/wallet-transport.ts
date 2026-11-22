import type { Eip1193Provider } from "ethers";
export interface WalletTransport extends Eip1193Provider {
  isMetaMask?: boolean;
  providers?: WalletTransport[];
  on?: (event: string, listener: (accounts: string[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (accounts: string[]) => void,
  ) => void;
}
let selected: WalletTransport | null = null;
export function selectWalletTransport(provider: WalletTransport) {
  selected = provider;
}
export function walletTransport() {
  if (selected) return selected;
  const ethereum = (window as Window & { ethereum?: WalletTransport }).ethereum;
  return (
    ethereum?.providers?.find((p) => p.isMetaMask) ||
    (ethereum?.isMetaMask ? ethereum : null)
  );
}
