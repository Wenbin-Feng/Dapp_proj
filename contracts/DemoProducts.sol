// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Classroom product registry. Roles are self-selected once, as in the existing demo.
/// Private repair descriptions stay off chain; events carry salted commitments only.
contract DemoProducts is ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum Role { None, Manufacturer, Retailer, Customer, ServiceCenter }
    enum TransferStatus { Missing, Pending, Accepted, Rejected, Cancelled }
    enum ClaimStatus { Missing, Submitted, Approved, Rejected, Completed }
    struct Product {
        address manufacturer;
        address owner;
        string serial;
        string model;
        uint32 warrantyDays;
        uint16 maxClaims;
        uint16 claimsUsed;
        uint64 warrantyStarted;
        uint64 createdAt;
    }
    struct Transfer {
        bytes16 productId;
        address seller;
        address buyer;
        uint256 price;
        uint64 expiresAt;
        uint64 createdAt;
        uint64 resolvedAt;
        TransferStatus status;
    }
    struct Claim {
        bytes16 productId;
        address customer;
        address center;
        bytes32 descriptionHash;
        bytes32 reasonHash;
        bytes32 resolutionHash;
        uint64 createdAt;
        uint64 resolvedAt;
        ClaimStatus status;
    }
    IERC20 public immutable paymentToken;
    uint256 public constant schemaVersion = 1;
    mapping(address => Role) public roles;
    mapping(bytes16 => Product) private products;
    mapping(bytes16 => Transfer) private transfers;
    mapping(bytes16 => Claim) private claims;
    mapping(bytes32 => bytes16) public serialIds;
    mapping(bytes16 => bytes16) public pendingTransfer;
    mapping(bytes16 => bytes16) public openClaim;

    event RoleEnrolled(address indexed wallet, Role role);
    event ProductRegistered(bytes16 indexed productId, address indexed manufacturer, string serial, string model, uint32 warrantyDays, uint16 maxClaims, uint64 timestamp);
    event TransferRequested(bytes16 indexed transferId, bytes16 indexed productId, address indexed seller, address buyer, uint256 price, uint64 expiresAt, uint64 timestamp);
    event TransferResolved(bytes16 indexed transferId, bytes16 indexed productId, address indexed actor, TransferStatus status, address seller, address buyer, uint256 price, uint64 warrantyStarted, uint64 timestamp);
    event ClaimSubmitted(bytes16 indexed claimId, bytes16 indexed productId, address indexed customer, address center, bytes32 descriptionHash, uint64 timestamp);
    event ClaimResolved(bytes16 indexed claimId, bytes16 indexed productId, address indexed center, ClaimStatus status, bytes32 reasonHash, bytes32 resolutionHash, uint16 claimsUsed, uint64 timestamp);

    constructor(address pdc) {
        require(pdc.code.length != 0, "Invalid payment token");
        paymentToken = IERC20(pdc);
    }

    function enroll(Role role) external {
        require(role != Role.None && roles[msg.sender] == Role.None, "Role already set or invalid");
        roles[msg.sender] = role;
        emit RoleEnrolled(msg.sender, role);
    }

    function getProduct(bytes16 id) external view returns (Product memory) {
        require(products[id].owner != address(0), "Product not found");
        return products[id];
    }
    function getTransfer(bytes16 id) external view returns (Transfer memory) {
        require(transfers[id].status != TransferStatus.Missing, "Transfer not found");
        return transfers[id];
    }
    function getClaim(bytes16 id) external view returns (Claim memory) {
        require(claims[id].status != ClaimStatus.Missing, "Claim not found");
        return claims[id];
    }
    function serialKey(string memory serial) public pure returns (bytes32) {
        bytes memory value = bytes(serial);
        require(value.length != 0 && value.length <= 120, "Invalid serial length");
        require(value[0] != 0x20 && value[value.length - 1] != 0x20, "Trim serial spaces");
        for (uint256 i; i < value.length; ++i) {
            uint8 c = uint8(value[i]);
            require(c >= 32 && c <= 126, "Serial must be printable ASCII");
            if (c >= 65 && c <= 90) value[i] = bytes1(c + 32);
        }
        return keccak256(value);
    }

    function registerProduct(bytes16 id, string calldata serial, string calldata model, uint32 warrantyDays, uint16 maxClaims) external {
        _requireId(id);
        require(roles[msg.sender] == Role.Manufacturer, "Manufacturer required");
        require(id != bytes16(0) && products[id].owner == address(0), "Product ID exists or invalid");
        require(bytes(model).length != 0 && bytes(model).length <= 480, "Invalid model");
        require(warrantyDays > 0 && warrantyDays <= 36500 && maxClaims > 0 && maxClaims <= 1000, "Invalid warranty");
        bytes32 key = serialKey(serial);
        require(serialIds[key] == bytes16(0), "Serial already registered");
        products[id] = Product(msg.sender, msg.sender, serial, model, warrantyDays, maxClaims, 0, 0, uint64(block.timestamp));
        serialIds[key] = id;
        emit ProductRegistered(id, msg.sender, serial, model, warrantyDays, maxClaims, uint64(block.timestamp));
    }

    function requestTransfer(bytes16 id, bytes16 productId, address buyer) external {
        _requestTransfer(id, productId, buyer, 0, 0);
    }
    function createPaidOffer(bytes16 id, bytes16 productId, address buyer, uint256 price, uint64 expiresAt) external {
        require(price > 0 && expiresAt > block.timestamp, "Invalid price or expiry");
        _requestTransfer(id, productId, buyer, price, expiresAt);
    }
    function _requestTransfer(bytes16 id, bytes16 productId, address buyer, uint256 price, uint64 expiresAt) private {
        _requireId(id);
        Product storage p = products[productId];
        require(p.owner == msg.sender && buyer != msg.sender && buyer != address(0), "Owner and new buyer required");
        require(id != bytes16(0) && transfers[id].status == TransferStatus.Missing, "Transfer ID exists or invalid");
        require(pendingTransfer[productId] == bytes16(0) && openClaim[productId] == bytes16(0), "Product has open workflow");
        Role sellerRole = roles[msg.sender];
        Role buyerRole = roles[buyer];
        require((sellerRole == Role.Manufacturer && buyerRole == Role.Retailer) ||
            ((sellerRole == Role.Retailer || sellerRole == Role.Customer) && buyerRole == Role.Customer), "Invalid transfer roles");
        transfers[id] = Transfer(productId, msg.sender, buyer, price, expiresAt, uint64(block.timestamp), 0, TransferStatus.Pending);
        pendingTransfer[productId] = id;
        emit TransferRequested(id, productId, msg.sender, buyer, price, expiresAt, uint64(block.timestamp));
    }

    function acceptTransfer(bytes16 id) external nonReentrant {
        require(transfers[id].price == 0, "Paid offer requires payment");
        _accept(id, false);
    }
    function acceptPaidOffer(bytes16 id) external nonReentrant {
        require(transfers[id].price > 0, "Not a paid offer");
        _accept(id, true);
    }
    function _accept(bytes16 id, bool paid) private {
        Transfer storage t = transfers[id];
        require(t.status == TransferStatus.Pending && t.buyer == msg.sender, "Pending offer for buyer required");
        require(t.expiresAt == 0 || block.timestamp <= t.expiresAt, "Offer expired");
        Product storage p = products[t.productId];
        require(p.owner == t.seller && pendingTransfer[t.productId] == id && openClaim[t.productId] == bytes16(0), "Product state changed");
        p.owner = t.buyer;
        if (p.warrantyStarted == 0 && roles[t.seller] == Role.Retailer && roles[t.buyer] == Role.Customer) p.warrantyStarted = uint64(block.timestamp);
        t.status = TransferStatus.Accepted;
        t.resolvedAt = uint64(block.timestamp);
        delete pendingTransfer[t.productId];
        if (paid) paymentToken.safeTransferFrom(t.buyer, t.seller, t.price);
        _emitTransfer(id, t, p.warrantyStarted);
    }
    function rejectTransfer(bytes16 id) external {
        Transfer storage t = transfers[id];
        require(t.status == TransferStatus.Pending && t.buyer == msg.sender, "Pending offer for buyer required");
        _closeTransfer(id, t, TransferStatus.Rejected);
    }
    function cancelTransfer(bytes16 id) external {
        Transfer storage t = transfers[id];
        require(t.status == TransferStatus.Pending && t.seller == msg.sender, "Pending offer for seller required");
        _closeTransfer(id, t, TransferStatus.Cancelled);
    }
    function _closeTransfer(bytes16 id, Transfer storage t, TransferStatus status) private {
        t.status = status;
        t.resolvedAt = uint64(block.timestamp);
        delete pendingTransfer[t.productId];
        _emitTransfer(id, t, products[t.productId].warrantyStarted);
    }
    function _emitTransfer(bytes16 id, Transfer storage t, uint64 warrantyStarted) private {
        emit TransferResolved(id, t.productId, msg.sender, t.status, t.seller, t.buyer, t.price, warrantyStarted, uint64(block.timestamp));
    }

    function submitClaim(bytes16 id, bytes16 productId, address center, bytes32 descriptionHash) external {
        _requireId(id);
        Product storage p = products[productId];
        require(p.owner == msg.sender && roles[msg.sender] == Role.Customer && roles[center] == Role.ServiceCenter, "Customer owner and service center required");
        require(p.warrantyStarted > 0 && block.timestamp < uint256(p.warrantyStarted) + uint256(p.warrantyDays) * 1 days && p.claimsUsed < p.maxClaims, "Warranty unavailable");
        require(pendingTransfer[productId] == bytes16(0) && openClaim[productId] == bytes16(0), "Product has open workflow");
        require(id != bytes16(0) && claims[id].status == ClaimStatus.Missing && descriptionHash != bytes32(0), "Invalid claim");
        claims[id] = Claim(productId, msg.sender, center, descriptionHash, bytes32(0), bytes32(0), uint64(block.timestamp), 0, ClaimStatus.Submitted);
        openClaim[productId] = id;
        emit ClaimSubmitted(id, productId, msg.sender, center, descriptionHash, uint64(block.timestamp));
    }
    function approveClaim(bytes16 id) external {
        Claim storage c = claims[id];
        require(c.center == msg.sender && c.status == ClaimStatus.Submitted, "Submitted claim for center required");
        c.status = ClaimStatus.Approved;
        _emitClaim(id, c);
    }
    function rejectClaim(bytes16 id, bytes32 reasonHash) external {
        Claim storage c = claims[id];
        require(c.center == msg.sender && c.status == ClaimStatus.Submitted && reasonHash != bytes32(0), "Submitted claim and reason required");
        c.status = ClaimStatus.Rejected;
        c.reasonHash = reasonHash;
        c.resolvedAt = uint64(block.timestamp);
        delete openClaim[c.productId];
        _emitClaim(id, c);
    }
    function completeClaim(bytes16 id, bytes32 resolutionHash) external {
        Claim storage c = claims[id];
        require(c.center == msg.sender && c.status == ClaimStatus.Approved && resolutionHash != bytes32(0), "Approved claim and resolution required");
        Product storage p = products[c.productId];
        require(p.claimsUsed < p.maxClaims && openClaim[c.productId] == id, "Claim allowance exhausted");
        c.status = ClaimStatus.Completed;
        c.resolutionHash = resolutionHash;
        c.resolvedAt = uint64(block.timestamp);
        p.claimsUsed += 1;
        delete openClaim[c.productId];
        _emitClaim(id, c);
    }
    function _emitClaim(bytes16 id, Claim storage c) private {
        emit ClaimResolved(id, c.productId, msg.sender, c.status, c.reasonHash, c.resolutionHash, products[c.productId].claimsUsed, uint64(block.timestamp));
    }
    function _requireId(bytes16 id) private pure {
        require(uint8(id[6]) >> 4 == 4 && uint8(id[8]) & 0xc0 == 0x80, "UUID v4 required");
    }
}
