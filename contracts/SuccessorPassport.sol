// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import "./ProductPassport.sol";

/// One-time handover for the existing course demo. Import from the original
/// contract at a pinned block, retaining product IDs and pending workflows.
contract SuccessorPassport is ProductPassport {
    struct Snapshot {
        address[] wallets;
        bytes16[] productIds;
        bytes16[] transferIds;
        bytes16[] claimIds;
        address[] actors;
        bytes32[] operationIds;
    }
    constructor(ProductPassport previous, bytes32 anchor, Snapshot memory snapshot)
        ProductPassport(previous.deploymentId()) {
        require(previous.administrator() == msg.sender, "Original administrator required");
        require(blockhash(block.number - 1) == anchor, "Refresh migration snapshot");
        for (uint256 i; i < snapshot.wallets.length; ++i) {
            address wallet = snapshot.wallets[i];
            roles[wallet] = previous.roles(wallet);
        }
        for (uint256 i; i < snapshot.productIds.length; ++i) {
            bytes16 id = snapshot.productIds[i];
            Product memory p = previous.getProduct(id);
            products[id] = p;
            bytes32 key = _serialKey(p.serial);
            require(previous.serialProducts(key) == id, "Serial mismatch");
            serialProducts[key] = id;
        }
        for (uint256 i; i < snapshot.transferIds.length; ++i) {
            bytes16 id = snapshot.transferIds[i];
            Transfer memory t = previous.getTransfer(id);
            transfers[id] = t;
            retailSales[id] = roles[t.from] == Role.Retailer && roles[t.to] == Role.Customer;
        }
        for (uint256 i; i < snapshot.claimIds.length; ++i) {
            bytes16 id = snapshot.claimIds[i];
            claims[id] = previous.getClaim(id);
        }
        for (uint256 i; i < snapshot.operationIds.length; ++i) {
            address actor = snapshot.actors[i];
            bytes32 op = snapshot.operationIds[i];
            require(previous.operations(actor, op), "Operation mismatch");
            operations[actor][op] = true;
        }
    }
}
