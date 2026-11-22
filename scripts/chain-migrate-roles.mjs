// Run against the original private demo ledger during the handover.
// Writes a candidate manifest; activation is an atomic rename after verification.
import { readFile, writeFile } from "node:fs/promises";
import { Contract, ContractFactory, Interface, JsonRpcProvider, keccak256, toUtf8Bytes } from "ethers";
const [manifestPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !outputPath || manifestPath === outputPath)
  throw Error("Provide the original manifest and a separate candidate output path.");
const original = JSON.parse(await readFile(manifestPath, "utf8"));
const url = new URL(process.env.CHAIN_RPC_URL || original.rpcUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || original.predecessor)
  throw Error("Expected the original loopback demo ledger.");
const provider = new JsonRpcProvider(url.href, undefined, { cacheTimeout: -1 });
try {
  const artifact = JSON.parse(await readFile("chain/artifacts/SuccessorPassport.json", "utf8"));
  const abi = new Interface(artifact.abi);
  const old = new Contract(original.address, abi, provider);
  if (![31337,31338].includes(original.chainId) || (await provider.getNetwork()).chainId !== BigInt(original.chainId) ||
      keccak256(await provider.getCode(original.address)) !== original.codeHash ||
      (await provider.getBlock(original.blockNumber))?.hash !== original.blockHash ||
      await old.deploymentId() !== original.deploymentId)
    throw Error("Original contract identity mismatch.");
  const head = await provider.getBlock("latest");
  const sets = {wallets:new Set(),productIds:new Set(),transferIds:new Set(),claimIds:new Set()};
  const actors = [], operationIds = [];
  for (let start = original.blockNumber; start <= head.number; start += 250) {
    const logs = await provider.getLogs({address: original.address, fromBlock:start, toBlock:Math.min(head.number,start+249)});
    for (const log of logs) {
      const {name,args} = abi.parseLog(log);
      if (name === "RoleGranted") sets.wallets.add(args.wallet);
      if (name === "ProductRegistered") sets.productIds.add(args.productId);
      if (name === "TransferRequested") sets.transferIds.add(args.transferId);
      if (name === "ClaimSubmitted") sets.claimIds.add(args.claimId);
      if (name === "OperationRecorded") { actors.push(args.actor); operationIds.push(args.operationId); }
    }
  }
  const snapshot = {...Object.fromEntries(Object.entries(sets).map(([k,v])=>[k,[...v]])), actors, operationIds};
  const signer = await provider.getSigner(original.administrator);
  const factory = new ContractFactory(abi,artifact.bytecode,signer);
  const next = await factory.deploy(original.address,head.hash,snapshot);
  const receipt = await next.deploymentTransaction().wait();
  const address = await next.getAddress();
  const normalize = v => JSON.stringify(v, (_,x)=>typeof x === "bigint" ? String(x):x);
  const same = (a,b) => {if(normalize(a)!==normalize(b))throw Error("Migrated state mismatch.");};
  same(await next.deploymentId(),original.deploymentId);
  same(await next.administrator(),await old.administrator());
  for(const wallet of sets.wallets)same(await old.roles(wallet),await next.roles(wallet));
  for(const [items,method] of [[sets.productIds,"getProduct"],[sets.transferIds,"getTransfer"],[sets.claimIds,"getClaim"]]){
    for(const id of items){
      const record=await old[method](id);same(record,await next[method](id));
      if(method==="getProduct")same(await next.serialProducts(keccak256(toUtf8Bytes(record.serial.toLowerCase()))),id);
    }
  }
  for(const [i,op] of operationIds.entries())same(await next.operations(actors[i],op),true);
  await writeFile(outputPath, JSON.stringify({...original,address,codeHash:keccak256(await provider.getCode(address)),
    blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,transactionHash:receipt.hash,
    predecessor:{address:original.address,blockNumber:original.blockNumber}},null,2)+"\n",{flag:"wx",mode:0o600});
  console.log("Verified successor",address,"at block",receipt.blockNumber,Object.fromEntries(Object.entries(sets).map(([k,v])=>[k,v.size])),"operations",actors.length);
} finally { provider.destroy(); }
