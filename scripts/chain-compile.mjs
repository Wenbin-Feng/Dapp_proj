import solc from "solc";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const input = {
  language: "Solidity",
  sources: {
    "ProductPassport.sol": {
      content: await readFile("contracts/ProductPassport.sol", "utf8"),
    },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: "cancun",
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
await writeFile(
  "src/lib/chain-abi.json",
  JSON.stringify(contract.abi, null, 2) + "\n",
);
console.log(
  `Compiled ProductPassport with ${solc.version()}; deployed code ${contract.evm.deployedBytecode.object.length / 2} bytes.`,
);
