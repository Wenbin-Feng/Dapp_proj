import solc from "solc";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const input = {
  language: "Solidity",
  sources: {
    "SuccessorPassport.sol": { content: await readFile("contracts/SuccessorPassport.sol", "utf8") },
    "ProductPassport.sol": {
      content: await readFile("contracts/ProductPassport.sol", "utf8"),
    },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: process.env.DAPP_EVM_VERSION || "cancun",
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
      },
    },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const error of output.errors || [])
  if (error.severity === "error") throw new Error(error.formattedMessage);
const contract = output.contracts["ProductPassport.sol"].ProductPassport;
await mkdir("chain/artifacts", { recursive: true });
await writeFile(
  "chain/artifacts/ProductPassport.json",
  JSON.stringify(
    {
      compiler: solc.version(),
      abi: contract.abi,
      bytecode: "0x" + contract.evm.bytecode.object,
    },
    null,
    2,
  ) + "\n",
);
const successor = output.contracts["SuccessorPassport.sol"].SuccessorPassport;
await writeFile("chain/artifacts/SuccessorPassport.json", JSON.stringify({
  abi: successor.abi, bytecode: "0x" + successor.evm.bytecode.object,
}));
await writeFile(
  "src/lib/chain-abi.json",
  JSON.stringify(contract.abi, null, 2) + "\n",
);
console.log(
  `Compiled ProductPassport with ${solc.version()}; deployed code ${contract.evm.deployedBytecode.object.length / 2} bytes.`,
);
